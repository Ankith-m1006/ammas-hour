# Devpost submission pack: Amma's Hour (Alexa+ track)

Deadline: Fri 23 Oct 2026, 12:00 PT = **Sat 24 Oct 00:30 IST**. Target: submit by Fri 23 Oct 20:00 IST.

## Fields

**Project name:** Amma's Hour

**Tagline (short):** An Alexa+ add-on that helps parents who live alone take their medicines, stay safe and refill on time, in Hindi or English, and keeps their children in the loop.

**Track:** Alexa+ · **Mini challenge:** Open Source (public MIT repo created during the window; the Echo Show simulator in `ui/simulator.html` is a reusable, open MCP client + MCP Apps host for anyone building Alexa+ add-ons without partner access).

**Built with:** Alexa+ add-on model (self-hosted MCP server), Model Context Protocol 2025-11-25, Streamable HTTP, MCP Apps (SEP-1865), Agent Skills (SKILL.md), @modelcontextprotocol/sdk, TypeScript, Node.js 24, zod, Web Speech API (hi-IN / en-IN), Google Gemini (simulator routing only).

**Repo:** https://github.com/Ankith-m1006/ammas-hour (MIT, public)

**Video:** (YouTube link, under 3:00, English or Hindi with English subtitles)

### Description

**Inspiration.** In India, millions of parents in their 60s and 70s live alone in their home towns while their children work in other cities. They take three to six tablets a day, can't read the small print on strips, and their children call every day to ask the same thing: *did you take your tablet?* Alexa+ arrived in Indian homes in September 2026, in Hindi, English and Hinglish. Voice is the one interface that works for this parent: ageing eyes, arthritic fingers, and a moment ("le li", I took it) that happens in the kitchen, nowhere near a screen.

**What it does.** Amma's Hour is an Alexa+ add-on, built as a self-hosted MCP server. The parent asks "subah ki dawai kaunsi hai?" and hears each tablet by name, colour and how to take it, with a pill card on Echo Show. "Le li" logs the doses, and a second dose of the same tablet in the same part of the day is refused before it happens. A daily check-in listens for warning signs (chest pain, a fall, dizziness, breathlessness, fainting) in English, Hinglish or Devanagari and alerts the family immediately, without ever diagnosing. When a medicine is about to run out, it reads the full price of a refill and only orders after an explicit yes, then sends the receipt to the family. The son in Bengaluru asks "How is Amma doing this week?" and gets her adherence, the medicines she misses most and any warning signs, with a chart on screen.

**How we built it.** A TypeScript MCP server on the official SDK implements MCP 2025-11-25 over Streamable HTTP with sessions. Eight tools speak in short, voice-ready sentences and return structured content; two of them link MCP Apps cards (`ui://` resources, `text/html;profile=mcp-app`) that render on screen devices through the MCP Apps handshake. The care rules (India-time slots, brand/generic/colour/Hindi name matching, duplicate guard, red flags, refills, weekly view) are pure functions with persistent state. Because the Alexa+ Web Simulator and Local Inspector are partner-only, we built an Echo Show simulator that is a real MCP client (initialize, tools/list, tools/call, resources/read) and a real MCP Apps host, with Hindi and English voice; it uses Gemini function calling over the server's tool list to route free speech (with an offline rule router), while every action is a genuine tools/call. An Agent Skill packages the care routine for Claude, Kiro or any agent. A test suite of 25 tests talks to the server through an MCP client and is named after Amazon's published Alexa+ functional requirements (13.1-13.10 tool validation, 2.2 no JSON or ids in speech, 8.10 duplicates, 8.12/8.16 explicit yes after the full price, 9.2 at most five options, 6.4 401 on an invalid token, and more).

**Challenges.** Building blind: no participant can connect a self-hosted MCP server to Alexa+ or run the official inspector, so the published functional requirements became our test oracle and the simulator our client. Hindi medicine names: parents say "BP ki dawai" or "gulabi goli", not "Telmisartan 40 mg", so every medicine carries aliases and a description of how it looks. Safety: the add-on is about adherence and family connection, never medical advice.

