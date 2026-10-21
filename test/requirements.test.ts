// Amma's Hour against Amazon's published Alexa+ add-on functional requirements
// (developer.amazon.com/docs/alexaplus/add-ons/functional-requirements.html). Each test names the
// requirement it checks and talks to the server through a real MCP client, as Alexa+ would.
import {strict as assert} from "node:assert";
import {after, before, beforeEach, describe, it} from "node:test";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import type {CallToolResult} from "@modelcontextprotocol/sdk/types.js";
import {routeWithRules} from "../src/brain.ts";
import {createMcpServer, DOSES_CARD, MCP_APP_MIME, WEEK_CARD} from "../src/mcp.ts";
import {Store} from "../src/store.ts";

// Wednesday 21 Oct 2026, 08:30 in India (03:00 UTC): morning slot.
let now = new Date("2026-10-21T03:00:00Z");
const clock = () => now;
let store: Store;
let client: Client;

async function connect(): Promise<void> {
    store = new Store(undefined, now);
    const server = createMcpServer(store, clock);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    client = new Client({name: "requirements-test", version: "1.0.0"});
    await client.connect(clientSide);
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult & {text: string}> {
    const result = await client.callTool({name, arguments: args}) as CallToolResult;
    return {...result, text: result.content.map((c) => (c.type === "text" ? c.text : "")).join(" ")};
}

const TOOLS = ["get_due_doses", "log_dose", "daily_checkin", "get_refill_status", "prepare_refill_order", "confirm_order", "get_help", "weekly_summary"];

describe("Alexa+ functional requirements", () => {
    before(connect);
    beforeEach(async () => {
        now = new Date("2026-10-21T03:00:00Z");
        await client.close();
        await connect();
    });
    after(() => client.close());

    it("13.1 every listed tool is invocable, none are placeholders", async () => {
        const {tools} = await client.listTools();
        assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOLS].sort());
        const args: Record<string, Record<string, unknown>> = {
            log_dose: {medicine: "telma"}, daily_checkin: {feeling: "theek hoon"},
            prepare_refill_order: {medicine: "atorva"}, confirm_order: {order_id: "ord-1", confirmed: false},
        };
        for (const tool of tools) {
            const result = await call(tool.name, args[tool.name] ?? {});
            assert.ok(result.text.length > 0, `${tool.name} said nothing`);
        }
    });

    it("13.2 every tool has an object inputSchema declaring its required parameters", async () => {
        const {tools} = await client.listTools();
        for (const tool of tools) {
            assert.equal(tool.inputSchema.type, "object", tool.name);
        }
        const required = Object.fromEntries(tools.map((t) => [t.name, (t.inputSchema.required ?? []).sort()]));
        assert.deepEqual(required.log_dose, ["medicine"]);
        assert.deepEqual(required.confirm_order, ["confirmed", "order_id"]);
        assert.deepEqual(required.daily_checkin, ["feeling"]);
    });

    it("13.3 / 13.8 invalid parameters are rejected with an MCP error, never acted on", async () => {
        const result = await call("prepare_refill_order", {medicine: "telma", strips: 50});
        assert.equal(result.isError, true);
        assert.equal(store.state.orders.length, 0);
    });

    it("13.5 failures use isError, not a malformed payload", async () => {
        const result = await call("log_dose", {medicine: "paracetamol"});
        assert.equal(result.isError, true);
    });

    it("13.6 the order id from prepare_refill_order is accepted by confirm_order", async () => {
        const prepared = await call("prepare_refill_order", {medicine: "Telma"});
        const orderId = (prepared.structuredContent as {orderId: string}).orderId;
        const confirmed = await call("confirm_order", {order_id: orderId, confirmed: true});
        assert.equal((confirmed.structuredContent as {status: string}).status, "confirmed");
    });

    it("13.7 / 13.10 tool descriptions are distinct and parameters list synonyms", async () => {
        const {tools} = await client.listTools();
        const descriptions = new Set(tools.map((t) => t.description));
        assert.equal(descriptions.size, tools.length);
        const medicine = (tools.find((t) => t.name === "log_dose")!.inputSchema.properties as Record<string, {description: string}>).medicine;
        assert.match(medicine.description, /generic/);
        assert.match(medicine.description, /BP ki dawai/);
    });

    it("2.2 / 9.5 spoken text never shows JSON, internal ids, tool names or screen references", async () => {
        const said = [
            await call("get_due_doses"), await call("log_dose", {medicine: "BP ki dawai"}),
            await call("log_dose", {medicine: "telma"}), await call("daily_checkin", {feeling: "chakkar aa raha hai"}),
            await call("get_refill_status"), await call("prepare_refill_order", {medicine: "telma"}),
            await call("confirm_order", {order_id: "ord-1", confirmed: true}), await call("weekly_summary"), await call("get_help"),
        ].map((r) => r.text);
        for (const text of said) {
            assert.doesNotMatch(text, /[{}[\]|]/, text);
            assert.doesNotMatch(text, /ord-\d|telma-40|_|tools?\/|isError/, text);
            assert.doesNotMatch(text, /\b(screen|card|button|tap|click)\b/i, text);
        }
    });

    it("2.3 / 2.5 an error gives a next step", async () => {
        const result = await call("log_dose", {medicine: "paracetamol"});
        assert.match(result.text, /\?$/);
    });

    it("4.2 'what can you do' returns a useful summary", async () => {
        const result = await call("get_help");
        assert.match(result.text, /medicines/);
        assert.match(result.text, /order a refill/);
    });

    it("1.2 context persists across sessions: a dose logged in one session is known in the next", async () => {
        await call("log_dose", {medicine: "telma"});
        const server = createMcpServer(store, clock);
        const [a, b] = InMemoryTransport.createLinkedPair();
        await server.connect(b);
        const second = new Client({name: "second-session", version: "1.0.0"});
        await second.connect(a);
        const result = await second.callTool({name: "log_dose", arguments: {medicine: "telma"}}) as CallToolResult;
        assert.equal((result.structuredContent as {status: string}).status, "duplicate");
        await second.close();
    });

    it("1.4 'start over' asks the client to clear its context", () => {
        const plan = routeWithRules("start over", {pendingOrderId: "ord-1", lastTool: "prepare_refill_order"});
        assert.equal(plan.reset, true);
        assert.equal(plan.calls.length, 0);
    });

    it("8.10 a duplicate dose is caught instead of logged twice", async () => {
        await call("log_dose", {medicine: "telma"});
        const again = await call("log_dose", {medicine: "white oval"});
        assert.match(again.text, /already took Telma 40/);
        assert.equal(store.state.doses.filter((d) => d.date === "2026-10-21").length, 1);
    });

    it("8.10 a second order for the same medicine on the same day is refused", async () => {
        await call("prepare_refill_order", {medicine: "telma"});
        await call("confirm_order", {order_id: "ord-1", confirmed: true});
        const again = await call("prepare_refill_order", {medicine: "telma"});
        assert.match(again.text, /already ordered today/);
        assert.equal(store.state.orders.length, 1);
    });

    it("8.12 / 8.16 / 9.3 nothing is bought before an explicit yes, and the full price is read out first", async () => {
        const prepared = await call("prepare_refill_order", {medicine: "telma", strips: 2});
        assert.match(prepared.text, /364 rupees including GST, delivery free, total 364 rupees/);
        assert.match(prepared.text, /Should I place the order\?$/);
        assert.equal(store.state.orders[0].status, "awaiting_confirmation");
        const stockBefore = store.state.medicines[0].stock;
        await call("confirm_order", {order_id: "ord-1", confirmed: false});
        assert.equal(store.state.orders[0].status, "cancelled");
        assert.equal(store.state.medicines[0].stock, stockBefore);
    });

    it("8.1 / 8.19 a confirmed order states its details and sends a written receipt to the family", async () => {
        await call("prepare_refill_order", {medicine: "telma"});
        const done = await call("confirm_order", {order_id: "ord-1", confirmed: true});
        assert.match(done.text, /Telma 40 is ordered for 182 rupees/);
        assert.match(done.text, /receipt to Ravi/);
    });

    it("9.2 never more than five options when disambiguating", async () => {
        const result = await call("log_dose", {medicine: "tablet"});
        const candidates = (result.structuredContent as {candidates: string[]}).candidates;
        assert.ok(candidates.length >= 2 && candidates.length <= 5);
    });

    it("safety: warning signs alert the family and never diagnose", async () => {
        const result = await call("daily_checkin", {feeling: "मुझे चक्कर आ रहा है"});
        assert.deepEqual((result.structuredContent as {redFlags: string[]}).redFlags, ["dizziness"]);
        assert.equal(store.state.alerts.length, 1);
        assert.match(result.text, /call 112/);
        const calm = await call("daily_checkin", {feeling: "theek hoon, bas thodi neend kam aayi"});
        assert.deepEqual((calm.structuredContent as {redFlags: string[]}).redFlags, []);
    });

    it("MCP Apps: card tools link ui:// resources served as text/html;profile=mcp-app", async () => {
        const {tools} = await client.listTools();
        assert.equal((tools.find((t) => t.name === "get_due_doses")!._meta as {ui: {resourceUri: string}}).ui.resourceUri, DOSES_CARD);
        assert.equal((tools.find((t) => t.name === "weekly_summary")!._meta as {ui: {resourceUri: string}}).ui.resourceUri, WEEK_CARD);
        for (const uri of [DOSES_CARD, WEEK_CARD]) {
            const resource = await client.readResource({uri});
            const content = resource.contents[0] as {mimeType: string; text: string};
            assert.equal(content.mimeType, MCP_APP_MIME);
            assert.match(content.text, /ui\/initialize/);
            assert.match(content.text, /ui\/notifications\/tool-result/);
        }
    });

    it("10.1 the card data matches what is spoken", async () => {
        const result = await call("get_due_doses");
        const doses = (result.structuredContent as {doses: {name: string}[]}).doses;
        for (const dose of doses) {
            assert.match(result.text, new RegExp(dose.name));
        }
    });
});
