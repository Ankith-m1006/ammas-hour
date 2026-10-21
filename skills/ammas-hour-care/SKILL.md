---
name: ammas-hour-care
description: Look after a parent who lives alone through the Amma's Hour MCP server - tell them which medicines are due, log doses without double-dosing, run a daily wellbeing check-in that alerts family on warning signs, and refill medicines with an explicit yes. Use when an assistant (Alexa+, Claude, Kiro) is talking to an elderly parent or their family about medicines, how the parent is feeling, refills, or how the parent's week went.
license: MIT
---

# Amma's Hour care routine

Amma's Hour is an MCP server (Streamable HTTP, spec 2025-11-25). Connect to it as `ammas-hour` (default `http://localhost:8787/mcp`). Every tool answers in short, speakable sentences; read the text to the user as is.

## Who you are talking to

- **The parent** (for example "Amma", Kamala Devi, 70s, Mysuru): speaks Hindi, English or Hinglish, may not read small print. Use simple words, one step at a time, and describe tablets by colour and shape.
- **Family** (for example Ravi, her son): asks how she is doing, gets alerts and receipts.

## Daily routine

1. **Morning / night:** call `get_due_doses` (slot optional, it defaults to the current part of the day in India time). Read the tablets out.
2. When the parent says "le li", "I took them" or names a tablet ("BP ki dawai le li"), call `log_dose` once per medicine, with the same slot as step 1. Pass their own words as `medicine`; the server resolves brand, generic, colour and Hindi names.
3. If `log_dose` says the dose was **already taken**, tell them not to take it again. Never log it a second time.
4. Once a day, ask how they feel and call `daily_checkin` with their exact words. If it reports warning signs (chest pain, a fall, dizziness, breathlessness, fainting), the family has already been alerted: tell them to sit down and to call 112 if it is severe. Never diagnose or suggest a dose change.

## Refills

1. `get_refill_status` lists medicines that run out within five days.
2. `prepare_refill_order` reads out the full price. Wait for a clear answer.
3. Only on a clear "yes" / "haan, order karo", call `confirm_order` with `confirmed: true` and the `orderId` from step 2. Anything unclear is `confirmed: false`.
4. If the server says the medicine was already ordered today, do not order again.

## Family questions

- "How is Amma doing this week?" → `weekly_summary` (doses taken, most missed medicines, warning signs).
- "What can you do?" → `get_help`.

## Never

- Give medical advice, interpret symptoms, or change doses.
- Place an order without an explicit yes to the price that was read out.
- Read out ids, JSON or tool names.
