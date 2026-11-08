// Artifacts: HTML pages (the kind Claude makes, or any other tool) kept as
// files in data/artifacts/<material id>/ and shown in a sandboxed frame. The
// material's content is derived from the folder: the file list, and the page's
// visible text for search. Agents edit them through the file API; earlier
// states of the entry page are kept in the folder's .history/.
import fs from "node:fs";
import path from "node:path";
import yazl from "yazl";
import type { ArtifactFileText, ArtifactMaterial, Material, NewArtifact } from "../shared/api";
import {
  ARTIFACT_ENTRY,
  artifactPath,
  asArtifact,
  htmlText,
  htmlTitle,
  isArtifactText,
  type ArtifactContent,
  type ArtifactFile,
} from "../shared/pages";
import { ARTIFACT_DIR } from "./db";
import * as repo from "./repo";
import { UserError } from "./repo";

/** Rendered pages stay at or under 16 MB, like claude.ai's; so does each file here. */
export const MAX_FILE = 16 * 1024 * 1024;
const MAX_FILES = 512;
const MAX_HISTORY = 20;
const HISTORY = ".history";

export const dirOf = (id: string) => path.join(ARTIFACT_DIR, id);

/** The absolute path of a file inside an artifact, or null when `p` is not a safe relative path. */
export function fileOf(id: string, p: string): { rel: string; abs: string } | null {
  const rel = artifactPath(p);
  if (!rel) return null;
  const abs = path.join(dirOf(id), ...rel.split("/"));
  if (!abs.startsWith(dirOf(id) + path.sep)) return null;
  return { rel, abs };
}

function walk(dir: string, rel: string, out: ArtifactFile[]) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, r, out);
    else if (e.isFile()) {
      const st = fs.statSync(abs);
      out.push({ path: r, size: st.size, updatedAt: Math.round(st.mtimeMs) });
    }
  }
}

/** Every file in the artifact's folder (not its history), sorted with the entry page first. */
export function listFiles(id: string, entry = ARTIFACT_ENTRY): ArtifactFile[] {
  const out: ArtifactFile[] = [];
  walk(dirOf(id), "", out);
  return out.sort((a, b) => (a.path === entry ? -1 : b.path === entry ? 1 : a.path.localeCompare(b.path)));
}

function artifactOf(id: string): ArtifactMaterial | null {
  const m = repo.getMaterial(id);
  return m?.kind === "artifact" ? (m as ArtifactMaterial) : null;
}

/** Rereads the folder and stores the file list and the page's text on the material. */
export function sync(id: string, patch: Partial<Pick<ArtifactContent, "description" | "source" | "entry">> = {}): ArtifactMaterial | null {
  const m = artifactOf(id);
  if (!m) return null;
  const prev = asArtifact(m.content);
  const entry = patch.entry ?? prev.entry;
  const files = listFiles(id, entry);
  const entryFile = fileOf(id, entry);
  let text = "";
  if (entryFile && fs.existsSync(entryFile.abs)) {
    try {
      text = htmlText(fs.readFileSync(entryFile.abs, "utf8"));
    } catch {
      text = "";
    }
  }
  const content: ArtifactContent = {
    entry,
    files,
    description: patch.description ?? prev.description,
    ...(patch.source !== undefined ? (patch.source ? { source: patch.source } : {}) : prev.source ? { source: prev.source } : {}),
    ...(text ? { text } : {}),
  };
  repo.updateMaterial(id, { content }, { snapshot: "skip" });
  return artifactOf(id);
}

function ensureDir(abs: string) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
}

/** Keeps the current entry page in .history/ before it is replaced (newest MAX_HISTORY kept). */
function keepHistory(id: string, entryAbs: string) {
  if (!fs.existsSync(entryAbs)) return;
  const dir = path.join(dirOf(id), HISTORY);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(entryAbs) || ".html";
  fs.copyFileSync(entryAbs, path.join(dir, `${Date.now()}${ext}`));
  const all = fs
    .readdirSync(dir)
    .filter((f) => /^\d+\./.test(f))
    .sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
  for (const f of all.slice(MAX_HISTORY)) fs.rmSync(path.join(dir, f), { force: true });
}

export type HistoryEntry = { at: number; size: number };

