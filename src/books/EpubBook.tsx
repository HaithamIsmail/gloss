// An EPUB, paginated, rendered by foliate-js (vendor/foliate-js). Highlights are
// EPUB CFI ranges drawn by foliate's overlayer inside the book's own frame.
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { FoliateView } from "../../vendor/foliate-js/foliate";
import { Overlayer } from "../../vendor/foliate-js/overlayer.js";
import type { BookLoc } from "../../shared/pages";
import { flattenToc, normalizeQuote, type ViewerHandle, type ViewerProps } from "./types";

const FONT_SIZES = [13, 14, 15, 16, 17, 18, 20, 22, 24, 28];
const DEFAULT_SIZE = 17;
const SIZE_KEY = "gloss-epub-size";

const readSize = () => {
  try {
    const v = Number(localStorage.getItem(SIZE_KEY));
    return FONT_SIZES.includes(v) ? v : DEFAULT_SIZE;
  } catch {
    return DEFAULT_SIZE;
  }
};

/** The app's colours and type, read from the theme, for the book's frame. */
function themeCss(size: number) {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return `
    html {
      color: ${v("--color-text", "#201e1d")};
      background: ${v("--color-paper", "#fff")};
      font-size: ${size}px !important;
      line-height: 1.55;
    }
    body { font-family: ${v("--font-body", "Georgia, serif")}; }
    p, li, blockquote, dd { line-height: 1.55; }
    a:link { color: ${v("--color-accent", "#ec3013")}; }
    pre { white-space: pre-wrap !important; }
    ::selection { background: ${v("--color-accent-300", "#ffc4b8")}; }
    aside[epub|type~="endnote"], aside[epub|type~="footnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
  `;
}

const accent = () => getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "#ec3013";

