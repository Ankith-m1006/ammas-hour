// The care rules, kept free of MCP so they can be tested directly: which doses are due, matching a
// spoken medicine name, the duplicate-dose guard, red-flag check-ins, refills and the weekly view.
import type {Alert, CheckIn, Medicine, Order, Slot, State} from "./store.ts";

const IST_OFFSET_MINUTES = 330;
const LOW_STOCK_DAYS = 5;
const SLOTS: Slot[] = ["morning", "afternoon", "night"];

// Times are handled in India Standard Time, where the parent lives, whatever the server's timezone.
export function istParts(now: Date): {date: string; hour: number; time: string} {
    const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
    const iso = ist.toISOString();
    return {date: iso.slice(0, 10), hour: ist.getUTCHours(), time: iso.slice(11, 16)};
}

export function currentSlot(now: Date): Slot {
    const {hour} = istParts(now);
    if (hour >= 4 && hour < 12) {
        return "morning";
    }
    return hour >= 12 && hour < 17 ? "afternoon" : "night";
}

export function isSlot(value: string | undefined): value is Slot {
    return value !== undefined && (SLOTS as string[]).includes(value);
}

export interface DueDose {medicine: Medicine; taken: boolean; takenAt?: string}

export function dueDoses(state: State, slot: Slot, now: Date): DueDose[] {
    const {date} = istParts(now);
    return state.medicines
        .filter((m) => m.slots.includes(slot))
        .map((medicine) => {
            const log = state.doses.find((d) => d.medicineId === medicine.id && d.slot === slot && d.date === date);
            return {medicine, taken: Boolean(log), takenAt: log ? istParts(new Date(log.at)).time : undefined};
        });
}

function normalise(text: string): string {
    return text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9ऀ-ॿ ]+/g, " ").replace(/\s+/g, " ").trim();
}

// Matches what the parent said against names and aliases; "telma", "BP ki dawai" and "white tablet" all
// resolve, and an unclear phrase returns every candidate so the assistant can ask instead of guessing.
export function findMedicines(state: State, spoken: string): Medicine[] {
    const said = normalise(spoken);
    if (!said) {
        return [];
    }
    const exact = state.medicines.filter((m) => [m.name, m.id, ...m.aliases].some((n) => normalise(n) === said));
    if (exact.length > 0) {
        return exact;
    }
    return state.medicines.filter((m) =>
        [m.name, ...m.aliases].some((n) => {
            const name = normalise(n);
            return said.includes(name) || name.includes(said);
        }),
    );
}

export type LogResult =
    | {status: "logged"; medicine: Medicine; slot: Slot; stockLeft: number}
    | {status: "duplicate"; medicine: Medicine; slot: Slot; takenAt: string}
    | {status: "not_scheduled"; medicine: Medicine; slot: Slot}
    | {status: "ambiguous"; candidates: Medicine[]}
    | {status: "unknown"};

export function logDose(state: State, spoken: string, slot: Slot, now: Date): LogResult {
    const matches = findMedicines(state, spoken);
    if (matches.length === 0) {
        return {status: "unknown"};
    }
    if (matches.length > 1) {
        return {status: "ambiguous", candidates: matches.slice(0, 5)};
    }
    const medicine = matches[0];
    if (!medicine.slots.includes(slot)) {
        return {status: "not_scheduled", medicine, slot};
    }
    const {date} = istParts(now);
    const already = state.doses.find((d) => d.medicineId === medicine.id && d.slot === slot && d.date === date);
    if (already) {
        return {status: "duplicate", medicine, slot, takenAt: istParts(new Date(already.at)).time};
    }
    state.doses.push({medicineId: medicine.id, slot, date, at: now.toISOString()});
    medicine.stock = Math.max(0, medicine.stock - 1);
    return {status: "logged", medicine, slot, stockLeft: medicine.stock};
}

// Words that mean the family should hear about it today. Matched on whole words in English and in
// romanised and Devanagari Hindi; the add-on never interprets symptoms beyond raising the alert.
const RED_FLAGS: {flag: string; words: string[]}[] = [
    {flag: "chest pain", words: ["chest pain", "seene mein dard", "seene me dard", "chhati mein dard", "सीने में दर्द"]},
    {flag: "fall", words: ["fell", "fall", "fallen", "gir gayi", "gir gaya", "gir gai", "गिर गई", "गिर गया"]},
    {flag: "dizziness", words: ["dizzy", "dizziness", "chakkar", "चक्कर"]},
    {flag: "breathlessness", words: ["breathless", "can't breathe", "cannot breathe", "saans", "सांस"]},
    {flag: "fainting", words: ["fainted", "faint", "behosh", "बेहोश"]},
    {flag: "missed medicines", words: ["no medicine", "dawai khatam", "दवाई खत्म"]},
];

