// Builds billingengine-smithery.mcpb: the regular bundle plus the inputSchema of each tool
// in manifest.json, which Smithery requires but the MCPB schema (and so `mcpb validate`) does not allow.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const stage = "mcpb-smithery";
const client = new Client({ name: "smithery-bundle", version: "0" });
await client.connect(
  new StdioClientTransport({
    command: "node",
    args: ["mcpb/server/index.js"],
    env: { ...process.env, BILLINGENGINE_API_KEY: "placeholder" },
  }),
);
const { tools } = await client.listTools();
await client.close();

const manifest = JSON.parse(readFileSync("mcpb/manifest.json", "utf8"));
for (const tool of manifest.tools) {
  tool.inputSchema = tools.find((candidate) => candidate.name === tool.name).inputSchema;
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage);
cpSync("mcpb/server", `${stage}/server`, { recursive: true });
cpSync("mcpb/package.json", `${stage}/package.json`);
writeFileSync(`${stage}/manifest.json`, JSON.stringify(manifest, null, 2));
rmSync("billingengine-smithery.mcpb", { force: true });
execFileSync("zip", ["-qr", "../billingengine-smithery.mcpb", "."], { cwd: stage });
rmSync(stage, { recursive: true, force: true });
console.log("Wrote billingengine-smithery.mcpb");
