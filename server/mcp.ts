// The MCP endpoint (/mcp): lets AI agents read, add and edit content over
// Streamable HTTP. Stateless: a new server and transport for every request.
// Tools call repo.ts / artifacts.ts / search.ts directly, never the HTTP API.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { RequestHandler } from "express";
import { registerFileTools } from "./mcp/files";
import { registerReadTools } from "./mcp/read";
import { registerWriteTools } from "./mcp/write";

const INSTRUCTIONS = `Gloss is a local study app. Content is organised as courses → materials.
Material kinds: doc (a page of blocks), notebook (Python cells), image (an image with commented regions), folder (holds materials; one level only), book (PDF/EPUB in the library, with highlights), artifact (an HTML page with its files).
Start with get_tree or search to find ids, then get_material to read.

Pages are read and written as Markdown:
- "# " and "## " are the numbered sections and subsections (the app numbers them; don't type numbers). "### " is a minor heading.
- Paragraphs with **bold**, *italic*, ~~strike~~, \`code\`, <u>underline</u>, [links](https://…); lists (-, 1., - [ ] / - [x], nested by indenting); fenced code with a language; tables; --- for a rule.
- Math: $…$ inline, and a display formula as $$ on its own lines around the LaTeX.
- Callouts: a quote starting with [!NOTE], [!TIP], [!WARNING] or [!IMPORTANT] (exam), e.g. "> [!TIP]\\n> Remember this."
- Links to other materials (@ mentions): [@Title](/m/<materialId>); to one region of an image: [@label](/m/<materialId>?ann=<regionId>&block=<imageBlockId>).
- Images: upload with upload_file, then ![name](/uploads/…).
- get_material puts <!-- id: … --> before each block; use those ids with edit_page. <mark data-region="…"> marks a passage linked to an image region; keep it to keep the link. Annotated images and drawings keep their regions as long as their image line stays.

Every edit by a tool stores the previous content as a version (list_versions, restore_version; the user sees them in History). Deleting moves to the trash for 30 days (list_trash, restore_from_trash). Notebook code is never run over MCP; drawings, themes and backups aren't reachable here.`;

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "gloss", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  registerReadTools(server);
  registerWriteTools(server);
  registerFileTools(server);
  return server;
}

/** POST /mcp (mounted after the local-only check and the JSON body parser). */
export const mcpHandler: RequestHandler = async (req, res) => {
  if (req.method !== "POST") {
    // Stateless: no server-to-client stream to open (GET) and no session to end (DELETE).
    return void res
      .status(405)
      .set("Allow", "POST")
      .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  }
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
};
