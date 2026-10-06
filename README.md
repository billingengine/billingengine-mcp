# BillingEngine MCP server

[![AllMCPs Verified](https://allmcps.com/api/badge/billingengine-mcp)](https://allmcps.com/mcp/billingengine-mcp?verify=e69e154f-3c18-4a25-b8a9-42bfcd9c6182)

Create customers and invoices, look up open invoices and record payments in
[BillingEngine](https://www.billingengine.com) by talking to Claude, Cursor or any other
[MCP](https://modelcontextprotocol.io) client:

> "Create an invoice for Acme Painting over 100 euros."
>
> "Which invoices are overdue?"
>
> "Acme paid invoice 2610030028, record the payment."

BillingEngine is invoicing software for freelancers and small businesses with
[e-invoicing](https://www.billingengine.com/en/features) (EN 16931, XRechnung, ZUGFeRD / Factur-X).
The server is a thin layer over the [BillingEngine API](https://www.billingengine.com/en/api)
and runs on your computer.

## Requirements

- Node.js 20 or newer
- A BillingEngine account on a paid plan. The API is not available in the Free plan.
- Your API key from **Settings > API** in BillingEngine

## Setup

### Claude Desktop

Add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "billingengine": {
      "command": "npx",
      "args": ["-y", "billingengine-mcp"],
      "env": { "BILLINGENGINE_API_KEY": "your-api-key" }
    }
  }
}
```

### Claude Code

```sh
claude mcp add billingengine --env BILLINGENGINE_API_KEY=your-api-key -- npx -y billingengine-mcp
```

### Cursor and other clients

Use the same `command`, `args` and `env` as above in the MCP settings of your client.

## Tools

| Tool | What it does |
| --- | --- |
| `find_customers` | Searches customers by company, name or email |
| `create_customer` | Creates a customer |
| `update_customer` | Changes a customer |
| `create_invoice` | Creates a **draft** invoice for a customer |
| `update_invoice` | Changes a draft invoice |
| `list_invoices` | Lists invoices, filtered by status, customer, number or date |
| `get_invoice` | Returns one invoice with items and payment status |
| `download_invoice` | Saves the PDF or the XML e-invoice to your Downloads folder |
| `record_payment` | Records a payment for sent invoices |
| `list_payments` | Lists payments, optionally for one invoice |

## What it does and does not do

- Invoices are created as **drafts**. Nothing is sent to your customers; you review and send
  the invoice in BillingEngine. Every result contains a link to open the draft.
- Prices are net. Number, language, texts, VAT treatment and payment terms come from your
  account settings, exactly as in the invoice form.
- **Nothing can be deleted** through this server.
- New invoices count towards the monthly invoice maximum of your plan.
- The API allows 60 requests per minute per key.
- Your key stays on your computer and is only sent to BillingEngine.

If a key is ever exposed, generate a new one under **Settings > API**. The old key stops working
immediately. The settings also show when the key was last used.

## Configuration

| Variable | Meaning |
| --- | --- |
| `BILLINGENGINE_API_KEY` | Your API key (required) |
| `BILLINGENGINE_URL` | Base URL, defaults to `https://www.billingengine.com` |

## Development

```sh
npm install
npm run build
BILLINGENGINE_API_KEY=... node dist/index.js
```

## License

MIT. BillingEngine itself is a commercial service; see [billingengine.com](https://www.billingengine.com).
