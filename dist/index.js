import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
const PORT = Number(process.env.PORT || 8080);
const WEB_APP_URL = requireEnv("VISUAL_OS_WEB_APP_URL");
const SHARED_SECRET = requireEnv("VISUAL_OS_SHARED_SECRET");
const MCP_API_KEY = process.env.MCP_API_KEY || "";
const sessions = new Map();
const app = express();
app.use(express.json({ limit: "2mb" }));
app.get("/health", (_req, res) => {
    res.status(200).json({
        ok: true,
        service: "visual-identity-os-mcp",
        version: "1.1.0",
    });
});
app.all("/mcp", async (req, res) => {
    try {
        enforceMcpApiKey(req);
        const sessionId = req.header("mcp-session-id");
        let entry = sessionId ? sessions.get(sessionId) : undefined;
        if (!entry && req.method === "POST" && isInitializeRequest(req.body)) {
            const server = createServer();
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (newSessionId) => {
                    sessions.set(newSessionId, { server, transport });
                },
            });
            transport.onclose = () => {
                if (transport.sessionId) {
                    sessions.delete(transport.sessionId);
                }
            };
            await server.connect(transport);
            entry = { server, transport };
        }
        if (!entry) {
            res.status(400).json({
                jsonrpc: "2.0",
                error: {
                    code: -32000,
                    message: "Missing or invalid MCP session. Initialize first.",
                },
                id: null,
            });
            return;
        }
        await entry.transport.handleRequest(req, res, req.body);
    }
    catch (error) {
        console.error(error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: "2.0",
                error: {
                    code: -32603,
                    message: errorMessage(error),
                },
                id: null,
            });
        }
    }
});
function createServer() {
    const server = new McpServer({
        name: "visual-identity-os",
        version: "1.1.0",
    });
    server.registerTool("visual_get_system_status", {
        title: "Get Visual OS status",
        description: "Returns counts and operational status from the Visual Identity OS control sheet.",
        inputSchema: {},
    }, async () => toolResult(await appsScriptGet("status")));
    server.registerTool("visual_list_pending_batches", {
        title: "List pending visual batches",
        description: "Lists visual batches waiting for scoring, review, or error resolution.",
        inputSchema: {},
    }, async () => toolResult(await appsScriptGet("batches")));
    server.registerTool("visual_get_batch", {
        title: "Get visual batch",
        description: "Returns one batch and all captures assigned to it.",
        inputSchema: {
            batch_id: z.string().min(1),
        },
    }, async ({ batch_id }) => toolResult(await appsScriptGet("batch", { id: batch_id })));
    server.registerTool("visual_list_recent_captures", {
        title: "List recent captures",
        description: "Returns recent captures from the Universal Inbox registry.",
        inputSchema: {
            limit: z.number().int().min(1).max(200).default(50),
        },
    }, async ({ limit }) => toolResult(await appsScriptGet("captures", { limit: String(limit) })));
    server.registerTool("visual_create_session", {
        title: "Create visual session",
        description: "Creates an active visual session for rapid exploration without requiring a formal request per image.",
        inputSchema: {
            project: z.string().min(1),
            subjects: z.array(z.string().min(1)).min(1),
            scene: z.string().default(""),
            generator: z.string().default("OTHER"),
        },
    }, async (input) => toolResult(await appsScriptPost({
        action: "create_session",
        ...input,
    })));
    server.registerTool("visual_close_session", {
        title: "Close visual session",
        description: "Closes only the currently active visual session when its exact session ID is provided. It preserves all unrelated Script Properties.",
        inputSchema: {
            session_id: z.string().min(1),
            closed_by: z.string().default("David"),
            notes: z.string().default(""),
        },
    }, async (input) => toolResult(await appsScriptPost({
        action: "close_session",
        ...input,
    })));
    server.registerTool("visual_create_request", {
        title: "Create formal visual request",
        description: "Creates a traceable production request with prompt and project context.",
        inputSchema: {
            project: z.string().min(1),
            subjects: z.array(z.string().min(1)).min(1),
            prompt: z.string().min(1),
            scene: z.string().default(""),
            generator: z.string().default("OTHER"),
            mode: z.string().default("MANUAL_GENERATION"),
            pack_version: z.string().default(""),
            parent_request_id: z.string().default(""),
            source_result_id: z.string().default(""),
            iteration: z.number().int().min(1).default(1),
            notes: z.string().default(""),
        },
    }, async (input) => toolResult(await appsScriptPost({
        action: "create_request",
        ...input,
    })));
    server.registerTool("visual_cancel_request", {
        title: "Cancel visual request",
        description: "Cancels an unprocessed visual request. Requests with linked captures, review records, or result memory cannot be cancelled.",
        inputSchema: {
            request_id: z.string().min(1),
            reason: z.string().min(1),
            cancelled_by: z.string().default("David"),
        },
    }, async (input) => toolResult(await appsScriptPost({
        action: "cancel_request",
        ...input,
    })));
    server.registerTool("visual_submit_decision", {
        title: "Submit capture decision",
        description: "Moves a capture to approved, adjustment, or rejected according to a human decision.",
        inputSchema: {
            capture_id: z.string().min(1),
            decision: z.enum(["APPROVE", "ADJUST", "REJECT"]),
            notes: z.string().default(""),
        },
    }, async (input) => toolResult(await appsScriptPost({
        action: "submit_decision",
        ...input,
    })));
    server.registerTool("visual_promote_asset", {
        title: "Promote visual asset",
        description: "Registers an approved capture with a specific authorized scope. It never promotes automatically.",
        inputSchema: {
            capture_id: z.string().min(1),
            anchor_type: z.enum([
                "Identity Anchor",
                "Composition Anchor",
                "Mood Anchor",
                "Room Anchor",
                "Lighting Anchor",
                "Couple Relationship Anchor",
                "Detail Lock",
                "Publication Ready",
            ]),
            approved_by: z.string().default("David"),
            notes: z.string().default(""),
            allowed_use: z.array(z.string()).default([]),
            prohibited_use: z.array(z.string()).default([]),
        },
    }, async (input) => toolResult(await appsScriptPost({
        action: "promote_asset",
        ...input,
    })));
    return server;
}
async function appsScriptGet(action, params = {}) {
    const url = new URL(WEB_APP_URL);
    url.searchParams.set("action", action);
    url.searchParams.set("secret", SHARED_SECRET);
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
    });
    return parseResponse(response);
}
async function appsScriptPost(payload) {
    const url = new URL(WEB_APP_URL);
    url.searchParams.set("secret", SHARED_SECRET);
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
    });
    return parseResponse(response);
}
async function parseResponse(response) {
    const text = await response.text();
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new Error(`Apps Script returned non-JSON (${response.status}): ${text.slice(0, 500)}`);
    }
    if (!response.ok) {
        throw new Error(`Apps Script HTTP ${response.status}: ${JSON.stringify(parsed)}`);
    }
    if (typeof parsed === "object" &&
        parsed !== null &&
        "ok" in parsed &&
        parsed.ok === false) {
        throw new Error(`Visual OS error: ${JSON.stringify(parsed)}`);
    }
    return parsed;
}
function toolResult(value) {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(value, null, 2),
            },
        ],
        structuredContent: typeof value === "object" && value !== null
            ? value
            : { value },
    };
}
function enforceMcpApiKey(req) {
    if (!MCP_API_KEY)
        return;
    const bearer = req.header("authorization") || "";
    const direct = req.header("x-mcp-api-key") || "";
    const provided = bearer.startsWith("Bearer ")
        ? bearer.slice("Bearer ".length)
        : direct;
    if (provided !== MCP_API_KEY) {
        const error = new Error("Unauthorized MCP request");
        error.status = 401;
        throw error;
    }
}
function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Visual Identity OS MCP listening on port ${PORT}`);
});
