// The care rules on their own: time slots in India time, Hindi and colour aliases, red-flag words,
// refill maths and the weekly view.
import {strict as assert} from "node:assert";
import {describe, it} from "node:test";
import {routeWithRules} from "../src/brain.ts";
import {currentSlot, findMedicines, redFlagsIn, refillStatus, weeklySummary} from "../src/care.ts";
import {seedState, withHistory} from "../src/store.ts";

describe("care rules", () => {
    it("works out the slot in India time whatever the server timezone", () => {
        assert.equal(currentSlot(new Date("2026-10-21T02:00:00Z")), "morning"); // 07:30 IST
        assert.equal(currentSlot(new Date("2026-10-21T08:00:00Z")), "afternoon"); // 13:30 IST
        assert.equal(currentSlot(new Date("2026-10-21T16:00:00Z")), "night"); // 21:30 IST
    });

    it("matches medicines by brand, generic, colour and Hindi phrase", () => {
        const state = seedState();
        for (const said of ["Telma", "telmisartan", "BP ki dawai", "white oval"]) {
            assert.deepEqual(findMedicines(state, said).map((m) => m.id), ["telma-40"], said);
        }
        assert.deepEqual(findMedicines(state, "gulabi goli").map((m) => m.id), ["atorva-10"]);
        assert.deepEqual(findMedicines(state, "paracetamol"), []);
    });

    it("spots warning signs in English, Hinglish and Devanagari, and not in ordinary words", () => {
        assert.deepEqual(redFlagsIn("I fell in the bathroom"), ["fall"]);
        assert.deepEqual(redFlagsIn("seene mein dard hai"), ["chest pain"]);
        assert.deepEqual(redFlagsIn("सांस लेने में तकलीफ"), ["breathlessness"]);
        assert.deepEqual(redFlagsIn("main theek hoon, falooda khaya"), []);
    });

    it("orders refills by days left and flags five days or fewer", () => {
        const lines = refillStatus(seedState());
        assert.equal(lines[0].medicine.id, "telma-40");
        assert.equal(lines[0].daysLeft, 4);
        assert.equal(lines[0].low, true);
        assert.equal(lines.find((l) => l.medicine.id === "metformin-500")!.daysLeft, 13);
    });

    it("weekly summary counts the seeded history and does not call later slots today missed", () => {
        const now = new Date("2026-10-21T03:00:00Z"); // morning
        const week = weeklySummary(withHistory(seedState(), now), now);
        assert.equal(week.expected, 35);
        assert.equal(week.taken, 26); // 6 days x 5, minus 2 skipped nights x 2
        assert.ok(week.missed.every((m) => m.date !== "2026-10-21" || m.slot === "morning"));
    });

    it("routes everyday phrases without a model", () => {
        assert.equal(routeWithRules("Subah ki dawai kaunsi hai?", {}).calls[0].name, "get_due_doses");
        assert.deepEqual(routeWithRules("le li", {lastTool: "get_due_doses", dueMedicines: ["Telma 40", "Ecosprin 75"], dueSlot: "morning"}).calls,
            [{name: "log_dose", arguments: {medicine: "Telma 40", slot: "morning"}}, {name: "log_dose", arguments: {medicine: "Ecosprin 75", slot: "morning"}}]);
        assert.equal(routeWithRules("haan order karo", {pendingOrderId: "ord-1"}).calls[0].arguments.confirmed, true);
        assert.equal(routeWithRules("nahi", {pendingOrderId: "ord-1"}).calls[0].arguments.confirmed, false);
        assert.equal(routeWithRules("Amma ka hafta kaisa raha?", {}).calls[0].name, "weekly_summary");
    });
});
