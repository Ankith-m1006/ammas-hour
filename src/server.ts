// Self-hosted MCP server over Streamable HTTP at /mcp (one MCP session per client), plus the
// Echo Show simulator at / that acts as a real MCP client against it.
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {fileURLToPath} from "node:url";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {isInitializeRequest} from "@modelcontextprotocol/sdk/types.js";
import {createMcpServer} from "./mcp.ts";
import {Store} from "./store.ts";

const PORT = Number(process.env.PORT ?? 8787);
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

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
