// Adds a PDF or EPUB to a course as a book: the file is uploaded as it is, its
// title, author and cover are read from it, and a book material is created.
import type { NavigateFunction } from "react-router";
import type { Material } from "../../shared/api";
import type { BookContent, BookFormat } from "../../shared/pages";
import { api, keys, queryClient } from "../api";
import { useUI } from "../store";

export const BOOK_ACCEPT = ".pdf,.epub,application/pdf,application/epub+zip";

const isEpub = (file: File) => file.type === "application/epub+zip" || /\.epub$/i.test(file.name);
const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

export const bookFormatOf = (file: File): BookFormat | null => (isEpub(file) ? "epub" : isPdf(file) ? "pdf" : null);

export function pickBookFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = BOOK_ACCEPT;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

type Details = { title: string; authors: string; year?: string; publisher?: string; description?: string; length: number; cover: Blob | null };

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Titles and names in EPUB metadata can be a string, a language map, or a list of either. */
function text(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return oneLine(v);
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("name" in o) return text(o.name);
    const first = Object.values(o)[0];
    return typeof first === "string" ? oneLine(first) : "";
  }
  return "";
}

async function pdfDetails(url: string, stem: string): Promise<Details> {
  const { openPdf } = await import("./pdfjs");
  const task = openPdf(url);
  const doc = await task.promise;
  try {
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as Record<string, unknown>;
    const title = text(info.Title);
    const authors = text(info.Author);
    const created = typeof info.CreationDate === "string" ? /D:(\d{4})/.exec(info.CreationDate)?.[1] : undefined;
    // The cover: page 1, small.
    let cover: Blob | null = null;
    try {
      const page = await doc.getPage(1);
      const scale = 480 / page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport, intent: "print" }).promise;
      cover = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      canvas.width = canvas.height = 0;
      page.cleanup();
    } catch {
      cover = null;
    }
    return { title: title || stem, authors, year: created, length: doc.numPages, cover };
  } finally {
    void task.destroy();
  }
}

async function epubDetails(file: File, stem: string): Promise<Details> {
  const { makeBook } = await import("../../vendor/foliate-js/view.js");
  const book = await makeBook(file);
  try {
    const m = book.metadata ?? {};
    const extra = m as Record<string, unknown>;
    const published = typeof extra.published === "string" ? /^\d{4}/.exec(extra.published)?.[0] : undefined;
    const cover = (await book.getCover?.()) ?? null;
    return {
      title: text(m.title) || stem,
      authors: text(m.author),
      year: published,
      publisher: text(extra.publisher) || undefined,
      description: typeof m.description === "string" ? m.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000) : undefined,
      length: book.sections?.length ?? 0,
      cover,
    };
  } finally {
    book.destroy?.();
  }
}

export async function importBook(
  file: File,
  courseId: string | null,
  parentId: string | null,
  onStep: (message: string) => void,
  signal: AbortSignal,
): Promise<Material> {
  const format = bookFormatOf(file);
  if (!format) throw new Error("Only PDF and EPUB files can be added to the library.");
  const stem = file.name.replace(/\.[^.]+$/, "");
  const check = () => {
    if (signal.aborted) throw new DOMException("Import cancelled", "AbortError");
  };

  onStep(`Uploading ${format === "pdf" ? "the PDF" : "the EPUB"}…`);
  const up = await api.upload(file);
  check();

  onStep("Reading the title, author and cover…");
  let details: Details;
  try {
    details = format === "pdf" ? await pdfDetails(up.url, stem) : await epubDetails(file, stem);
  } catch (err) {
    console.error(err);
    details = { title: stem, authors: "", length: 0, cover: null };
  }
  check();

  let coverUrl: string | null = null;
  if (details.cover) {
    const ext = details.cover.type === "image/png" ? "png" : "jpg";
    try {
      coverUrl = (await api.upload(new File([details.cover], `${stem}-cover.${ext}`, { type: details.cover.type || "image/jpeg" }))).url;
    } catch {
      coverUrl = null;
    }
  }
  check();

  onStep("Adding the book…");
  const content: BookContent = {
    file: { url: up.url, name: file.name, format, size: file.size },
    meta: {
      authors: details.authors,
      ...(details.year ? { year: details.year } : {}),
      ...(details.publisher ? { publisher: details.publisher } : {}),
      ...(details.description ? { description: details.description } : {}),
      tags: [],
    },
    coverUrl,
    length: details.length,
    status: "unread",
    progress: { loc: null, fraction: 0, updatedAt: 0 },
    highlights: [],
  };
  return api.createMaterial(courseId, { kind: "book", title: details.title.slice(0, 200), content, parentId });
}

/** Asks for a PDF or EPUB and adds it as a book: to a course (or folder), or to the library only (`courseId` null). */
export async function startBookImport(
  courseId: string | null,
  navigate: NavigateFunction,
  parentId: string | null = null,
  picked?: File,
) {
  if (useUI.getState().slideImport) return;
  const file = picked ?? (await pickBookFile());
  if (!file) return;
  const ctrl = new AbortController();
  const { setSlideImport, setExpanded } = useUI.getState();
  setSlideImport({ fileName: file.name, message: "Starting…", cancel: () => ctrl.abort() });
  const update = (patch: { message?: string; error?: string; cancel?: () => void }) =>
    useUI.setState((s) => (s.slideImport ? { slideImport: { ...s.slideImport, ...patch } } : {}));
  try {
    const book = await importBook(file, courseId, parentId, (message) => update({ message }), ctrl.signal);
    await queryClient.invalidateQueries({ queryKey: keys.tree });
    void queryClient.invalidateQueries({ queryKey: keys.books });
    if (courseId) setExpanded(courseId, true);
    if (parentId) setExpanded(parentId, true);
    setSlideImport(null);
    navigate(`/m/${book.id}`);
  } catch (err) {
    if (ctrl.signal.aborted) return setSlideImport(null);
    console.error(err);
    update({ error: (err as Error).message || "The book could not be added.", cancel: () => setSlideImport(null) });
  }
}

// In development the import can be driven from the console without a file dialog:
// window.__addBook(await (await fetch("/uploads/x.pdf")).blob(), "sample.pdf", courseId?)
if (import.meta.env.DEV) {
  (window as unknown as { __addBook: unknown }).__addBook = (blob: Blob, name: string, courseId: string | null = null) =>
    startBookImport(courseId, (to) => void (window.location.href = String(to)), null, new File([blob], name, { type: blob.type }));
}