export function EpubBook({ ref, ...props }: ViewerProps & { ref: Ref<ViewerHandle> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cb = useRef(props);
  cb.current = props;
  const state = useRef<{
    view: FoliateView | null;
    ready: Promise<void>;
    size: number;
    shown: Set<string>;
    lastQuery: string;
    results: string[];
    at: number;
  }>({ view: null, ready: Promise.resolve(), size: readSize(), shown: new Set(), lastQuery: "", results: [], at: -1 });

  const idOf = (cfi: string) => cb.current.highlights.find((h) => h.loc.kind === "epub" && h.loc.cfi === cfi)?.id ?? null;

  useEffect(() => {
    const host = hostRef.current!;
    const s = state.current;
    let dead = false;
    let resolveReady = () => {};
    s.ready = new Promise<void>((r) => (resolveReady = r));
    s.shown = new Set();
    let view: FoliateView | null = null;

    (async () => {
      await import("../../vendor/foliate-js/view.js");
      if (dead) return;
      view = document.createElement("foliate-view") as FoliateView;
      s.view = view;
      host.append(view);

      view.addEventListener("load", (e) => {
        const { doc, index } = e.detail;
        let timer = 0;
        doc.addEventListener("selectionchange", () => {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            const sel = doc.getSelection();
            if (!sel || sel.isCollapsed || !sel.rangeCount) return cb.current.onSelection(null);
            const range = sel.getRangeAt(0);
            const quote = normalizeQuote(sel.toString());
            if (!quote || !view) return cb.current.onSelection(null);
            const cfi = view.getCFI(index, range);
            const r = range.getBoundingClientRect();
            const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
            cb.current.onSelection({
              loc: { kind: "epub", cfi },
              quote,
              at: view.lastLocation?.fraction ?? 0,
              rect: { x: r.left + (frame?.left ?? 0), y: r.top + (frame?.top ?? 0), w: r.width, h: r.height },
            });
          }, 180);
        });
        doc.addEventListener("keydown", (ev: KeyboardEvent) => {
          if (ev.key === "ArrowRight" || ev.key === "PageDown") void view?.next();
          else if (ev.key === "ArrowLeft" || ev.key === "PageUp") void view?.prev();
        });
      });
      view.addEventListener("relocate", (e) => {
        const d = e.detail;
        cb.current.onLocation({
          loc: { kind: "epub", cfi: d.cfi },
          fraction: d.fraction ?? 0,
          label: d.tocItem?.label ? d.tocItem.label : `${Math.round((d.fraction ?? 0) * 100)}%`,
        });
      });
      view.addEventListener("draw-annotation", (e) => {
        const { draw, annotation } = e.detail;
        const active = idOf(annotation.value) === cb.current.activeId;
        draw(Overlayer.highlight, { color: accent() });
        if (active) draw(Overlayer.outline, { color: accent(), width: 2 });
      });
      view.addEventListener("show-annotation", (e) => {
        const id = idOf(e.detail.value);
        if (id) cb.current.onHighlightClick(id);
      });

      await view.open(cb.current.url);
      if (dead) return;
      view.renderer.setAttribute("flow", "paginated");
      view.renderer.setAttribute("gap", "6%");
      view.renderer.setAttribute("margin", "40px");
      view.renderer.setAttribute("max-inline-size", "760px");
      view.renderer.setStyles?.(themeCss(s.size));
      const toc = flattenToc(view.book.toc, (item) => void view?.goTo(item.href));
      cb.current.onReady({ length: view.book.sections.length, toc });
      const initial = cb.current.initial;
      await view.init({ lastLocation: initial?.kind === "epub" ? initial.cfi : undefined, showTextStart: true });
      for (const h of cb.current.highlights) {
        if (h.loc.kind !== "epub") continue;
        s.shown.add(h.loc.cfi);
        void view.addAnnotation({ value: h.loc.cfi });
      }
      resolveReady();
    })().catch((err) => {
      if (!dead) cb.current.onError((err as Error).message || "Could not open the EPUB.");
    });

    return () => {
      dead = true;
      try {
        view?.close();
      } catch {
        /* already closed */
      }
      view?.remove();
      s.view = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.url]);

  // Keep foliate's overlays in step with the highlight list, and redraw the active one.
  const prevActive = useRef<string | null>(null);
  useEffect(() => {
    const s = state.current;
    const view = s.view;
    if (!view) return;
    void s.ready.then(() => {
      const wanted = new Map(props.highlights.flatMap((h) => (h.loc.kind === "epub" ? [[h.loc.cfi, h.id] as const] : [])));
      for (const cfi of s.shown) {
        if (!wanted.has(cfi)) {
          void view.deleteAnnotation({ value: cfi });
          s.shown.delete(cfi);
        }
      }
      for (const [cfi, id] of wanted) {
        const changed = id === props.activeId || id === prevActive.current;
        if (!s.shown.has(cfi) || changed) {
          s.shown.add(cfi);
          void view.addAnnotation({ value: cfi });
        }
      }
      prevActive.current = props.activeId;
    });
  }, [props.highlights, props.activeId]);

  useImperativeHandle(ref, () => ({
    goTo: async (loc: BookLoc) => {
      const s = state.current;
      if (loc.kind !== "epub" || !s.view) return;
      await s.ready;
      await s.view.goTo(loc.cfi);
    },
    next: () => void state.current.view?.next(),
    prev: () => void state.current.view?.prev(),
    zoom: (dir) => {
      const s = state.current;
      const i = FONT_SIZES.indexOf(s.size);
      s.size = dir === 0 ? DEFAULT_SIZE : FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, i + dir))];
      try {
        localStorage.setItem(SIZE_KEY, String(s.size));
      } catch {
        /* private mode */
      }
      s.view?.renderer.setStyles?.(themeCss(s.size));
    },
    find: (query, dir) => {
      const s = state.current;
      const view = s.view;
      if (!view) return;
      if (query !== s.lastQuery) {
        s.lastQuery = query;
        s.results = [];
        s.at = -1;
        void (async () => {
          const gen = (view as unknown as { search: (o: object) => AsyncGenerator<unknown> }).search({ query, matchCase: false });
          for await (const r of gen) {
            if (s.lastQuery !== query) return;
            const item = r as { subitems?: { cfi: string }[]; cfi?: string };
            if (item.subitems) s.results.push(...item.subitems.map((x) => x.cfi));
            else if (item.cfi) s.results.push(item.cfi);
            cb.current.onFind({ current: s.at + 1, total: s.results.length });
            if (s.results.length && s.at < 0) {
              s.at = 0;
              cb.current.onFind({ current: 1, total: s.results.length });
              void view.goTo(s.results[0]);
            }
          }
          if (!s.results.length) cb.current.onFind({ current: 0, total: 0 });
        })();
        return;
      }
      if (!s.results.length) return;
      s.at = (s.at + dir + s.results.length) % s.results.length;
      cb.current.onFind({ current: s.at + 1, total: s.results.length });
      void view.goTo(s.results[s.at]);
    },
    clearFind: () => {
      const s = state.current;
      s.lastQuery = "";
      s.results = [];
      s.at = -1;
      (s.view as unknown as { clearSearch?: () => void } | null)?.clearSearch?.();
      cb.current.onFind(null);
    },
    clearSelection: () => {
      for (const { doc } of state.current.view?.renderer.getContents() ?? []) doc.getSelection()?.removeAllRanges();
    },
  }));

  return <div ref={hostRef} className="epub-host" />;
}
