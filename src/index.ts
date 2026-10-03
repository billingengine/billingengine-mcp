#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BillingEngineClient, BillingEngineError } from "./client.js";

const apiKey = process.env.BILLINGENGINE_API_KEY;
if (!apiKey) {
  console.error("BILLINGENGINE_API_KEY is not set. You find your key in BillingEngine under Settings > API.");
  process.exit(1);
}

const baseUrl = process.env.BILLINGENGINE_URL ?? "https://www.billingengine.com";
const client = new BillingEngineClient(baseUrl, apiKey);

const INSTRUCTIONS = [
  "BillingEngine is an invoicing application for freelancers and small businesses.",
  "Look a customer up with find_customers before creating an invoice and never guess a customer id; ask which one is meant when several match.",
  "Prices are net amounts, the tax rate and everything else not given come from the account's settings.",
  "Invoices are created as drafts and are not sent: tell the user to review and send them in BillingEngine, using the app_url in the result.",
  "Nothing can be deleted through this server.",
].join(" ");

const server = new McpServer({ name: "billingengine", version: "0.1.0" }, { instructions: INSTRUCTIONS });

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const page = z.number().int().min(1).optional().describe("Page of the list, starting at 1");

const address = z.object({
  line_1: z.string().describe("Street and number"),
  line_2: z.string().optional(),
  postal_code: z.string(),
  city: z.string(),
  region: z.string().optional(),
  country: z.string().length(2).describe("ISO country code such as DE, AT or CH"),
});

const customerFields = {
  company: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  vat_number: z.string().optional(),
  buyer_reference: z.string().optional().describe("Leitweg-ID or buyer reference for e-invoices"),
};

const item = z.object({
  title: z.string(),
  price: z.number().describe("Net price per unit"),
  description: z.string().optional(),
  quantity: z.number().optional().describe("Defaults to 1"),
  unit_code: z.string().optional().describe("UN/ECE unit code such as C62 (piece) or HUR (hour)"),
  tax_rate: z.number().optional().describe("VAT rate in percent; defaults to the account's default tax"),
});

const invoiceFields = {
  date: date.optional().describe("Invoice date, defaults to today"),
  due_days: z.number().int().min(0).optional().describe("Days until payment is due"),
  introduction: z.string().optional(),
  signature: z.string().optional(),
  service_period_start_date: date.optional(),
  service_period_end_date: date.optional(),
};

const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

type Result = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const output = z.looseObject({});