export function listHistory(id: string): HistoryEntry[] {
  const dir = path.join(dirOf(id), HISTORY);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d+\./.test(f))
    .map((f) => ({ at: parseInt(f, 10), size: fs.statSync(path.join(dir, f)).size }))
    .sort((a, b) => b.at - a.at);
}

function historyFile(id: string, at: number): string | null {
  const dir = path.join(dirOf(id), HISTORY);
  if (!fs.existsSync(dir) || !Number.isFinite(at)) return null;
  const f = fs.readdirSync(dir).find((f) => parseInt(f, 10) === at);
  return f ? path.join(dir, f) : null;
}

export function readHistory(id: string, at: number): string | null {
  const f = historyFile(id, at);
  return f ? fs.readFileSync(f, "utf8") : null;
}

/** Puts an earlier entry page back (the current one goes to the history first). */
export function restoreHistory(id: string, at: number): ArtifactMaterial | null {
  const m = artifactOf(id);
  const f = historyFile(id, at);
  if (!m || !f) return null;
  return writeFile(id, asArtifact(m.content).entry, fs.readFileSync(f));
}

/** Writes (or replaces) one file. The entry page keeps its earlier state in the history. */
export function writeFile(id: string, p: string, data: Buffer | string): ArtifactMaterial | null {
  const m = artifactOf(id);
  if (!m) return null;
  const file = fileOf(id, p);
  if (!file) throw new UserError(`"${p}" is not a valid path inside an artifact.`);
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  if (buf.length > MAX_FILE) throw new UserError("A file of an artifact can be at most 16 MB.");
  const content = asArtifact(m.content);
  if (!fs.existsSync(file.abs) && content.files.length >= MAX_FILES) {
    throw new UserError(`An artifact can hold at most ${MAX_FILES} files.`);
  }
  if (file.rel === content.entry) keepHistory(id, file.abs);
  ensureDir(file.abs);
  fs.writeFileSync(file.abs, buf);
  return sync(id);
}

export function readFile(id: string, p: string): { abs: string; rel: string } | null {
  const m = artifactOf(id);
  const file = m && fileOf(id, p);
  return file && fs.existsSync(file.abs) && fs.statSync(file.abs).isFile() ? file : null;
}

/** A text file with its contents (for the source editor and agents). */
export function readText(id: string, p: string): ArtifactFileText | null {
  const file = readFile(id, p);
  if (!file) return null;
  const st = fs.statSync(file.abs);
  if (!isArtifactText(file.rel) && st.size > MAX_FILE) return null;
  return { path: file.rel, text: fs.readFileSync(file.abs, "utf8"), size: st.size, updatedAt: Math.round(st.mtimeMs) };
}

/** Removes one file (never the entry page); empty folders go with it. */
export function deleteFile(id: string, p: string): ArtifactMaterial | null {
  const m = artifactOf(id);
  if (!m) return null;
  const file = fileOf(id, p);
  if (!file) throw new UserError(`"${p}" is not a valid path inside an artifact.`);
  if (file.rel === asArtifact(m.content).entry) throw new UserError("The entry page can't be removed; replace it instead.");
  fs.rmSync(file.abs, { force: true });
  let dir = path.dirname(file.abs);
  while (dir !== dirOf(id) && fs.existsSync(dir) && !fs.readdirSync(dir).length) {
    fs.rmdirSync(dir);
    dir = path.dirname(dir);
  }
  return sync(id);
}

/** A file served to the frame: where it is, or null (unknown artifact, bad path, missing file). */
export function servedFile(id: string, p: string): string | null {
  if (!artifactOf(id)) return null;
  const file = fileOf(id, p || ARTIFACT_ENTRY);
  if (!file || !fs.existsSync(file.abs)) return null;
  const st = fs.statSync(file.abs);
  if (st.isDirectory()) {
    const index = path.join(file.abs, ARTIFACT_ENTRY);
    return fs.existsSync(index) ? index : null;
  }
  return file.abs;
}

