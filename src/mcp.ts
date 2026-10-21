// The Alexa+ add-on surface: an MCP server (spec 2025-11-25) whose tools speak in short, voice-ready
// sentences (no JSON, no lists longer than five) and attach MCP Apps cards for screen devices.
import {readFileSync} from "node:fs";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {CallToolResult} from "@modelcontextprotocol/sdk/types.js";
import {z} from "zod";
import {checkIn, confirmOrder, currentSlot, dueDoses, findMedicines, istParts, logDose, prepareOrder, recentOrder, refillStatus, weeklySummary} from "./care.ts";
import type {Slot} from "./store.ts";
import {Store} from "./store.ts";

export const MCP_APP_MIME = "text/html;profile=mcp-app";
export const DOSES_CARD = "ui://ammas-hour/doses-card.html";
export const WEEK_CARD = "ui://ammas-hour/week-card.html";

const SLOT_WORDS: Record<Slot, string> = {morning: "morning", afternoon: "afternoon", night: "night"};
const slotSchema = z.enum(["morning", "afternoon", "night"]);

function say(text: string, structured?: Record<string, unknown>): CallToolResult {
    return {content: [{type: "text", text}], ...(structured ? {structuredContent: structured} : {})};
}

function sayError(text: string): CallToolResult {
    return {content: [{type: "text", text}], isError: true};
}

