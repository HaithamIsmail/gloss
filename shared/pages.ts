// Material kinds and the content each one stores. Shared by server and client.
import {
  buildOutline,
  countRegions,
  type Annotation,
  type LooseBlock,
  type OutlineItem,
} from "./content";

export type MaterialKind = "doc" | "image" | "notebook" | "folder";

export const MATERIAL_KINDS: MaterialKind[] = ["doc", "image", "notebook", "folder"];

export const isMaterialKind = (v: unknown): v is MaterialKind =>
  typeof v === "string" && (MATERIAL_KINDS as string[]).includes(v);

// ── Annotated image page ─────────────────────────────────────────────────

export type ImagePageContent = {
  url: string;
  name: string;
  annotations: Annotation[];
  /** Text found on the page when it came from a PDF or slide deck (for search). */
  text?: string;
};

export function asImagePage(raw: unknown): ImagePageContent {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<ImagePageContent>;
  return {
    url: typeof o.url === "string" ? o.url : "",
    name: typeof o.name === "string" ? o.name : "",
    annotations: Array.isArray(o.annotations) ? o.annotations : [],
    ...(typeof o.text === "string" && o.text ? { text: o.text } : {}),
  };
}

// ── Folder (made by importing a PDF or slide deck) ───────────────────────

export type FolderSource = {
  /** Original file name, e.g. "Lecture 3.pptx". */
  name: string;
  /** The original upload. */
  url: string;
  /** The PDF the pages were rendered from (the original itself for a PDF). */
  pdfUrl: string;
  type: "pdf" | "slides";
};

export type FolderContent = { source?: FolderSource };

export function asFolder(raw: unknown): FolderContent {
  const o = (raw && typeof raw === "object" ? raw : {}) as FolderContent;
  const src = o.source;
  return src && typeof src.url === "string" ? { source: src } : {};
}

// ── Notebook page (nbformat 4, with `source` kept as one string) ─────────

export type MimeBundle = Record<string, string | string[]>;

export type NotebookOutput =
  | { output_type: "stream"; name: "stdout" | "stderr"; text: string | string[] }
  | { output_type: "execute_result"; execution_count: number | null; data: MimeBundle; metadata?: object }
  | { output_type: "display_data"; data: MimeBundle; metadata?: object }
  | { output_type: "error"; ename: string; evalue: string; traceback: string[] };

export type NotebookCell =
  | {
      id: string;
      cell_type: "code";
      source: string;
      execution_count: number | null;
      outputs: NotebookOutput[];
      metadata: Record<string, unknown>;
    }
  | {
      id: string;
      cell_type: "markdown" | "raw";
      source: string;
      metadata: Record<string, unknown>;
      /** Images pasted into a markdown cell, referenced as attachment:name. */
      attachments?: Record<string, MimeBundle>;
    };

export type NotebookContent = {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: 4;
  nbformat_minor: number;
};

const joinSource = (s: unknown) => (Array.isArray(s) ? s.join("") : typeof s === "string" ? s : "");

