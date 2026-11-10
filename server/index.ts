import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type ErrorRequestHandler } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { WebSocketServer } from "ws";
import { UPLOAD_DIR } from "./db";
import * as artifacts from "./artifacts";
import { addCustomEnv, findEnv, installIpykernel, listEnvs } from "./envs";
import { connectKernel, shutdownAllKernels } from "./kernels";
import * as repo from "./repo";
import { presentationToPdf, slideConverter, SLIDE_EXTENSIONS } from "./convert";
import { BACKUP_DIR, backupFile, backupNow, backupOnStart, listBackups } from "./backup";
import { exportAll, exportCourse, exportMaterial, type ZipStream } from "./export";
import { eventStream } from "./events";
import { mcpHandler } from "./mcp";
import { search } from "./search";
import { isLocalUpgrade, localHostOnly, localOnly } from "./security";
import {
  BUILTIN_THEMES,
  createTheme,
  duplicateTheme,
  listThemes,
  openThemesFolder,
  removeTheme,
  setCurrentTheme,
  USER_THEMES,
} from "./themes";
import { seedIfEmpty } from "./seed";

const isProd = process.env.NODE_ENV === "production";
// In dev the Vite server owns PORT and proxies /api to API_PORT.
const PORT = Number((isProd ? process.env.PORT : process.env.API_PORT) ?? 3001);
// The MCP endpoint for AI agents; MCP=off turns it off.
const MCP_ON = process.env.MCP !== "off";

seedIfEmpty();
repo.indexLinksIfEmpty();
repo.purgeExpiredTrash();
setInterval(() => repo.purgeExpiredTrash(), 6 * 60 * 60 * 1000).unref();
try {
  const b = backupOnStart();
  if (b) console.log(`Backed up the database to ${path.relative(process.cwd(), path.join(BACKUP_DIR, b.name))}`);
} catch (err) {
  console.error("Backup on start failed:", err);
}

const app = express();

// Artifact files, for the sandboxed frame that shows them. Served before the
// Origin check: a sandboxed page has an opaque origin and sends "Origin: null"
// for the files it fetches. The page itself is sandboxed by header too, so it
// stays isolated even when opened in its own tab, and it can't reach the API.
const ARTIFACT_SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-popups-to-escape-sandbox";
app.use("/artifacts/:id", localHostOnly, (req, res) => {
  let rel: string;
  try {
    rel = decodeURIComponent(req.path.replace(/^\/+/, ""));
  } catch {
    return void res.sendStatus(400);
  }
  const file = artifacts.servedFile(String(req.params.id), rel);
  if (!file) return void res.sendStatus(404);
  const headers: Record<string, string> = {
    "Cache-Control": "no-cache",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
  };
  if (/\.html?$/i.test(file)) headers["Content-Security-Policy"] = ARTIFACT_SANDBOX;
  res.sendFile(file, { headers, cacheControl: false, dotfiles: "deny", acceptRanges: true });
});

app.use(localOnly);
// Drawings carry pasted images inline, so scenes can be large.
app.use(express.json({ limit: "60mb" }));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "");
      cb(null, `${nanoid(14)}${ext}`);
    },
  }),
  // Lecture PDFs and slide decks with media can be big.
  limits: { fileSize: 300 * 1024 * 1024 },
});

const api = express.Router();

api.get("/tree", (_req, res) => {
  res.json(repo.getTree());
});

api.post("/courses", (req, res) => {
  res.status(201).json(repo.createCourse(req.body ?? {}));
});

api.patch("/courses/:id", (req, res) => {
  const course = repo.updateCourse(req.params.id, req.body ?? {});
  if (!course) return void res.sendStatus(404);
  res.json(course);
});

// Deleting moves to the trash; the response carries the trash entry (for Undo).
api.delete("/courses/:id", (req, res) => {
  const trashId = repo.trashCourse(req.params.id);
  if (!trashId) return void res.sendStatus(404);
  res.json({ trashId });
});

api.post("/courses/:id/materials", (req, res) => {
  const material = repo.createMaterial(req.params.id, req.body ?? {});
  if (!material) return void res.sendStatus(404);
  res.status(201).json(material);
});

/** A material by course id in the body, or a book with no course (`courseId` missing or null). */
api.post("/materials", (req, res) => {
  const body = req.body ?? {};
  const material = repo.createMaterial(typeof body.courseId === "string" ? body.courseId : null, body);
  if (!material) return void res.sendStatus(404);
  res.status(201).json(material);
});