function joinSpoken(items: string[]): string {
    return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function cardHtml(file: string): string {
    return readFileSync(new URL(`../ui/${file}`, import.meta.url), "utf8");
}

export function createMcpServer(store: Store, clock: () => Date = () => new Date()): McpServer {
    const server = new McpServer(
        {name: "ammas-hour", title: "Amma's Hour", version: "0.1.0"},
        {
            instructions:
                "Amma's Hour helps a parent who lives alone take their medicines on time, check in each day and " +
                "refill before running out, and keeps their family informed. Speak simply and warmly, one step at a time. " +
                "Never give medical advice or change a dose; for anything worrying, tell them to call their family or a doctor.",
        },
    );
    const {state} = store;

    server.registerResource("Doses card", DOSES_CARD, {mimeType: MCP_APP_MIME, description: "Pill card for the doses due now"}, async () => ({
        contents: [{uri: DOSES_CARD, mimeType: MCP_APP_MIME, text: cardHtml("doses-card.html")}],
    }));
    server.registerResource("Week card", WEEK_CARD, {mimeType: MCP_APP_MIME, description: "Seven-day adherence chart"}, async () => ({
        contents: [{uri: WEEK_CARD, mimeType: MCP_APP_MIME, text: cardHtml("week-card.html")}],
    }));

    server.registerTool(
        "get_due_doses",
        {
            title: "Medicines due now",
            description:
                "Tells the parent which medicines to take now (or for a given part of the day), what each tablet looks like " +
                "and how to take it, and which ones are already taken today. Use for 'subah ki dawai kaunsi hai?', " +
                "'what do I take tonight?', 'did I take my medicines?'.",
            inputSchema: {slot: slotSchema.optional().describe("Part of the day; defaults to the current one in India time.")},
            annotations: {readOnlyHint: true, openWorldHint: false},
            _meta: {ui: {resourceUri: DOSES_CARD}, "ui/resourceUri": DOSES_CARD},
        },
        async ({slot}) => {
            const when = slot ?? currentSlot(clock());
            const doses = dueDoses(state, when, clock());
            if (doses.length === 0) {
                return say(`There are no medicines for the ${SLOT_WORDS[when]}.`, {slot: when, doses: []});
            }
            const left = doses.filter((d) => !d.taken);
            const text = left.length === 0
                ? `All ${SLOT_WORDS[when]} medicines are taken. Well done.`
                : `For the ${SLOT_WORDS[when]}, ${left.length} ${left.length === 1 ? "tablet" : "tablets"}. ${left.map((d) => `${d.medicine.name}, the ${d.medicine.looks}, ${d.medicine.instructions}.`).join(" ")}` +
                  (left.length < doses.length ? ` ${doses.length - left.length} already taken.` : "") +
                  " Tell me when you've taken them.";
            return say(text, {
                slot: when,
                doses: doses.map((d) => ({
                    id: d.medicine.id, name: d.medicine.name, looks: d.medicine.looks, dose: d.medicine.dose,
                    instructions: d.medicine.instructions, taken: d.taken, takenAt: d.takenAt ?? null,
                })),
            });
        },
    );

    server.registerTool(
        "log_dose",
        {
            title: "I took my medicine",
            description:
                "Records that the parent took a medicine, e.g. 'le li', 'I took Telma', 'BP ki dawai le li'. " +
                "Catches a second dose of the same medicine in the same part of the day and says so instead of logging it twice.",
            inputSchema: {
                medicine: z.string().min(1).describe(
                    "The medicine as the parent said it: brand (Telma), generic (telmisartan), colour ('white tablet') " +
                    "or a Hindi phrase ('BP ki dawai', 'sugar ki dawai', 'gulabi goli').",
                ),
                slot: slotSchema.optional().describe("Part of the day; defaults to the current one."),
            },
            annotations: {readOnlyHint: false, idempotentHint: true, openWorldHint: false},
        },
        async ({medicine, slot}) => {
            const when = slot ?? currentSlot(clock());
            const result = logDose(state, medicine, when, clock());
            switch (result.status) {
                case "unknown":
                    return sayError(`I couldn't find "${medicine}" in her medicine list. Which tablet was it?`);
                case "ambiguous":
                    return say(`Which one: ${joinSpoken(result.candidates.map((m) => `${m.name}, the ${m.looks}`))}?`, {
                        status: "ambiguous", candidates: result.candidates.map((m) => m.name),
                    });
                case "not_scheduled":
                    return say(`${result.medicine.name} isn't due in the ${SLOT_WORDS[when]}. It's for the ${joinSpoken(result.medicine.slots)}.`, {
                        status: "not_scheduled", medicine: result.medicine.name,
                    });
                case "duplicate":
                    return say(`You already took ${result.medicine.name} this ${SLOT_WORDS[when]} at ${result.takenAt}. Please don't take it again.`, {
                        status: "duplicate", medicine: result.medicine.name, takenAt: result.takenAt,
                    });
                case "logged":
                    store.save();
                    return say(`Noted, ${result.medicine.name} taken.`, {
                        status: "logged", medicine: result.medicine.name, slot: when, stockLeft: result.stockLeft,
                    });
            }
        },
    );

    server.registerTool(
        "daily_checkin",
        {
            title: "How are you feeling today?",
            description:
                "Saves how the parent is feeling today. If they mention a warning sign such as chest pain, a fall, " +
                "dizziness (chakkar), breathlessness or fainting, their family is alerted right away. It never diagnoses.",
            inputSchema: {feeling: z.string().min(1).describe("What the parent said about how they feel, in their own words.")},
            annotations: {readOnlyHint: false, openWorldHint: true},
        },
        async ({feeling}) => {
            const {checkIn: entry, alerts} = checkIn(state, feeling, clock());
            store.save();
            if (entry.redFlags.length === 0) {
                return say("Thank you for telling me. I've noted it for today.", {redFlags: [], alerted: []});
            }
            const family = state.family.map((f) => f.name);
            return say(
                `I've told ${joinSpoken(family)}. Please sit down and rest. If it is severe or you feel worse, call 112 now.`,
                {redFlags: entry.redFlags, alerted: alerts.map((a) => a.to)},
            );
        },
    );

    server.registerTool(
        "get_refill_status",
        {
            title: "Medicines running low",
            description: "Says which medicines will run out soon, with days left, so a refill can be ordered in time.",
            annotations: {readOnlyHint: true, openWorldHint: false},
        },
        async () => {
            const lines = refillStatus(state);
            const low = lines.filter((l) => l.low);
            const text = low.length === 0
                ? "All medicines are fine for at least the next week."
                : `${joinSpoken(low.slice(0, 5).map((l) => `${l.medicine.name} runs out in ${l.daysLeft} ${l.daysLeft === 1 ? "day" : "days"}`))}. Shall I prepare a refill?`;
            return say(text, {medicines: lines.map((l) => ({name: l.medicine.name, daysLeft: l.daysLeft, low: l.low}))});
        },
    );

    server.registerTool(
        "prepare_refill_order",
        {
            title: "Prepare a refill",
            description:
                "Prepares a refill order and reads out the price. Nothing is ordered until the parent clearly says yes " +
                "and confirm_order is called with that answer.",
            inputSchema: {
                medicine: z.string().min(1).describe("The medicine to refill, as the parent said it: brand, generic, colour or Hindi name."),
                strips: z.number().int().min(1).max(5).optional().describe("Number of strips, 1 to 5; defaults to 1."),
            },
            annotations: {readOnlyHint: false, idempotentHint: true, openWorldHint: false},
        },
        async ({medicine, strips}) => {
            const matches = findMedicines(state, medicine);
            if (matches.length !== 1) {
                return matches.length === 0
                    ? sayError(`I couldn't find "${medicine}" in her medicine list.`)
                    : say(`Which one should I refill: ${joinSpoken(matches.slice(0, 5).map((m) => m.name))}?`, {status: "ambiguous"});
            }
            const recent = recentOrder(state, matches[0], clock());
            if (recent) {
                return say(
                    `${matches[0].name} was already ordered today at ${istParts(new Date(recent.confirmedAt!)).time}, so I won't order it again. ` +
                    "Do you want to change that order instead?",
                    {status: "already_ordered", medicine: matches[0].name},
                );
            }
            const order = prepareOrder(state, matches[0], strips ?? 1, clock());
            store.save();
            return say(
                `${order.strips} ${order.strips === 1 ? "strip" : "strips"} of ${matches[0].name}, ${order.strips * matches[0].stripSize} tablets: ` +
                `${order.total} rupees including GST, delivery free, total ${order.total} rupees, paid on delivery. Should I place the order?`,
                {orderId: order.id, medicine: matches[0].name, strips: order.strips, total: order.total, currency: "INR", status: order.status},
            );
        },
    );

    server.registerTool(
        "confirm_order",
        {
            title: "Place or cancel the refill",
            description:
                "Places or cancels a prepared refill. Only call it with confirmed true after the parent clearly said yes " +
                "to the price read out by prepare_refill_order; anything unclear means confirmed false.",
            inputSchema: {
                order_id: z.string().min(1).describe("The orderId returned by prepare_refill_order."),
                confirmed: z.boolean().describe("True only for a clear yes."),
            },
            annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true},
        },
        async ({order_id, confirmed}) => {
            const result = confirmOrder(state, order_id, confirmed, clock());
            if (result.status === "not_found") {
                return sayError("I couldn't find that order. Shall I prepare it again?");
            }
            if (result.status === "already_done") {
                return say(`That order was already ${result.order.status}.`, {orderId: result.order.id, status: result.order.status});
            }
            store.save();
            return result.status === "cancelled"
                ? say("Okay, I haven't ordered anything.", {orderId: result.order.id, status: "cancelled"})
                : say(`Done. ${result.medicine.name} is ordered for ${result.order.total} rupees, and I've sent the receipt to ${joinSpoken(state.family.map((f) => f.name))}.`, {
                    orderId: result.order.id, status: "confirmed", total: result.order.total,
                });
        },
    );

    server.registerTool(
        "get_help",
        {
            title: "What can you do?",
            description: "Says what Amma's Hour can do, with a few example phrases. Use for 'what can you do?', 'help', 'aap kya kar sakti ho?'.",
            annotations: {readOnlyHint: true, openWorldHint: false},
        },
        async () => say(
            `I help ${state.parent.calledAs} with her medicines and keep ${joinSpoken(state.family.map((f) => f.name))} informed. ` +
            "You can ask which medicines to take now, tell me when you've taken them, tell me how you feel, " +
            "ask which medicines are running out, or order a refill. Family can ask how her week went.",
        ),
    );

    server.registerTool(
        "weekly_summary",
        {
            title: "How was the week?",
            description:
                "For the family: how many doses the parent took over the last seven days, which were missed, and any warning " +
                "signs from the check-ins. Use for 'how is Amma doing this week?'.",
            annotations: {readOnlyHint: true, openWorldHint: false},
            _meta: {ui: {resourceUri: WEEK_CARD}, "ui/resourceUri": WEEK_CARD},
        },
        async () => {
            const week = weeklySummary(state, clock());
            const percent = week.expected === 0 ? 100 : Math.round((week.taken / week.expected) * 100);
            const flags = week.days.flatMap((d) => d.redFlags);
            const missedNames = [...new Set(week.missed.map((m) => m.medicine))];
            const text =
                `${state.parent.calledAs} took ${week.taken} of ${week.expected} doses this week, ${percent} percent.` +
                (missedNames.length > 0 ? ` Most missed: ${joinSpoken(missedNames.slice(0, 3))}.` : "") +
                (flags.length > 0 ? ` She mentioned ${joinSpoken([...new Set(flags)])} this week.` : " No warning signs this week.");
            return say(text, {parent: state.parent.calledAs, percent, ...week, missed: week.missed.slice(0, 20)});
        },
    );

    return server;
}

