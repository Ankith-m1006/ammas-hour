# Friction log

Kept from day 1 of the build (21 Oct 2026, India). Each entry: task, steps, expected vs actual, severity, workaround, suggestion.

## 1. Alexa+ add-on tools are partner-only
- Task: test the MCP server against a real Alexa+ device or the Alexa+ Web Simulator / Local Inspector.
- Steps: read the Alexa+ add-on docs (MCP Toolkit overview, Local Inspector), hackathon FAQ.
- Expected: a way for hackathon builders to run the official simulator or inspector.
- Actual: "available to select partners only"; the FAQ confirms no participant can connect a self-hosted MCP server to Alexa+.
- Severity: high (every entrant builds blind against the functional requirements).
- Workaround: our own Echo Show simulator that is a real MCP client, plus a test suite mapped to the published functional requirements.
- Suggestion: open the Local Inspector (or a hosted lint endpoint) to hackathon participants.

## 2. MCP Apps helper package targets the next SDK major
- Task: register MCP Apps tools/resources with `@modelcontextprotocol/ext-apps` 2.0.3.
- Expected: helpers that work with the current stable `@modelcontextprotocol/sdk` (1.32.1).
- Actual: the server helpers import types from `@modelcontextprotocol/server` (the v2 split packages), not `sdk` 1.x.
- Severity: low.
- Workaround: set `_meta.ui.resourceUri` (and the legacy `ui/resourceUri`) and the `text/html;profile=mcp-app` MIME type by hand with the 1.x SDK.
- Suggestion: document the 1.x path in the ext-apps README.