let idCounter = 0;
const cellId = () => `c${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function newCell(type: "code" | "markdown", source = ""): NotebookCell {
  return type === "code"
    ? { id: cellId(), cell_type: "code", source, execution_count: null, outputs: [], metadata: {} }
    : { id: cellId(), cell_type: "markdown", source, metadata: {} };
}

/** Accepts stored content or a raw .ipynb (any nbformat 4.x) and returns tidy notebook content. */
export function asNotebook(raw: unknown): NotebookContent {
  const o = (raw && typeof raw === "object" ? raw : {}) as { cells?: unknown[]; metadata?: Record<string, unknown> };
  const seen = new Set<string>();
  const cells = (Array.isArray(o.cells) ? o.cells : []).map((c): NotebookCell => {
    const cell = (c ?? {}) as Record<string, unknown>;
    let id = typeof cell.id === "string" && cell.id ? cell.id : cellId();
    if (seen.has(id)) id = cellId();
    seen.add(id);
    const metadata = (cell.metadata as Record<string, unknown>) ?? {};
    const source = joinSource(cell.source);
    if (cell.cell_type === "code") {
      return {
        id,
        cell_type: "code",
        source,
        execution_count: typeof cell.execution_count === "number" ? cell.execution_count : null,
        outputs: Array.isArray(cell.outputs) ? (cell.outputs as NotebookOutput[]) : [],
        metadata,
      };
    }
    const attachments = cell.attachments as Record<string, MimeBundle> | undefined;
    return {
      id,
      cell_type: cell.cell_type === "raw" ? "raw" : "markdown",
      source,
      metadata,
      ...(attachments && typeof attachments === "object" ? { attachments } : {}),
    };
  });
  return {
    cells,
    metadata: o.metadata ?? {},
    nbformat: 4,
    nbformat_minor: 5,
  };
}

export function emptyNotebook(): NotebookContent {
  return {
    cells: [newCell("markdown", "# Notes\n\nWrite markdown here. Double-click to edit."), newCell("code", "")],
    metadata: {
      kernelspec: { name: "python3", display_name: "Python 3 (Pyodide)", language: "python" },
      language_info: { name: "python" },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

/** ATX headings (# and ##) in a markdown source, ignoring fenced code. */
export function markdownHeadings(source: string): { level: 1 | 2; text: string }[] {
  const out: { level: 1 | 2; text: string }[] = [];
  let fenced = false;
  for (const line of source.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^(#{1,2})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length as 1 | 2, text: m[2].replace(/[*_`]/g, "") });
  }
  return out;
}

/** Id of the k-th section/subsection heading inside a markdown cell. */
export const headingId = (cellId: string, k: number) => `${cellId}-h${k}`;

export function notebookOutline(nb: NotebookContent): OutlineItem[] {
  const out: OutlineItem[] = [];
  let s = 0;
  let ss = 0;
  for (const cell of nb.cells) {
    if (cell.cell_type !== "markdown") continue;
    markdownHeadings(cell.source).forEach((h, k) => {
      if (h.level === 1) {
        s++;
        ss = 0;
        out.push({ id: headingId(cell.id, k), level: 1, text: h.text, num: `${s}` });
      } else {
        ss++;
        out.push({ id: headingId(cell.id, k), level: 2, text: h.text, num: `${s}.${ss}` });
      }
    });
  }
  return out;
}

// ── Per-kind helpers ─────────────────────────────────────────────────────

export function defaultContentFor(kind: MaterialKind, newId: () => string): unknown {
  if (kind === "image") return { url: "", name: "", annotations: [] } satisfies ImagePageContent;
  if (kind === "folder") return {} satisfies FolderContent;
  if (kind === "notebook") return emptyNotebook();
  return [
    { id: newId(), type: "heading", props: { level: 1 }, content: "Introduction", children: [] },
    { id: newId(), type: "paragraph", content: "", children: [] },
  ] satisfies LooseBlock[];
}

export function outlineFor(kind: MaterialKind, content: unknown): OutlineItem[] {
  if (kind === "notebook") return notebookOutline(asNotebook(content));
  if (kind === "image" || kind === "folder") return [];
  return buildOutline(Array.isArray(content) ? (content as LooseBlock[]) : []);
}

export function regionsFor(kind: MaterialKind, content: unknown): number {
  if (kind === "image") return asImagePage(content).annotations.length;
  if (kind === "notebook" || kind === "folder") return 0;
  return countRegions(Array.isArray(content) ? (content as LooseBlock[]) : []);
}

/** Content as stored: notebooks get stable cell ids, image pages a full shape. */
export function normalizeContent(kind: MaterialKind, content: unknown): unknown {
  if (kind === "notebook") return asNotebook(content);
  if (kind === "image") return asImagePage(content);
  if (kind === "folder") return asFolder(content);
  return content;
}