**Accomplishments.** A complete daily loop (doses → check-in → refill → family summary) that works end to end by voice in Hindi and English; a double-dose guard; MCP Apps cards that match what is spoken; 25 passing tests mapped to Amazon's requirements; an open simulator other builders can use.

**What we learned.** Writing for the ear is different: short sentences, colours instead of drug names, one question at a time, and never more than five options. And a spec you can't run against is still a spec: turning Amazon's requirement list into tests caught real bugs (a tablet described as "white oval" didn't match; "le li" after the morning list logged into the wrong slot).

**What's next.** A real pharmacy partner and SMS/WhatsApp for family alerts; prescription photo → schedule; caregivers' shared view; more Indian languages (Kannada, Tamil, Bengali) once Alexa+ supports them; a pilot with real families (with consent).

### Product feedback (required)

- **Alexa+ add-on docs (MCP Toolkit, functional requirements, display modes):** Clear and genuinely useful: the functional requirements list doubled as our test plan. What needs work: the Web Simulator, Local Inspector and MCP Toolkit are partner-only, and several doc pages don't say so up front; for hackathon builders a hosted linter (send your server URL, get the certification verdict) would remove most of the guesswork. Would build again: yes.
- **Model Context Protocol SDK (TypeScript, 1.32.1):** Streamable HTTP with sessions worked first time; zod schemas give validation and `isError` for free. Friction: none in the server path. Would build again: yes.
- **MCP Apps (`@modelcontextprotocol/ext-apps` 2.0.3):** The postMessage protocol (ui/initialize → tool-result) is simple and worked in our own host. Friction: the 2.0 server helpers import the v2 split packages, so with the current stable SDK 1.x we set `_meta.ui.resourceUri` and the MIME type by hand; a note in the README would help. Would build again: yes.
- **Agent Skills (SKILL.md):** Easy to write; a validator for the frontmatter would be welcome.
- **Gemini function calling (simulator brain):** Picked the right tool and arguments for Hindi/Hinglish utterances, including multi-call "le li" after a list. Would use again.

### Feature requests

- Critical: public access to the Alexa+ Local Inspector or a hosted certification check for non-partner developers.
- Important: an official browser-based Alexa+ client that accepts a self-hosted MCP URL (even text-only), for testing outside the US.
- Nice-to-have: en-IN / hi-IN sample utterance sets in the add-on design guide.

### Friction log
See `FRICTION_LOG.md` in the repo (paste its entries into the optional friction-log field).

## Video script (target 2:45)

1. **0:00-0:15 Problem.** Text on screen: "Did you take your tablet?" (the call every child makes). One line: millions of Indian parents live alone; Alexa+ just arrived in Hindi.
2. **0:15-1:20 Morning, in Hindi (simulator, Echo Show 10):** "Alexa, subah ki dawai kaunsi hai?" → pill card. "Le li" → three doses logged. "Maine sugar ki dawai le li" → "You already took Glycomet 500… please don't take it again."
3. **1:20-1:45 Check-in:** "Thoda chakkar aa raha hai" → safety line; Ravi's phone shows the alert.
4. **1:45-2:10 Refill:** "Kaunsi dawai khatam ho rahi hai?" → "Telma runs out in 4 days." "Telma mangwa do" → full price. "Haan, order karo" → ordered, receipt on Ravi's phone.
5. **2:10-2:25 Family:** switch to English: "How is Amma doing this week?" → chart.
6. **2:25-2:45 How it's built:** MCP traffic panel visible (initialize, tools/call over Streamable HTTP 2025-11-25), MCP Apps, Agent Skill, `npm test` → 25 passing, named after Amazon's requirements. Close: "Alexa+ came to India in Hindi this year. This is the add-on our parents need."

Record: OBS at 1920x1080, browser at 100%, voice through the mic (Wispr not needed here), English subtitles. No copyrighted music.
