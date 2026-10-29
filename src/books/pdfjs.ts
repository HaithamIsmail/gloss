// pdf.js, set up once: the worker, and where its fonts and character maps are served from.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
// The viewer module (web/pdf_viewer.mjs) finds the library through this global.
const g = globalThis as { pdfjsLib?: unknown };
g.pdfjsLib ??= pdfjs;

export const PDF_ASSETS = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  iccUrl: "/pdfjs/iccs/",
};

/**
 * Opens a PDF by URL. Only the parts needed are fetched (HTTP range requests),
 * so a 1,000-page book opens as fast as a leaflet.
 */
export const openPdf = (url: string) =>
  pdfjs.getDocument({ url, ...PDF_ASSETS, disableAutoFetch: true, rangeChunkSize: 256 * 1024 });

export { pdfjs };