api.get("/materials/:id", (req, res) => {
  const material = repo.getMaterial(req.params.id);
  if (!material) return void res.sendStatus(404);
  res.json(material);
});

api.patch("/materials/:id", (req, res) => {
  const body = req.body ?? {};
  if (body.content !== undefined && (body.content === null || typeof body.content !== "object")) {
    return void res.status(400).json({ error: "content must be an object or an array of blocks" });
  }
  // A save based on older content than what is stored (an agent changed it since) would overwrite that change.
  if (body.content !== undefined && typeof body.baseUpdatedAt === "number") {
    const cur = repo.getMaterial(req.params.id);
    if (cur && cur.updatedAt > body.baseUpdatedAt) {
      return void res.status(409).json({ error: "This changed since you opened it.", updatedAt: cur.updatedAt });
    }
  }
  const material = repo.updateMaterial(req.params.id, body);
  if (!material) return void res.sendStatus(404);
  res.json(material);
});

api.get("/books", (_req, res) => {
  res.json(repo.listBooks());
});

/** A partial update to a book: status, where you are, metadata, or one highlight. */
api.post("/materials/:id/book", (req, res) => {
  const material = repo.patchBook(req.params.id, req.body ?? {});
  if (!material) return void res.sendStatus(404);
  res.json(material);
});

api.delete("/materials/:id", (req, res) => {
  const trashId = repo.trashMaterial(req.params.id);
  if (!trashId) return void res.sendStatus(404);
  res.json({ trashId });
});

api.get("/materials/:id/versions", (req, res) => {
  if (!repo.getMaterial(req.params.id)) return void res.sendStatus(404);
  res.json(repo.listVersions(req.params.id));
});

api.get("/versions/:id", (req, res) => {
  const version = repo.getVersion(req.params.id);
  if (!version) return void res.sendStatus(404);
  res.json(version);
});

api.post("/materials/:id/versions/:versionId/restore", (req, res) => {
  const material = repo.restoreVersion(req.params.id, req.params.versionId);
  if (!material) return void res.sendStatus(404);
  res.json(material);
});

api.get("/materials/:id/backlinks", (req, res) => {
  res.json(repo.backlinks(req.params.id));
});

api.get("/link-targets", (req, res) => {
  res.json(repo.linkTargets(String(req.query.q ?? "")));
});

api.post("/materials/:id/append", (req, res) => {
  const blocks = req.body?.blocks;
  if (!Array.isArray(blocks)) return void res.status(400).json({ error: "blocks must be an array" });
  const material = repo.appendBlocks(req.params.id, blocks);
  if (!material) return void res.sendStatus(404);
  res.json(material);
});

api.get("/drawings", (_req, res) => {
  res.json(repo.listDrawings());
});

api.post("/drawings", (req, res) => {
  res.status(201).json(repo.createDrawing(req.body ?? {}));
});

api.get("/drawings/:id", (req, res) => {
  const drawing = repo.getDrawing(req.params.id);
  if (!drawing) return void res.sendStatus(404);
  res.json(drawing);
});

api.get("/drawings/:id/preview.svg", (req, res) => {
  const preview = repo.getDrawingPreview(req.params.id);
  if (!preview) return void res.sendStatus(404);
  // Revalidate every time: the same drawing can be edited from the Canvas or a page.
  const etag = '"' + preview.updatedAt + '"';
  res.set({ "Content-Type": "image/svg+xml", "Cache-Control": "no-cache", ETag: etag });
  if (req.headers["if-none-match"] === etag) return void res.sendStatus(304);
  res.send(preview.svg);
});

api.patch("/drawings/:id", (req, res) => {
  const drawing = repo.updateDrawing(req.params.id, req.body ?? {});
  if (!drawing) return void res.sendStatus(404);
  res.json(drawing);
});

api.delete("/drawings/:id", (req, res) => {
  const trashId = repo.trashDrawing(req.params.id);
  if (!trashId) return void res.sendStatus(404);
  res.json({ trashId });
});

// ── Trash ────────────────────────────────────────────────────────────────
api.get("/trash", (_req, res) => {
  res.json(repo.listTrash());
});

api.post("/trash/:id/restore", (req, res) => {
  const restored = repo.restoreTrash(req.params.id);
  if (!restored) return void res.sendStatus(404);
  res.json(restored);
});

api.delete("/trash/:id", (req, res) => {
  res.sendStatus(repo.purgeTrash(req.params.id) ? 204 : 404);
});

api.delete("/trash", (_req, res) => {
  repo.emptyTrash();
  res.sendStatus(204);
});

