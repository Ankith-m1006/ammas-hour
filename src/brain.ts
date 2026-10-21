// The simulator's "Alexa brain": turns what the user said into MCP tool calls. It only plans; the
// browser simulator makes the actual tools/call requests to the MCP server, like Alexa+ would.
// With GEMINI_API_KEY set it uses Gemini function calling over the tools from tools/list; without a
// key (or if the model fails) a small rule-based router keeps the demo working offline.

export interface ToolInfo {name: string; description?: string; inputSchema?: Record<string, unknown>}
export interface PlannedCall {name: string; arguments: Record<string, unknown>}
export interface Context {
    lastTool?: string;
    pendingOrderId?: string;
    dueMedicines?: string[];
    dueSlot?: string;
}
// reset asks the client to drop the conversation context (requirement 1.4, "start over").
export interface Plan {calls: PlannedCall[]; say?: string; reset?: boolean; via: "gemini" | "rules"}

const MODEL = process.env.AMMAS_HOUR_MODEL ?? "gemini-3.5-flash";

function has(text: string, words: string[]): boolean {
    return words.some((w) => new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "iu").test(text));
}

const YES = ["haan", "han", "ha", "yes", "yeah", "ok", "okay", "kar do", "karo", "order karo", "theek hai", "हाँ", "हां", "ठीक है"];
const NO = ["nahi", "nahin", "no", "mat karo", "cancel", "नहीं"];
const TOOK = ["le li", "li", "le liya", "kha li", "kha liya", "took", "taken", "have taken", "ली", "ले ली", "खा ली"];
const FEEL = ["feel", "feeling", "chakkar", "dard", "pain", "theek hoon", "thik hoon", "tabiyat", "fell", "gir", "saans", "dizzy", "behosh", "चक्कर", "दर्द", "तबीयत"];
const DUE = ["kaunsi", "konsi", "which", "what", "due", "kya leni", "batao", "कौनसी", "कौन सी"];
const REFILL = ["khatam", "run out", "running out", "refill", "stock", "kitni bachi", "low"];
const ORDER = ["order", "mangwa", "mangwao", "buy", "kharid"];
const WEEK = ["week", "hafta", "hafte", "how is amma", "how was", "summary", "kaisa raha"];

export function routeWithRules(utterance: string, context: Context): Plan {
    const said = utterance.trim();
    const slot = has(said, ["subah", "morning", "सुबह"]) ? "morning"
        : has(said, ["raat", "night", "tonight", "रात"]) ? "night"
        : has(said, ["dopahar", "afternoon", "दोपहर"]) ? "afternoon" : undefined;
    const withSlot = (args: Record<string, unknown>) => (slot ? {...args, slot} : args);

    if (has(said, ["start over", "shuru se", "phir se shuru", "reset"])) {
        return {calls: [], say: "Okay, starting fresh. What would you like to do?", reset: true, via: "rules"};
    }
    if (has(said, ["help", "what can you do", "kya kar sakti", "kya kar sakte"])) {
        return {calls: [{name: "get_help", arguments: {}}], via: "rules"};
    }
    if (context.pendingOrderId && has(said, YES)) {
        return {calls: [{name: "confirm_order", arguments: {order_id: context.pendingOrderId, confirmed: true}}], via: "rules"};
    }
    if (context.pendingOrderId && has(said, NO)) {
        return {calls: [{name: "confirm_order", arguments: {order_id: context.pendingOrderId, confirmed: false}}], via: "rules"};
    }
    if (has(said, WEEK)) {
        return {calls: [{name: "weekly_summary", arguments: {}}], via: "rules"};
    }
    if (has(said, ORDER)) {
        return {calls: [{name: "prepare_refill_order", arguments: {medicine: stripFiller(said, ORDER)}}], via: "rules"};
    }
    if (has(said, REFILL)) {
        return {calls: [{name: "get_refill_status", arguments: {}}], via: "rules"};
    }
    if (has(said, FEEL)) {
        return {calls: [{name: "daily_checkin", arguments: {feeling: said}}], via: "rules"};
    }
    if (has(said, TOOK)) {
        const named = stripFiller(said, TOOK);
        // "le li" right after the due list means all of them; otherwise log the one that was named.
        if (!named && context.lastTool === "get_due_doses" && context.dueMedicines?.length) {
            const dueSlot = slot ?? context.dueSlot;
            return {calls: context.dueMedicines.map((m) => ({name: "log_dose", arguments: dueSlot ? {medicine: m, slot: dueSlot} : {medicine: m}})), via: "rules"};
        }
        return {calls: [{name: "log_dose", arguments: withSlot({medicine: named || said})}], via: "rules"};
    }
    if (has(said, DUE) || has(said, ["dawai", "dawa", "medicine", "tablet", "goli", "दवाई"])) {
        return {calls: [{name: "get_due_doses", arguments: withSlot({})}], via: "rules"};
    }
    return {calls: [], say: "Sorry, I didn't get that. You can ask which medicines to take, or tell me how you feel.", via: "rules"};
}