const textOf = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** A new artifact from JSON: the HTML and any other text files. The title falls back to the page's <title>. */
export function createArtifact(courseId: string, input: NewArtifact): Material | null {
  if (typeof input.html !== "string" || !input.html.trim()) throw new UserError("html is required: the page's HTML.");
  const files = [{ path: ARTIFACT_ENTRY, data: Buffer.from(input.html, "utf8") }];
  for (const f of input.files ?? []) {
    if (!f || typeof f.path !== "string" || typeof f.text !== "string") throw new UserError("Each file needs a path and text.");
    const rel = artifactPath(f.path);
    if (!rel) throw new UserError(`"${f.path}" is not a valid path inside an artifact.`);
    if (rel === ARTIFACT_ENTRY) continue;
    files.push({ path: rel, data: Buffer.from(f.text, "utf8") });
  }
  return createFromFiles(courseId, {
    title: textOf(input.title, 200),
    description: textOf(input.description),
    source: textOf(input.source, 500),
    parentId: input.parentId ?? null,
    files,
  });
}

export type IncomingFile = { path: string; data?: Buffer; from?: string };

/**
 * Creates the material and writes its files (`data` in memory, or `from` a
 * file on disk, which is moved). One file must be the entry page: index.html,
 * or the only .html file, which is renamed.
 */
export function createFromFiles(
  courseId: string,
  input: { title: string; description: string; source: string; parentId: string | null; files: IncomingFile[] },
): Material | null {
  if (!repo.getCourse(courseId)) return null;
  const files = input.files.map((f) => ({ ...f, path: artifactPath(f.path) ?? "" }));
  if (files.some((f) => !f.path)) throw new UserError("A file has a path that can't be used inside an artifact.");
  if (!files.length) throw new UserError("An artifact needs at least its HTML page.");
  if (files.length > MAX_FILES) throw new UserError(`An artifact can hold at most ${MAX_FILES} files.`);
  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.path)) throw new UserError(`"${f.path}" is given twice.`);
    seen.add(f.path);
  }
  // The entry page: index.html, else the single .html file, else the single file.
  let entry = files.find((f) => f.path === ARTIFACT_ENTRY);
  if (!entry) {
    const htmls = files.filter((f) => /\.html?$/i.test(f.path));
    if (htmls.length === 1) entry = htmls[0];
    else if (htmls.length === 0 && files.length === 1) entry = files[0];
    else throw new UserError("Which page is the artifact? Include an index.html, or exactly one .html file.");
    entry.path = ARTIFACT_ENTRY;
  }
  const html = entry.data ? entry.data.toString("utf8") : fs.readFileSync(entry.from!, "utf8");
  const title = input.title || htmlTitle(html).slice(0, 200) || "Untitled artifact";

  const material = repo.createMaterial(courseId, {
    kind: "artifact",
    title,
    parentId: input.parentId,
    content: { entry: ARTIFACT_ENTRY, files: [], description: input.description, ...(input.source ? { source: input.source } : {}) },
  });
  if (!material) return null;
  try {
    for (const f of files) {
      const target = fileOf(material.id, f.path)!;
      ensureDir(target.abs);
      if (f.data) {
        if (f.data.length > MAX_FILE) throw new UserError(`"${f.path}" is larger than 16 MB.`);
        fs.writeFileSync(target.abs, f.data);
      } else if (f.from) {
        if (fs.statSync(f.from).size > MAX_FILE) throw new UserError(`"${f.path}" is larger than 16 MB.`);
        try {
          fs.renameSync(f.from, target.abs);
        } catch {
          fs.copyFileSync(f.from, target.abs);
          fs.rmSync(f.from, { force: true });
        }
      }
    }
  } catch (err) {
    removeDir(material.id);
    repo.purgeMaterial(material.id);
    throw err;
  }
  return sync(material.id);
}

export function removeDir(id: string) {
  fs.rmSync(dirOf(id), { recursive: true, force: true });
}

/** The artifact's folder as a zip (to take it to another tool). */
export function zipOf(id: string): { name: string; zip: yazl.ZipFile } | null {
  const m = artifactOf(id);
  if (!m) return null;
  const zip = new yazl.ZipFile();
  for (const f of listFiles(id)) {
    const file = fileOf(id, f.path);
    if (file) zip.addFile(file.abs, f.path, { compress: !/\.(png|jpe?g|gif|webp|woff2?|zip|pdf|mp4|webm)$/i.test(f.path) });
  }
  zip.end();
  return { name: `${(m.title || "artifact").replace(/[\\/:*?"<>|]+/g, "-").trim() || "artifact"}.zip`, zip };
}