// ── Themes ───────────────────────────────────────────────────────────────
api.get("/themes", (_req, res) => {
  res.json(listThemes());
});

api.put("/themes/current", (req, res) => {
  res.json(setCurrentTheme(String(req.body?.id ?? "")));
});

/** A new theme in data/themes: from the template, or from uploaded CSS ({ css, fileName }). */
api.post("/themes", (req, res) => {
  const { name, css, fileName } = req.body ?? {};
  res.status(201).json(createTheme({ name, css: typeof css === "string" ? css : undefined, fileName }));
});

api.post("/themes/duplicate", (req, res) => {
  res.status(201).json(duplicateTheme(String(req.body?.id ?? "")));
});

api.delete("/themes", (req, res) => {
  res.json(removeTheme(String(req.query.id ?? "")));
});

api.post("/themes/open-folder", (_req, res) => {
  openThemesFolder();
  res.sendStatus(204);
});

// ── Backups and exports ──────────────────────────────────────────────────
api.get("/backups", (_req, res) => {
  res.json(listBackups());
});

api.post("/backups", (_req, res) => {
  res.status(201).json(backupNow());
});

api.get("/backups/:name", (req, res) => {
  const file = backupFile(req.params.name);
  if (!file) return void res.sendStatus(404);
  res.download(file, req.params.name);
});

