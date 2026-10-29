// Material kinds and the content each one stores. Shared by server and client.
import {
  buildOutline,
  countRegions,
  type Annotation,
  type LooseBlock,
  type OutlineItem,
} from "./content";

export type MaterialKind = "doc" | "image" | "notebook" | "folder" | "book";

export const MATERIAL_KINDS: MaterialKind[] = ["doc", "image", "notebook", "folder", "book"];

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

// ── Book (a PDF or EPUB kept as it is, read in the app) ─────────────────

export type BookFormat = "pdf" | "epub";

/** Where a highlight sits in a PDF: a page, and rectangles in fractions (0–1) of their page. */
export type PdfLoc = { kind: "pdf"; page: number; rects: { p: number; x: number; y: number; w: number; h: number }[] };

/** Where a highlight sits in an EPUB: an EPUB CFI (Canonical Fragment Identifier) range. */
export type EpubLoc = { kind: "epub"; cfi: string };

export type BookLoc = PdfLoc | EpubLoc;

export type BookHighlight = {
  id: string;
  loc: BookLoc;
  /** The highlighted text, kept so a link still means something if the file changes. */
  quote: string;
  /** Your note on the passage (shown in the panel and searchable). */
  note: string;
  /** Position in the book, 0–1, for ordering. */
  at: number;
  createdAt: number;
};

export type BookStatus = "unread" | "reading" | "done";

export type BookProgress = {
  /** Where you stopped: a PDF page or an EPUB CFI. */
  loc: BookLoc | null;
  /** 0–1 */
  fraction: number;
  /** "p. 42 / 310" or the chapter title, for the library. */
  label?: string;
  updatedAt: number;
};

export type BookMeta = {
  authors: string;
  year?: string;
  publisher?: string;
  description?: string;
  tags: string[];
};

export type BookContent = {
  file: { url: string; name: string; format: BookFormat; size: number };
  /** Metadata read from the file (editable afterwards). */
  meta: BookMeta;
  coverUrl: string | null;
  /** PDF pages, or EPUB sections. */
  length: number;
  status: BookStatus;
  progress: BookProgress;
  highlights: BookHighlight[];
};

export const BOOK_STATUS_LABEL: Record<BookStatus, string> = { unread: "To read", reading: "Reading", done: "Finished" };

export function asBookLoc(raw: unknown): BookLoc | null {
  const o = raw as { kind?: string; page?: unknown; rects?: unknown; cfi?: unknown } | null;
  if (!o || typeof o !== "object") return null;
  if (o.kind === "pdf" && typeof o.page === "number") {
    return { kind: "pdf", page: o.page, rects: Array.isArray(o.rects) ? (o.rects as PdfLoc["rects"]) : [] };
  }
  if (o.kind === "epub" && typeof o.cfi === "string") return { kind: "epub", cfi: o.cfi };
  return null;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function asBookMeta(raw: unknown): BookMeta {
  const m = (raw && typeof raw === "object" ? raw : {}) as Partial<BookMeta>;
  return {
    authors: str(m.authors),
    ...(m.year ? { year: str(m.year) } : {}),
    ...(m.publisher ? { publisher: str(m.publisher) } : {}),
    ...(m.description ? { description: str(m.description) } : {}),
    tags: Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === "string" && !!t) : [],
  };
}

export function asBookHighlight(raw: unknown): BookHighlight | null {
  const x = (raw ?? {}) as Partial<BookHighlight>;
  const loc = asBookLoc(x.loc);
  if (!x.id || typeof x.id !== "string" || !loc) return null;
  return {
    id: x.id,
    loc,
    quote: str(x.quote),
    note: str(x.note),
    at: typeof x.at === "number" ? Math.min(1, Math.max(0, x.at)) : 0,
    createdAt: typeof x.createdAt === "number" ? x.createdAt : 0,
  };
}

export function asBook(raw: unknown): BookContent {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<BookContent>;
  const file = (o.file ?? {}) as Partial<BookContent["file"]>;
  const progress = (o.progress ?? {}) as Partial<BookProgress>;
  return {
    file: {
      url: str(file.url),
      name: str(file.name),
      format: file.format === "epub" ? "epub" : "pdf",
      size: typeof file.size === "number" ? file.size : 0,
    },
    meta: asBookMeta(o.meta),
    coverUrl: typeof o.coverUrl === "string" && o.coverUrl ? o.coverUrl : null,
    length: typeof o.length === "number" ? o.length : 0,
    status: o.status === "reading" || o.status === "done" ? o.status : "unread",
    progress: {
      loc: asBookLoc(progress.loc),
      fraction: typeof progress.fraction === "number" ? Math.min(1, Math.max(0, progress.fraction)) : 0,
      ...(progress.label ? { label: str(progress.label) } : {}),
      updatedAt: typeof progress.updatedAt === "number" ? progress.updatedAt : 0,
    },
    highlights: (Array.isArray(o.highlights) ? o.highlights : [])
      .map(asBookHighlight)
      .filter((h): h is BookHighlight => !!h)
      .sort((a, b) => a.at - b.at || a.createdAt - b.createdAt),
  };
}

/** "p. 42 / 310", the chapter, or "32%": where you are in a book. */
export function bookProgressLabel(b: BookContent): string {
  const p = b.progress;
  if (p.loc?.kind === "pdf" && b.length) return `p. ${p.loc.page} / ${b.length}`;
  if (p.label) return p.label;
  return `${Math.round(p.fraction * 100)}%`;
}

// ── Per-kind helpers ─────────────────────────────────────────────────────

export function defaultContentFor(kind: MaterialKind, newId: () => string): unknown {
  if (kind === "image") return { url: "", name: "", annotations: [] } satisfies ImagePageContent;
  if (kind === "folder") return {} satisfies FolderContent;
  if (kind === "notebook") return emptyNotebook();
  if (kind === "book") return asBook({});
  return [
    { id: newId(), type: "heading", props: { level: 1 }, content: "Introduction", children: [] },
    { id: newId(), type: "paragraph", content: "", children: [] },
  ] satisfies LooseBlock[];
}

export function outlineFor(kind: MaterialKind, content: unknown): OutlineItem[] {
  if (kind === "notebook") return notebookOutline(asNotebook(content));
  if (kind === "image" || kind === "folder" || kind === "book") return [];
  return buildOutline(Array.isArray(content) ? (content as LooseBlock[]) : []);
}

/** Regions on an image page or in a page's images; highlights in a book. */
export function regionsFor(kind: MaterialKind, content: unknown): number {
  if (kind === "image") return asImagePage(content).annotations.length;
  if (kind === "book") return asBook(content).highlights.length;
  if (kind === "notebook" || kind === "folder") return 0;
  return countRegions(Array.isArray(content) ? (content as LooseBlock[]) : []);
}

/** Content as stored: notebooks get stable cell ids, image pages a full shape. */
export function normalizeContent(kind: MaterialKind, content: unknown): unknown {
  if (kind === "notebook") return asNotebook(content);
  if (kind === "image") return asImagePage(content);
  if (kind === "folder") return asFolder(content);
  if (kind === "book") return asBook(content);
  return content;
}