function stripFiller(text: string, verbs: string[]): string {
    let out = ` ${text.toLowerCase()} `;
    for (const w of [...verbs, "maine", "mai", "main", "i", "ki", "ka", "ke", "wali", "dawai", "medicine", "please", "alexa", "my", "the", "a", "of", "for", "ko", "hai", "ho", "gayi", "gaya", "abhi", "now", "subah", "raat", "morning", "night"]) {
        out = out.replace(new RegExp(`(^|\\s)${w}(?=\\s|$)`, "giu"), " ");
    }
    return out.replace(/[.?!,]/g, " ").replace(/\s+/g, " ").trim();
}

export async function plan(utterance: string, tools: ToolInfo[], context: Context, apiKey = process.env.GEMINI_API_KEY): Promise<Plan> {
    if (!apiKey || has(utterance, ["start over", "shuru se", "phir se shuru"])) {
        return routeWithRules(utterance, context);
    }
    try {
        const system =
            "You are the routing brain of an Alexa+ device for an elderly Indian parent (Hindi, English or Hinglish). " +
            "Pick the tool calls that serve what they just said. Use the parent's own words for medicine names and feelings. " +
            "If they said 'le li' or 'took them' right after the due list, log each due medicine with context.dueSlot as the slot. " +
            "Only call confirm_order with confirmed=true when they clearly said yes to a pending order. " +
            `Context: ${JSON.stringify(context)}. If no tool fits, reply briefly in their language without calling a tool.`;
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
            method: "POST",
            headers: {"Content-Type": "application/json", "x-goog-api-key": apiKey},
            body: JSON.stringify({
                systemInstruction: {parts: [{text: system}]},
                contents: [{role: "user", parts: [{text: utterance}]}],
                tools: [{functionDeclarations: tools.map((t) => ({name: t.name, description: t.description ?? "", parametersJsonSchema: t.inputSchema ?? {type: "object"}}))}],
                generationConfig: {temperature: 0},
            }),
            signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
            throw new Error(`Gemini ${response.status}`);
        }
        const data = await response.json() as {candidates?: {content?: {parts?: {text?: string; functionCall?: {name: string; args?: Record<string, unknown>}}[]}}[]};
        const parts = data.candidates?.[0]?.content?.parts ?? [];
        const calls = parts.filter((p) => p.functionCall).map((p) => ({name: p.functionCall!.name, arguments: p.functionCall!.args ?? {}}));
        const say = parts.map((p) => p.text).filter(Boolean).join(" ").trim();
        if (calls.length === 0 && !say) {
            return routeWithRules(utterance, context);
        }
        return {calls, say: say || undefined, via: "gemini"};
    } catch {
        return routeWithRules(utterance, context);
    }
}
