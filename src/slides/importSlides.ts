// Imports a PDF or slide deck as a folder of annotated image pages.
// The server converts decks to PDF; pages are rendered here with pdf.js,
// uploaded as images, and the folder is created in a single request.
import type { Material } from "../../shared/api";
import type { FolderSource } from "../../shared/pages";
import { api } from "../api";

export const SLIDE_ACCEPT = ".pdf,.pptx,.ppt,.pptm,.ppsx,.pps,.odp,application/pdf";

export type ImportStep = {
  message: string;
  /** Pages rendered so far, out of `total` (only while rendering). */
  done?: number;
  total?: number;
};

/** Pixel width pages are rendered at: sharp when zoomed, still a modest file. */
const TARGET_WIDTH = 2000;

const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

type TextRun = { str: string; size: number };

const hasWords = (s: string) => (s.match(/\p{L}/gu)?.length ?? 0) >= 2;

/**
 * A title for the page ("3. Cardiac cycle"): the text set in the largest type,
 * which is the heading on slides and handouts. Falls back to the first line
 * with words in it, then to "Slide 3".
 */
function pageTitle(n: number, runs: TextRun[], text: string, label: string) {
  const words = runs.filter((r) => hasWords(r.str));
  let title = "";
  if (words.length) {
    const sizes = words.map((r) => r.size).sort((a, b) => a - b);
    const largest = sizes[sizes.length - 1];
    const median = sizes[Math.floor(sizes.length / 2)];
    if (largest > median * 1.15 || words.length <= 3) {
      title = words
        .filter((r) => r.size >= largest * 0.9)
        .map((r) => r.str.trim())
        .join(" ");
    }
  }
  if (!title) title = text.split("\n").map((l) => l.trim()).find(hasWords) ?? "";
  title = title.replace(/\s+/g, " ").trim();
  if (!title) return `${label} ${n}`;
  return `${n}. ${title.length > 70 ? `${title.slice(0, 67).trimEnd()}…` : title}`;
}

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

export async function importSlides(
  file: File,
  courseId: string,
  onStep: (step: ImportStep) => void,
  signal: AbortSignal,
): Promise<Material> {
  const stem = file.name.replace(/\.[^.]+$/, "");
  const pdf = isPdf(file);
  const label = pdf ? "Page" : "Slide";
  const check = () => {
    if (signal.aborted) throw new DOMException("Import cancelled", "AbortError");
  };

  // 1. Get a PDF of the file onto the server.
  let source: FolderSource;
  if (pdf) {
    onStep({ message: "Uploading the PDF…" });
    const up = await api.upload(file);
    source = { name: file.name, url: up.url, pdfUrl: up.url, type: "pdf" };
  } else {
    const converter = (await api.slideConverter()).slides;
    onStep({
      message: `Converting the slides with ${converter === "libreoffice" ? "LibreOffice" : "PowerPoint"}… this can take a minute.`,
    });
    const conv = await api.convertSlides(file);
    source = { name: conv.name, url: conv.url, pdfUrl: conv.pdfUrl, type: "slides" };
  }
  check();

  // 2. Render every page to an image, and keep its text for search.
  onStep({ message: "Opening the document…" });
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    url: source.pdfUrl,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    iccUrl: "/pdfjs/iccs/",
  });
  const doc = await task.promise;

  const pages: { title: string; url: string; name: string; text?: string }[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      check();
      onStep({ message: `Rendering ${label.toLowerCase()} ${n} of ${doc.numPages}…`, done: n - 1, total: doc.numPages });
      const page = await doc.getPage(n);
      const scale = Math.min(3, TARGET_WIDTH / page.getViewport({ scale: 1 }).width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // "print" renders without requestAnimationFrame, which browsers pause in
      // background tabs: the import keeps going if you switch away.
      await page.render({ canvas, canvasContext: ctx, viewport, intent: "print" }).promise;

      const items = (await page.getTextContent()).items;
      const runs: TextRun[] = items.flatMap((it) =>
        "str" in it && it.str.trim() ? [{ str: it.str, size: it.height || Math.hypot(it.transform[2], it.transform[3]) }] : [],
      );
      const text = items
        .map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : ""))
        .join("")
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{2,}/g, "\n")
        .trim();

      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not render the page."))), "image/jpeg", 0.9),
      );
      canvas.width = canvas.height = 0; // release the bitmap early
      page.cleanup();

      const up = await api.upload(new File([blob], `${stem}-${label.toLowerCase()}-${n}.jpg`, { type: "image/jpeg" }));
      pages.push({ title: pageTitle(n, runs, text, label), url: up.url, name: `${stem} · ${label} ${n}`, text: text || undefined });
    }
  } finally {
    void task.destroy();
  }
  check();

  // 3. Create the folder and its pages.
  onStep({ message: `Creating ${pages.length} annotated pages…`, done: pages.length, total: pages.length });
  return api.createSlideFolder(courseId, { title: stem, source, pages });
}