export function redFlagsIn(feeling: string): string[] {
    const said = ` ${normalise(feeling)} `;
    return RED_FLAGS.filter(({words}) => words.some((w) => said.includes(` ${normalise(w)} `))).map(({flag}) => flag);
}

export function checkIn(state: State, feeling: string, now: Date): {checkIn: CheckIn; alerts: Alert[]} {
    const {date} = istParts(now);
    const redFlags = redFlagsIn(feeling);
    const entry: CheckIn = {date, at: now.toISOString(), feeling, redFlags};
    state.checkIns.push(entry);
    const alerts = redFlags.length === 0 ? [] : state.family.map((member) => ({
        at: now.toISOString(),
        to: member.contact,
        reason: redFlags.join(", "),
        message: `${state.parent.calledAs} said "${feeling}" at ${istParts(now).time} today (${redFlags.join(", ")}). Please call her.`,
    }));
    state.alerts.push(...alerts);
    return {checkIn: entry, alerts};
}

export interface RefillLine {medicine: Medicine; dosesPerDay: number; daysLeft: number; low: boolean}

export function refillStatus(state: State): RefillLine[] {
    return state.medicines
        .map((medicine) => {
            const dosesPerDay = medicine.slots.length;
            const daysLeft = Math.floor(medicine.stock / dosesPerDay);
            return {medicine, dosesPerDay, daysLeft, low: daysLeft <= LOW_STOCK_DAYS};
        })
        .sort((a, b) => a.daysLeft - b.daysLeft);
}

export function prepareOrder(state: State, medicine: Medicine, strips: number, now: Date): Order {
    // Only one order per medicine waits for a yes at a time, so a repeated request can't double-order.
    const pending = state.orders.find((o) => o.medicineId === medicine.id && o.status === "awaiting_confirmation");
    if (pending) {
        return pending;
    }
    const order: Order = {
        id: `ord-${state.orders.length + 1}`,
        medicineId: medicine.id,
        strips,
        total: strips * medicine.pricePerStrip,
        status: "awaiting_confirmation",
        createdAt: now.toISOString(),
    };
    state.orders.push(order);
    return order;
}

export type ConfirmResult =
    | {status: "confirmed" | "cancelled"; order: Order; medicine: Medicine}
    | {status: "not_found"}
    | {status: "already_done"; order: Order};

export function confirmOrder(state: State, orderId: string, confirmed: boolean, now: Date): ConfirmResult {
    const order = state.orders.find((o) => o.id === orderId);
    if (!order) {
        return {status: "not_found"};
    }
    if (order.status !== "awaiting_confirmation") {
        return {status: "already_done", order};
    }
    const medicine = state.medicines.find((m) => m.id === order.medicineId)!;
    if (!confirmed) {
        order.status = "cancelled";
        return {status: "cancelled", order, medicine};
    }
    order.status = "confirmed";
    order.confirmedAt = now.toISOString();
    medicine.stock += order.strips * medicine.stripSize;
    return {status: "confirmed", order, medicine};
}

export interface DaySummary {date: string; expected: number; taken: number; redFlags: string[]}

export function weeklySummary(state: State, now: Date): {days: DaySummary[]; expected: number; taken: number; missed: {date: string; medicine: string; slot: Slot}[]} {
    const expectedPerDay = state.medicines.reduce((sum, m) => sum + m.slots.length, 0);
    const days: DaySummary[] = [];
    const missed: {date: string; medicine: string; slot: Slot}[] = [];
    for (let back = 6; back >= 0; back--) {
        const {date} = istParts(new Date(now.getTime() - back * 86_400_000));
        const taken = state.doses.filter((d) => d.date === date).length;
        const redFlags = state.checkIns.filter((c) => c.date === date).flatMap((c) => c.redFlags);
        days.push({date, expected: expectedPerDay, taken, redFlags});
        for (const m of state.medicines) {
            for (const slot of m.slots) {
                // Today's later slots are not missed yet.
                const notDueYet = back === 0 && SLOTS.indexOf(slot) >= SLOTS.indexOf(currentSlot(now));
                if (!notDueYet && !state.doses.some((d) => d.date === date && d.medicineId === m.id && d.slot === slot)) {
                    missed.push({date, medicine: m.name, slot});
                }
            }
        }
    }
    return {
        days,
        expected: days.reduce((s, d) => s + d.expected, 0),
        taken: days.reduce((s, d) => s + d.taken, 0),
        missed,
    };
}