function sendZip(res: express.Response, zip: ZipStream | null) {
  if (!zip) return void res.sendStatus(404);
  const ascii = zip.name.replace(/[^\x20-\x7e]/g, "-").replace(/["\\]/g, "");
  res.set({
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(zip.name)}`,
  });
  zip.stream.on("error", (err) => res.destroy(err));
  res.on("close", () => zip.cleanup?.());
  zip.stream.pipe(res);
}

api.get("/export/course/:id", (req, res) => sendZip(res, exportCourse(req.params.id)));
api.get("/export/material/:id", (req, res) => sendZip(res, exportMaterial(req.params.id)));
api.get("/export/all", (_req, res) => sendZip(res, exportAll()));

/** Changes made by agents, as Server-Sent Events (see server/events.ts). */
api.get("/events", eventStream);

api.get("/search", (req, res) => {
  res.json(search(String(req.query.q ?? "")));
});

// ── Importing PDFs and slide decks ────────────────────────────────────────
api.get("/convert/available", async (_req, res) => {
  res.json({ slides: await slideConverter() });
});

/** Stores a presentation and converts it to PDF; the browser renders the PDF's pages. */
api.post("/convert/slides", upload.single("file"), async (req, res, next) => {
  const file = req.file;
  if (!file) return void res.status(400).json({ error: "no file" });
  if (!SLIDE_EXTENSIONS.includes(path.extname(file.originalname).toLowerCase())) {
    fs.rm(file.path, { force: true }, () => undefined);
    return void res.status(400).json({ error: "Only PowerPoint or OpenDocument presentations can be converted." });
  }
  try {
    const { pdf, converter } = await presentationToPdf(file.path);
    res.json({
      url: `/uploads/${file.filename}`,
      name: file.originalname,
      pdfUrl: `/uploads/${path.basename(pdf)}`,
      converter,
    });
  } catch (err) {
    next(err);
  }
});

/** An image page's picture (folder thumbnails). Redirects so the image itself stays cacheable. */
api.get("/materials/:id/image", (req, res) => {
  const m = repo.getMaterial(req.params.id);
  const url =
    m?.kind === "image"
      ? (m.content as { url?: string }).url
      : m?.kind === "book"
        ? ((m.content as { coverUrl?: string | null }).coverUrl ?? undefined)
        : undefined;
  if (!url) return void res.sendStatus(404);
  res.set("Cache-Control", "no-cache").redirect(302, url);
});

api.post("/courses/:id/slides", (req, res) => {
  const { title, source, pages } = req.body ?? {};
  if (!source?.url || !Array.isArray(pages) || !pages.length) {
    return void res.status(400).json({ error: "source and pages are required" });
  }
  const folder = repo.createSlideFolder(req.params.id, { title: String(title ?? ""), source, pages });
  if (!folder) return void res.sendStatus(404);
  res.status(201).json(folder);
});

// ── Artifacts: HTML pages kept as files, shown in a sandboxed frame ──────

/**
 * A new artifact in a course. Either JSON `{ title?, description?, source?, parentId?, html, files?: [{ path, text }] }`
 * (how an agent adds one), or multipart `files` (with an optional `paths` JSON array of relative paths, in the same
 * order) plus `title`, `description`, `parentId` fields (how the app imports one).
 */
api.post("/courses/:id/artifacts", upload.array("files", 512), (req, res, next) => {
  const uploaded = (req.files as Express.Multer.File[] | undefined) ?? [];
  const cleanup = () => uploaded.forEach((f) => fs.rm(f.path, { force: true }, () => undefined));
  try {
    let material;
    if (uploaded.length) {
      let paths: unknown = [];
      try {
        paths = JSON.parse(String(req.body?.paths ?? "[]"));
      } catch {
        paths = [];
      }
      const names = Array.isArray(paths) ? (paths as unknown[]) : [];
      const files = uploaded.map((f, i) => ({
        path: typeof names[i] === "string" && names[i] ? (names[i] as string) : f.originalname,
        from: f.path,
      }));
      material = artifacts.createFromFiles(String(req.params.id), {
        title: String(req.body?.title ?? "").trim().slice(0, 200),
        description: String(req.body?.description ?? "").trim().slice(0, 2000),
        source: String(req.body?.source ?? "").trim().slice(0, 500),
        parentId: req.body?.parentId ? String(req.body.parentId) : null,
        files,
      });
      cleanup();
    } else {
      material = artifacts.createArtifact(String(req.params.id), req.body ?? {});
    }
    if (!material) return void res.sendStatus(404);
    res.status(201).json(material);
  } catch (err) {
    cleanup();
    next(err);
  }
});

/** Description and source, kept beside the files. */
api.post("/materials/:id/artifact", (req, res) => {
  const { description, source } = req.body ?? {};
  const m = artifacts.sync(req.params.id, {
    ...(typeof description === "string" ? { description: description.trim().slice(0, 2000) } : {}),
    ...(typeof source === "string" ? { source: source.trim().slice(0, 500) } : {}),
  });
  if (!m) return void res.sendStatus(404);
  res.json(m);
});

api.get("/materials/:id/artifact/files", (req, res) => {
  const m = repo.getMaterial(req.params.id);
  if (m?.kind !== "artifact") return void res.sendStatus(404);
  res.json(artifacts.listFiles(req.params.id));
});

const pathParam = (req: express.Request) => String(req.query.path ?? "");

/** One file as it is (`?path=index.html`). */
api.get("/materials/:id/artifact/file", (req, res) => {
  const file = artifacts.readFile(req.params.id, pathParam(req));
  if (!file) return void res.sendStatus(404);
  res.sendFile(file.abs, { headers: { "Cache-Control": "no-cache" }, cacheControl: false, dotfiles: "deny" });
});

/** Replaces or adds one file with the request body as it is (`?path=styles.css`). */
api.put("/materials/:id/artifact/file", express.raw({ type: () => true, limit: artifacts.MAX_FILE }), (req, res) => {
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const m = artifacts.writeFile(req.params.id, pathParam(req), body);
  if (!m) return void res.sendStatus(404);
  res.json(m);
});

api.delete("/materials/:id/artifact/file", (req, res) => {
  const m = artifacts.deleteFile(req.params.id, pathParam(req));
  if (!m) return void res.sendStatus(404);
  res.json(m);
});

/** A text file as JSON `{ path, text, size, updatedAt }` (`?path=index.html`). */
api.get("/materials/:id/artifact/text", (req, res) => {
  const file = artifacts.readText(req.params.id, pathParam(req));
  if (!file) return void res.sendStatus(404);
  res.json(file);
});

/** Writes a text file from JSON `{ path, text }`: the form agents and the source editor use. */
api.post("/materials/:id/artifact/text", (req, res) => {
  const { path: p, text } = req.body ?? {};
  if (typeof p !== "string" || typeof text !== "string") {
    return void res.status(400).json({ error: "path and text are required" });
  }
  const m = artifacts.writeFile(req.params.id, p, text);
  if (!m) return void res.sendStatus(404);
  res.json(m);
});

/** Earlier states of the entry page, newest first. */
api.get("/materials/:id/artifact/history", (req, res) => {
  const m = repo.getMaterial(req.params.id);
  if (m?.kind !== "artifact") return void res.sendStatus(404);
  res.json(artifacts.listHistory(req.params.id));
});

api.get("/materials/:id/artifact/history/:at", (req, res) => {
  const text = artifacts.readHistory(String(req.params.id), Number(req.params.at));
  if (text === null) return void res.sendStatus(404);
  res.json({ at: Number(req.params.at), text });
});

api.post("/materials/:id/artifact/history/:at/restore", (req, res) => {
  const m = artifacts.restoreHistory(String(req.params.id), Number(req.params.at));
  if (!m) return void res.sendStatus(404);
  res.json(m);
});

/** The artifact's folder as a zip. */
api.get("/materials/:id/artifact/download", (req, res) => {
  const out = artifacts.zipOf(req.params.id);
  if (!out) return void res.sendStatus(404);
  const ascii = out.name.replace(/[^\x20-\x7e]/g, "-").replace(/["\\]/g, "");
  res.set({
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(out.name)}`,
  });
  out.zip.outputStream.on("error", (err) => res.destroy(err));
  out.zip.outputStream.pipe(res);
});