async function respond(action: () => Promise<unknown>): Promise<Result> {
  try {
    const value = await action();
    const structured = typeof value === "string" ? { message: value } : (value as Record<string, unknown>);
    return { content: [{ type: "text", text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
  } catch (error) {
    const message = error instanceof BillingEngineError ? error.message : `Unexpected error: ${(error as Error).message}`;
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

function withAppUrl<T extends { id: number }>(invoice: T) {
  return { ...invoice, app_url: `${baseUrl}/invoices/${invoice.id}/edit` };
}

function withInvoiceLinks(result: unknown) {
  const body = result as { data?: { id: number }[]; id?: number };
  if (body.data) return { ...body, data: body.data.map(withAppUrl) };
  return body.id === undefined ? body : withAppUrl(body as { id: number });
}

server.registerTool(
  "find_customers",
  {
    title: "Find customers",
    description: "Lists customers, optionally filtered by a search text that matches company, names and email.",
    inputSchema: { query: z.string().optional(), page },
    outputSchema: output,
    annotations: READ,
  },
  ({ query, page }) => respond(() => client.get("/customers", { query, page })),
);

server.registerTool(
  "create_customer",
  {
    title: "Create a customer",
    description:
      "Creates a customer. Needs a company or a last name and a full address (line 1, postal code, city, country).",
    inputSchema: { ...customerFields, address },
    outputSchema: output,
    annotations: WRITE,
  },
  ({ address, ...fields }) => respond(() => client.post("/customers", { ...fields, address_attributes: address })),
);

server.registerTool(
  "update_customer",
  {
    title: "Update a customer",
    description: "Changes the given fields of a customer; fields that are left out stay as they are.",
    inputSchema: { id: z.number().int(), ...customerFields, address: address.partial().optional() },
    outputSchema: output,
    annotations: { ...WRITE, idempotentHint: true },
  },
  ({ id, address, ...fields }) =>
    respond(() => client.patch(`/customers/${id}`, { ...fields, ...(address && { address_attributes: address }) })),
);

server.registerTool(
  "create_invoice",
  {
    title: "Create a draft invoice",
    description:
      "Creates a draft invoice for a customer. Number, language, texts and VAT treatment come from the account settings. " +
      "The invoice is not sent; it counts towards the monthly invoice maximum of the plan.",
    inputSchema: { customer_id: z.number().int(), items: z.array(item).min(1), ...invoiceFields },
    outputSchema: output,
    annotations: WRITE,
  },
  (input) => respond(async () => withInvoiceLinks(await client.post("/invoices", input))),
);

server.registerTool(
  "update_invoice",
  {
    title: "Update a draft invoice",
    description:
      "Changes a draft invoice. Passing items replaces all existing items, so send the complete list. Sent invoices cannot be changed.",
    inputSchema: { id: z.number().int(), items: z.array(item).min(1).optional(), ...invoiceFields },
    outputSchema: output,
    annotations: { ...WRITE, idempotentHint: true },
  },
  ({ id, ...changes }) => respond(async () => withInvoiceLinks(await client.patch(`/invoices/${id}`, changes))),
);

server.registerTool(
  "list_invoices",
  {
    title: "List invoices",
    description:
      "Lists invoices, newest first. Status: draft, open (sent and unpaid), overdue (open and past due) or paid.",
    inputSchema: {
      status: z.enum(["draft", "open", "overdue", "paid"]).optional(),
      customer_id: z.number().int().optional(),
      number: z.string().optional(),
      after: date.optional().describe("Invoice date from"),
      before: date.optional().describe("Invoice date until"),
      page,
      per_page: z.number().int().min(1).max(100).optional(),
    },
    outputSchema: output,
    annotations: READ,
  },
  (filters) => respond(async () => withInvoiceLinks(await client.get("/invoices", filters))),
);

server.registerTool(
  "get_invoice",
  {
    title: "Get an invoice",
    description: "Returns one invoice with its items, amounts and payment status.",
    inputSchema: { id: z.number().int() },
    outputSchema: output,
    annotations: READ,
  },
  ({ id }) => respond(async () => withInvoiceLinks(await client.get(`/invoices/${id}`))),
);

server.registerTool(
  "download_invoice",
  {
    title: "Download an invoice file",
    description:
      "Saves the PDF or the XML e-invoice of an invoice on this computer and returns the file path. " +
      "Defaults to the Downloads folder.",
    inputSchema: {
      id: z.number().int(),
      format: z.enum(["pdf", "xml"]).default("pdf"),
      directory: z.string().optional().describe("Target folder, defaults to ~/Downloads"),
    },
    outputSchema: output,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  ({ id, format, directory }) =>
    respond(async () => {
      const file = await client.getFile(`/invoices/${id}.${format}`);
      const folder = directory ?? path.join(homedir(), "Downloads");
      await mkdir(folder, { recursive: true });
      const target = path.join(folder, path.basename(file.filename));
      await writeFile(target, file.data);
      return `Saved to ${target}`;
    }),
);

server.registerTool(
  "record_payment",
  {
    title: "Record a payment",
    description:
      "Records a payment for one or more sent, open invoices of the same customer and tax rate. The amount is gross.",
    inputSchema: {
      invoice_ids: z.array(z.number().int()).min(1),
      amount: z.number().positive().describe("Gross amount received"),
      payment_method: z.enum(["transfer", "cash"]).optional().describe("Defaults to transfer"),
      date: date.optional().describe("Defaults to today"),
    },
    outputSchema: output,
    annotations: WRITE,
  },
  (input) => respond(() => client.post("/payments", input)),
);

server.registerTool(
  "list_payments",
  {
    title: "List payments",
    description: "Lists recorded payments, newest first, optionally only those for one invoice.",
    inputSchema: { invoice_id: z.number().int().optional(), page },
    outputSchema: output,
    annotations: READ,
  },
  (filters) => respond(() => client.get("/payments", filters)),
);

await server.connect(new StdioServerTransport());
