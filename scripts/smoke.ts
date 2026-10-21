// End-to-end smoke test against a running server with the official MCP client over Streamable HTTP:
// initialize, tools/list, resources/read and a full morning flow. Usage: node scripts/smoke.ts [url]
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.argv[2] ?? "http://localhost:8787/mcp");
await fetch(new URL("/demo/reset", url), {method: "POST"});

const client = new Client({name: "smoke", version: "1.0.0"});
await client.connect(new StreamableHTTPClientTransport(url));
console.log("protocol:", (client.getServerVersion() as {name: string}).name, "| negotiated with server");

const {tools} = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));

const text = (r: {content: unknown}) => (r.content as {text: string}[]).map((c) => c.text).join(" ");
for (const [name, args] of [
    ["get_due_doses", {slot: "morning"}],
    ["log_dose", {medicine: "BP ki dawai", slot: "morning"}],
    ["log_dose", {medicine: "telma", slot: "morning"}],
    ["daily_checkin", {feeling: "thoda chakkar aa raha hai"}],
    ["get_refill_status", {}],
    ["prepare_refill_order", {medicine: "Telma"}],
    ["confirm_order", {order_id: "ord-1", confirmed: true}],
    ["weekly_summary", {}],
] as const) {
    const result = await client.callTool({name, arguments: args});
    console.log(`\n> ${name} ${JSON.stringify(args)}${result.isError ? " [isError]" : ""}\n  ${text(result)}`);
}

const card = await client.readResource({uri: "ui://ammas-hour/doses-card.html"});
console.log("\nresource:", card.contents[0].uri, (card.contents[0] as {mimeType: string}).mimeType);
await client.close();