api.post("/uploads", upload.single("file"), (req, res) => {
  if (!req.file) return void res.status(400).json({ error: "no file" });
  res.status(201).json({ url: `/uploads/${req.file.filename}`, name: req.file.originalname });
});

// ── Python environments (for notebook kernels) ──────────────────────────
api.get("/envs", async (req, res, next) => {
  try {
    res.json(await listEnvs(req.query.refresh === "1"));
  } catch (err) {
    next(err);
  }
});

api.post("/envs", async (req, res) => {
  try {
    res.status(201).json(await addCustomEnv(String(req.body?.path ?? "")));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

api.post("/envs/install-ipykernel", async (req, res, next) => {
  try {
    res.json(await installIpykernel(String(req.body?.python ?? "")));
  } catch (err) {
    next(err);
  }
});

app.use("/api", api);
if (MCP_ON) app.all("/mcp", mcpHandler);
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "30d", immutable: true }));

// Theme stylesheets and their fonts/images. Links carry ?v=<mtime>, and edits to
// your own themes must show up at once, so they are revalidated every time.
app.use("/themes/builtin", express.static(BUILTIN_THEMES, { maxAge: "1h" }));
app.use("/themes/user", express.static(USER_THEMES, { cacheControl: true, maxAge: 0 }));

// Excalidraw's hand-drawn fonts, served locally so drawing works offline
// (the client points window.EXCALIDRAW_ASSET_PATH here).
const excalidrawFonts = fileURLToPath(
  new URL("../node_modules/@excalidraw/excalidraw/dist/prod/fonts", import.meta.url),
);
app.use("/excalidraw-assets/fonts", express.static(excalidrawFonts, { maxAge: "365d", immutable: true }));

// The Pyodide runtime (Python compiled to WebAssembly) for notebook pages.
// Packages such as numpy are fetched from the Pyodide CDN when first imported.
const pyodideDir = fileURLToPath(new URL("../node_modules/pyodide", import.meta.url));
app.use("/pyodide", express.static(pyodideDir, { maxAge: "7d" }));

// pdf.js data (fonts, character maps, decoders) for rendering imported PDFs.
const pdfjsDir = fileURLToPath(new URL("../node_modules/pdfjs-dist", import.meta.url));
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  app.use(`/pdfjs/${dir}`, express.static(path.join(pdfjsDir, dir), { maxAge: "30d" }));
}

if (isProd) {
  const dist = path.resolve("dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/(api|mcp|uploads|artifacts|themes|excalidraw-assets|pyodide|pdfjs)(\/|$)).*/, (_req, res) =>
      res.sendFile(path.join(dist, "index.html")),
    );
  }
}

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(err?.status ?? 500).json({ error: err?.message ?? "Server error" });
};
app.use(onError);

const server = http.createServer(app);

// Notebook pages talk to their kernel over a WebSocket: /api/kernels/ws?material=…&python=…
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
server.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/kernels/ws" || !isLocalUpgrade(req)) return void socket.destroy();
  const materialId = url.searchParams.get("material");
  const env = await findEnv(url.searchParams.get("python") ?? "");
  if (!materialId || !repo.getMaterial(materialId) || !env) return void socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => connectKernel(ws, materialId, env));
});

// Only this computer by default; set HOST to listen elsewhere (and ALLOWED_HOSTS to match).
const HOST = process.env.HOST ?? "127.0.0.1";
server.listen(PORT, HOST, () => {
  const origin = `http://${HOST === "127.0.0.1" ? "localhost" : HOST}:${PORT}`;
  console.log(`Gloss API on ${origin}`);
  if (MCP_ON) console.log(`MCP for agents on ${origin}/mcp`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    shutdownAllKernels();
    process.exit(0);
  });
}
process.on("exit", shutdownAllKernels);
