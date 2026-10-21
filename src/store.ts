// Care-circle state for one household: the parent's medicines, every dose taken, daily check-ins,
// family alerts and refill orders. Kept in a JSON file so it survives across sessions (Alexa+ asks
// add-ons to remember context between conversations) and so the demo can be reset in one step.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname} from "node:path";

export type Slot = "morning" | "afternoon" | "night";

export interface Medicine {
    id: string;
    name: string;
    // Spoken and on-card description, so a parent who cannot read the strip can still find the tablet.
    looks: string;
    dose: string;
    slots: Slot[];
    instructions: string;
    // Words a parent may say instead of the brand name (Hindi, generic, colour), used to match "Telma le li".
    aliases: string[];
    stock: number;
    pricePerStrip: number;
    stripSize: number;
}

export interface DoseLog {medicineId: string; slot: Slot; date: string; at: string}
export interface CheckIn {date: string; at: string; feeling: string; redFlags: string[]}
export interface Alert {at: string; to: string; reason: string; message: string}
export interface Order {
    id: string;
    medicineId: string;
    strips: number;
    total: number;
    status: "awaiting_confirmation" | "confirmed" | "cancelled";
    createdAt: string;
    confirmedAt?: string;
}

export interface State {
    parent: {name: string; calledAs: string; city: string; language: string};
    family: {name: string; relation: string; contact: string}[];
    medicines: Medicine[];
    doses: DoseLog[];
    checkIns: CheckIn[];
    alerts: Alert[];
    orders: Order[];
}

export function seedState(): State {
    return {
        parent: {name: "Kamala Devi", calledAs: "Amma", city: "Mysuru", language: "hi-IN"},
        family: [{name: "Ravi", relation: "son", contact: "ravi@example.com"}],
        medicines: [
            {
                id: "telma-40", name: "Telma 40", looks: "white oval tablet", dose: "1 tablet",
                slots: ["morning"], instructions: "after breakfast",
                aliases: ["telma", "telmisartan", "bp tablet", "bp ki dawai", "white tablet"],
                stock: 4, pricePerStrip: 182, stripSize: 15,
            },
            {
                id: "ecosprin-75", name: "Ecosprin 75", looks: "small orange tablet", dose: "1 tablet",
                slots: ["morning"], instructions: "after breakfast",
                aliases: ["ecosprin", "aspirin", "orange tablet", "chhoti narangi goli"],
                stock: 21, pricePerStrip: 5, stripSize: 14,
            },
            {
                id: "metformin-500", name: "Glycomet 500", looks: "big white round tablet", dose: "1 tablet",
                slots: ["morning", "night"], instructions: "with food",
                aliases: ["glycomet", "metformin", "sugar tablet", "sugar ki dawai", "diabetes"],
                stock: 26, pricePerStrip: 25, stripSize: 10,
            },
            {
                id: "atorva-10", name: "Atorva 10", looks: "pink tablet", dose: "1 tablet",
                slots: ["night"], instructions: "after dinner",
                aliases: ["atorva", "atorvastatin", "cholesterol", "pink tablet", "gulabi goli"],
                stock: 9, pricePerStrip: 98, stripSize: 15,
            },
        ],
        doses: [],
        checkIns: [],
        alerts: [],
        orders: [],
    };
}

export class Store {
    private file: string | undefined;
    state: State;

    // Without a file the store lives in memory only, which is what the tests use.
    constructor(file?: string, now: Date = new Date()) {
        this.file = file;
        this.state = file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as State : withHistory(seedState(), now);
    }

    save(): void {
        if (!this.file) {
            return;
        }
        mkdirSync(dirname(this.file), {recursive: true});
        writeFileSync(this.file, JSON.stringify(this.state, null, 2));
    }

    reset(now: Date = new Date()): void {
        this.state = withHistory(seedState(), now);
        this.save();
    }
}

// Six past days of believable demo history: morning doses almost always taken, the night dose skipped
// on the two days she visits her sister, and one quiet check-in a day. Stock is left as seeded.
export function withHistory(state: State, now: Date): State {
    const IST = 330 * 60_000;
    const SLOT_TIME: Record<Slot, string> = {morning: "08:10", afternoon: "13:30", night: "21:15"};
    for (let back = 6; back >= 1; back--) {
        const day = new Date(now.getTime() + IST - back * 86_400_000).toISOString().slice(0, 10);
        const visitingSister = back === 4 || back === 2;
        for (const medicine of state.medicines) {
            for (const slot of medicine.slots) {
                if (slot === "night" && visitingSister) {
                    continue;
                }
                const at = new Date(`${day}T${SLOT_TIME[slot]}:00+05:30`).toISOString();
                state.doses.push({medicineId: medicine.id, slot, date: day, at});
            }
        }
        state.checkIns.push({date: day, at: new Date(`${day}T10:00:00+05:30`).toISOString(), feeling: "theek hoon", redFlags: []});
    }
    return state;
}
