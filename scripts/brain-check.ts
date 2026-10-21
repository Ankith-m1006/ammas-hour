import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
await fetch("http://localhost:8787/demo/reset", {method: "POST"});
const c = new Client({name: "chk", version: "1"}); await c.connect(new StreamableHTTPClientTransport(new URL("http://localhost:8787/mcp")));
const {tools} = await c.listTools();
const ctx: any = {};
for (const u of ["Subah ki dawai kaunsi hai?", "Le li", "Thoda chakkar aa raha hai", "Kaunsi dawai khatam ho rahi hai?", "Telma mangwa do", "Haan, order karo", "Amma ka hafta kaisa raha?", "I took my sugar tablet"]) {
  const plan = await (await fetch("http://localhost:8787/brain", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({utterance: u, tools, context: ctx})})).json();
  const out: string[] = [];
  for (const call of plan.calls) {
    const r: any = await c.callTool({name: call.name, arguments: call.arguments});
    out.push(r.content.map((x: any) => x.text).join(" "));
    ctx.lastTool = call.name; const s = r.structuredContent || {};
    if (call.name === "get_due_doses") { ctx.dueMedicines = (s.doses||[]).filter((d: any) => !d.taken).map((d: any) => d.name); ctx.dueSlot = s.slot; }
    if (call.name === "prepare_refill_order" && s.orderId) ctx.pendingOrderId = s.orderId;
    if (call.name === "confirm_order") delete ctx.pendingOrderId;
  }
  console.log(`[${plan.via}] "${u}" -> ${plan.calls.map((x: any) => x.name + JSON.stringify(x.arguments)).join(" + ") || plan.say}\n     ${out.join(" | ").slice(0, 230)}`);
}
await c.close();
