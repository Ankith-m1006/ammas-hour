// Self-hosted MCP server over Streamable HTTP at /mcp (one MCP session per client), plus the
// Echo Show simulator at / that acts as a real MCP client against it.
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {fileURLToPath} from "node:url";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {isInitializeRequest} from "@modelcontextprotocol/sdk/types.js";
import {plan} from "./brain.ts";
import {createMcpServer} from "./mcp.ts";
import {Store} from "./store.ts";

const PORT = Number(process.env.PORT ?? 8787);
loadEnvFile();

// Reads KEY=value lines from .env (gitignored) so the Gemini key never has to be in the repo or the shell history.
function loadEnvFile(): void {
    try {
        for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
            const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
            if (match && !process.env[match[1]]) {
                process.env[match[1]] = match[2];
            }
        }
    } catch {
        // No .env: the simulator brain falls back to its rule-based router.
    }
}
const store = new Store(process.env.AMMAS_HOUR_DATA ?? fileURLToPath(new URL("../data/state.json", import.meta.url)));
const transports = new Map<string, StreamableHTTPServerTransport>();

async function readJson(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : undefined;
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
    res.writeHead(status, {"Content-Type": type});
    res.end(body);
}

// Optional bearer token (AMMAS_HOUR_TOKEN). Alexa+ re-runs account linking when an add-on answers 401,
// so a missing or wrong token gets exactly that instead of an MCP error.
function authorised(req: IncomingMessage): boolean {
    const expected = process.env.AMMAS_HOUR_TOKEN;
    return !expected || req.headers.authorization === `Bearer ${expected}`;
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!authorised(req)) {
        res.writeHead(401, {"Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="ammas-hour"'});
        res.end(JSON.stringify({error: "invalid_token"}));
        return;
    }
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const body = req.method === "POST" ? await readJson(req) : undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
        if (req.method !== "POST" || !isInitializeRequest(body)) {
            send(res, 400, "application/json", JSON.stringify({
                jsonrpc: "2.0", error: {code: -32000, message: "No valid session: send initialize first."}, id: null,
            }));
            return;
        }
        transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => transports.set(id, transport!),
        });
        transport.onclose = () => {
            if (transport!.sessionId) {
                transports.delete(transport!.sessionId);
            }
        };
        await createMcpServer(store).connect(transport);
    }
    await transport.handleRequest(req, res, body);
}

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        if (url.pathname === "/mcp") {
            await handleMcp(req, res);
        } else if (url.pathname === "/" || url.pathname === "/simulator") {
            send(res, 200, "text/html; charset=utf-8", readFileSync(new URL("../ui/simulator.html", import.meta.url), "utf8"));
        } else if (url.pathname === "/brain" && req.method === "POST") {
            const {utterance, tools, context} = await readJson(req) as {utterance: string; tools: never[]; context: Record<string, unknown>};
            send(res, 200, "application/json", JSON.stringify(await plan(String(utterance ?? ""), tools ?? [], context ?? {})));
        } else if (url.pathname === "/demo/reset" && req.method === "POST") {
            store.reset();
            send(res, 200, "application/json", JSON.stringify({ok: true}));
        } else if (url.pathname === "/demo/state") {
            send(res, 200, "application/json", JSON.stringify(store.state));
        } else {
            send(res, 404, "text/plain", "Not found");
        }
    } catch (error) {
        console.error(error);
        if (!res.headersSent) {
            send(res, 500, "application/json", JSON.stringify({error: String(error)}));
        }
    }
});

server.listen(PORT, () => console.log(`Amma's Hour MCP server: http://localhost:${PORT}/mcp  simulator: http://localhost:${PORT}/`));
