// A PDF, page after page, with pdf.js's viewer: pages render as they scroll into
// view and only the bytes needed are fetched. Highlights are drawn in a layer of
// our own on each page, as rectangles in fractions of the page.
// The library itself must load before the viewer module, which looks for it on globalThis.
import { openPdf } from "./pdfjs";
import "./pdf_viewer.css";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { BookLoc, PdfLoc } from "../../shared/pages";
import { flattenToc, normalizeQuote, round4, type ViewerHandle, type ViewerProps } from "./types";

type PdfRect = PdfLoc["rects"][number];

/** Joins rectangles on the same line (pdf.js makes one span per run of text). */
function mergeRects(rects: PdfRect[]): PdfRect[] {
  const sorted = [...rects].sort((a, b) => a.p - b.p || a.y - b.y || a.x - b.x);
  const out: PdfRect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    const sameLine = last && last.p === r.p && Math.abs(last.y - r.y) < 0.004 && Math.abs(last.h - r.h) < 0.006;
    if (sameLine && r.x <= last.x + last.w + 0.012) {
      const right = Math.max(last.x + last.w, r.x + r.w);
      last.x = Math.min(last.x, r.x);
      last.w = right - last.x;
      last.y = Math.min(last.y, r.y);
      last.h = Math.max(last.h, r.h);
    } else {
      out.push({ ...r });
    }
  }
  return out.map((r) => ({ p: r.p, x: round4(r.x), y: round4(r.y), w: round4(r.w), h: round4(r.h) }));
}

const pageSelector = (n: number) => `.page[data-page-number="${n}"]`;

