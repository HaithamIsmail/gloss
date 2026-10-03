import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type ErrorRequestHandler } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { WebSocketServer } from "ws";
import { UPLOAD_DIR } from "./db";
import { addCustomEnv, findEnv, installIpykernel, listEnvs } from "./envs";
import { connectKernel, shutdownAllKernels } from "./kernels";
import * as repo from "./repo";
import { presentationToPdf, slideConverter, SLIDE_EXTENSIONS } from "./convert";
import { BACKUP_DIR, backupFile, backupNow, backupOnStart, listBackups } from "./backup";
import { exportAll, exportCourse, exportMaterial, type ZipStream } from "./export";
import { search } from "./search";
import { isLocalUpgrade, localOnly } from "./security";
import { seedIfEmpty } from "./seed";

const isProd = process.env.NODE_ENV === "production";
// In dev the Vite server owns PORT and proxies /api to API_PORT.
const PORT = Number((isProd ? process.env.PORT : process.env.API_PORT) ?? 3001);

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
  const material = repo.updateMaterial(req.params.id, body);
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
  const url = m?.kind === "image" ? (m.content as { url?: string }).url : undefined;
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
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "30d", immutable: true }));

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
    app.get(/^(?!\/(api|uploads|excalidraw-assets|pyodide|pdfjs)\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
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
  console.log(`Gloss API on http://${HOST === "127.0.0.1" ? "localhost" : HOST}:${PORT}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    shutdownAllKernels();
    process.exit(0);
  });
}
process.on("exit", shutdownAllKernels);