export function PdfBook({ ref, ...props }: ViewerProps & { ref: Ref<ViewerHandle> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cb = useRef(props);
  cb.current = props;
  const state = useRef<{
    viewer: PDFViewer | null;
    bus: EventBus | null;
    links: PDFLinkService | null;
    doc: PDFDocumentProxy | null;
    ready: Promise<void>;
    lastQuery: string;
  }>({ viewer: null, bus: null, links: null, doc: null, ready: Promise.resolve(), lastQuery: "" });

  /** Draws (or redraws) the highlights that fall on one page. */
  const paint = (n: number) => {
    const container = containerRef.current;
    const pageDiv = container?.querySelector<HTMLElement>(pageSelector(n));
    if (!pageDiv) return;
    let layer = pageDiv.querySelector<HTMLElement>(":scope > .book-hl-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "book-hl-layer";
      pageDiv.append(layer);
    }
    const boxes: HTMLElement[] = [];
    for (const h of cb.current.highlights) {
      if (h.loc.kind !== "pdf") continue;
      for (const r of h.loc.rects) {
        if (r.p !== n) continue;
        const d = document.createElement("div");
        d.className = `book-hl${h.id === cb.current.activeId ? " is-active" : ""}`;
        d.dataset.hl = h.id;
        d.style.left = `${r.x * 100}%`;
        d.style.top = `${r.y * 100}%`;
        d.style.width = `${r.w * 100}%`;
        d.style.height = `${r.h * 100}%`;
        boxes.push(d);
      }
    }
    layer.replaceChildren(...boxes);
  };

  const paintAll = () => {
    containerRef.current
      ?.querySelectorAll<HTMLElement>(".page[data-page-number]")
      .forEach((el) => paint(Number(el.dataset.pageNumber)));
  };

  useEffect(() => {
    const container = containerRef.current!;
    const inner = container.firstElementChild as HTMLDivElement;
    const bus = new EventBus();
    const links = new PDFLinkService({ eventBus: bus });
    const findController = new PDFFindController({ eventBus: bus, linkService: links });
    const viewer = new PDFViewer({
      container,
      viewer: inner,
      eventBus: bus,
      linkService: links,
      findController,
      textLayerMode: 1,
      annotationMode: 1,
    });
    links.setViewer(viewer);
    let resolveReady = () => {};
    const s = state.current;
    s.viewer = viewer;
    s.bus = bus;
    s.links = links;
    s.ready = new Promise<void>((r) => (resolveReady = r));
    let numPages = 0;
    let dead = false;

    bus.on("pagesinit", () => {
      viewer.currentScaleValue = "page-width";
      const initial = cb.current.initial;
      if (initial?.kind === "pdf" && initial.page > 1 && initial.page <= numPages) viewer.currentPageNumber = initial.page;
      resolveReady();
    });
    bus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => {
      if (!numPages) return;
      cb.current.onLocation({
        loc: { kind: "pdf", page: pageNumber, rects: [] },
        fraction: pageNumber / numPages,
        label: `p. ${pageNumber} / ${numPages}`,
      });
    });
    bus.on("pagerendered", ({ pageNumber }: { pageNumber: number }) => paint(pageNumber));
    bus.on("updatefindmatchescount", ({ matchesCount }: { matchesCount: { current: number; total: number } }) => {
      cb.current.onFind(matchesCount.total ? matchesCount : { current: 0, total: 0 });
    });
    bus.on("updatefindcontrolstate", ({ matchesCount }: { matchesCount: { current: number; total: number } }) => {
      cb.current.onFind(matchesCount.total ? matchesCount : { current: 0, total: 0 });
    });

    const task = openPdf(cb.current.url);
    task.promise
      .then(async (doc) => {
        if (dead) return;
        s.doc = doc;
        numPages = doc.numPages;
        viewer.setDocument(doc);
        links.setDocument(doc, null);
        const outline = await doc.getOutline().catch(() => null);
        const toc = flattenToc(outline, (item) => {
          if (item.dest) void links.goToDestination(item.dest);
        });
        cb.current.onReady({ length: doc.numPages, toc });
      })
      .catch((err) => {
        if (!dead) cb.current.onError((err as Error).message || "Could not open the PDF.");
      });

    // Selected text → a highlight-to-be (page rectangles in fractions of the page).
    let selTimer = 0;
    const onSelectionChange = () => {
      window.clearTimeout(selTimer);
      selTimer = window.setTimeout(() => {
        const sel = document.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount || !container.contains(sel.anchorNode) || !container.contains(sel.focusNode)) {
          return cb.current.onSelection(null);
        }
        const range = sel.getRangeAt(0);
        const pages = Array.from(container.querySelectorAll<HTMLElement>(".page[data-page-number]"))
          .map((el) => ({ n: Number(el.dataset.pageNumber), box: el.getBoundingClientRect() }))
          .filter((p) => p.box.height > 0);
        const rects: PdfRect[] = [];
        for (const r of Array.from(range.getClientRects())) {
          if (r.width < 1 || r.height < 1) continue;
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const p = pages.find((p) => cx >= p.box.left && cx <= p.box.right && cy >= p.box.top && cy <= p.box.bottom);
          if (!p) continue;
          const rect = {
            p: p.n,
            x: (r.left - p.box.left) / p.box.width,
            y: (r.top - p.box.top) / p.box.height,
            w: r.width / p.box.width,
            h: r.height / p.box.height,
          };
          // Whole-page boxes come from the text layer's end-of-content element, not from text.
          if (rect.h > 0.2 || rect.w * rect.h > 0.3) continue;
          rects.push(rect);
        }
        const merged = mergeRects(rects);
        const quote = normalizeQuote(sel.toString());
        if (!merged.length || !quote) return cb.current.onSelection(null);
        const first = merged[0];
        const b = range.getBoundingClientRect();
        cb.current.onSelection({
          loc: { kind: "pdf", page: first.p, rects: merged },
          quote,
          at: numPages ? (first.p - 1 + first.y) / numPages : 0,
          rect: { x: b.left, y: b.top, w: b.width, h: b.height },
        });
      }, 180);
    };
    document.addEventListener("selectionchange", onSelectionChange);

    // A click on a highlight (the layer itself lets pointer events through, so text stays selectable).
    const onClick = (e: MouseEvent) => {
      const sel = document.getSelection();
      if (sel && !sel.isCollapsed) return;
      const pageDiv = (e.target as Element).closest<HTMLElement>(".page[data-page-number]");
      if (!pageDiv) return;
      const n = Number(pageDiv.dataset.pageNumber);
      const box = pageDiv.getBoundingClientRect();
      const x = (e.clientX - box.left) / box.width;
      const y = (e.clientY - box.top) / box.height;
      for (const h of [...cb.current.highlights].reverse()) {
        if (h.loc.kind !== "pdf") continue;
        if (h.loc.rects.some((r) => r.p === n && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) {
          return cb.current.onHighlightClick(h.id);
        }
      }
    };
    container.addEventListener("click", onClick);

    return () => {
      dead = true;
      window.clearTimeout(selTimer);
      document.removeEventListener("selectionchange", onSelectionChange);
      container.removeEventListener("click", onClick);
      viewer.setDocument(null as unknown as PDFDocumentProxy);
      void task.destroy();
      s.viewer = null;
      s.doc = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.url]);

  // Highlights or the active one changed: repaint the pages on screen.
  useEffect(paintAll, [props.highlights, props.activeId]);

  /** Resolves once page `n` has rendered (or right away if it already has). */
  const rendered = (n: number) =>
    new Promise<void>((resolve) => {
      const el = containerRef.current?.querySelector<HTMLElement>(pageSelector(n));
      if (el?.hasAttribute("data-loaded")) return resolve();
      const bus = state.current.bus;
      if (!bus) return resolve();
      const timer = window.setTimeout(done, 3000);
      function done() {
        window.clearTimeout(timer);
        bus?.off("pagerendered", onRender);
        resolve();
      }
      function onRender({ pageNumber }: { pageNumber: number }) {
        if (pageNumber === n) done();
      }
      bus.on("pagerendered", onRender);
    });

  useImperativeHandle(ref, () => ({
    goTo: async (loc: BookLoc) => {
      const s = state.current;
      if (loc.kind !== "pdf" || !s.viewer) return;
      await s.ready;
      const viewer = s.viewer;
      const page = Math.min(Math.max(1, loc.page), viewer.pagesCount);
      viewer.currentPageNumber = page;
      await rendered(page);
      const container = containerRef.current;
      const pageDiv = container?.querySelector<HTMLElement>(pageSelector(page));
      const r = loc.rects[0];
      if (!container || !pageDiv || !r) return;
      const top = pageDiv.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTo({ top: top + r.y * pageDiv.clientHeight - container.clientHeight * 0.3, behavior: "smooth" });
    },
    goToPage: (n: number) => {
      const v = state.current.viewer;
      if (v && n >= 1 && n <= v.pagesCount) v.currentPageNumber = n;
    },
    next: () => state.current.viewer?.nextPage(),
    prev: () => state.current.viewer?.previousPage(),
    zoom: (dir) => {
      const v = state.current.viewer;
      if (!v) return;
      if (dir === 0) v.currentScaleValue = "page-width";
      else v.currentScale = Math.min(6, Math.max(0.25, v.currentScale * (dir > 0 ? 1.2 : 1 / 1.2)));
    },
    find: (query, dir) => {
      const s = state.current;
      if (!s.bus) return;
      const again = query === s.lastQuery;
      s.lastQuery = query;
      s.bus.dispatch("find", {
        source: null,
        type: again ? "again" : "",
        query,
        caseSensitive: false,
        entireWord: false,
        highlightAll: true,
        findPrevious: dir < 0,
        matchDiacritics: false,
      });
    },
    clearFind: () => {
      const s = state.current;
      s.lastQuery = "";
      s.bus?.dispatch("findbarclose", { source: null });
      cb.current.onFind(null);
    },
    clearSelection: () => document.getSelection()?.removeAllRanges(),
  }));

  return (
    <div ref={containerRef} className="pdf-container">
      <div className="pdfViewer" />
    </div>
  );
}
