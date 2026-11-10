import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Material } from "../../shared/api";
import { blockElement, scrollToBlock } from "../editor/links";
import { useUI } from "../store";

const INDEX_MIN = 160;
const INDEX_MAX = 520;
const INDEX_DEFAULT = 210;

/** Sticky table of contents built from the material's sections and subsections. */
export function IndexPanel({ material }: { material: Material }) {
  const live = useUI((s) => (s.doc.materialId === material.id ? s.doc.outline : null));
  const numbering = useUI((s) => s.prefs.numbering);
  const outline = live ?? material.outline;
  const [activeId, setActiveId] = useState<string | null>(null);
  const width = useUI((s) => s.prefs.indexWidth ?? INDEX_DEFAULT);
  const setPref = useUI((s) => s.setPref);
  const [resizing, setResizing] = useState(false);

  // Dragging the left edge: the panel sits on the right, so moving left widens it.
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setResizing(true);
    const move = (ev: PointerEvent) => {
      const next = Math.round(Math.min(INDEX_MAX, Math.max(INDEX_MIN, startW + startX - ev.clientX)));
      setPref("indexWidth", next);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setResizing(false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  // Scroll-spy: the last heading above the upper third of the viewport.
  useEffect(() => {
    const scroller = document.getElementById("main-scroll");
    if (!scroller) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const limit = scroller.getBoundingClientRect().top + scroller.clientHeight / 3;
        let current: string | null = null;
        for (const o of outline) {
          const el = blockElement(o.id);
          if (el && el.getBoundingClientRect().top <= limit) current = o.id;
        }
        setActiveId(current ?? outline[0]?.id ?? null);
      });
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener("scroll", update);
    };
  }, [outline]);

  return (
    <nav className={`index-panel${resizing ? " is-resizing" : ""}`} aria-label="Index" style={{ flexBasis: width }}>
      <div
        className="index-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the index"
        aria-valuemin={INDEX_MIN}
        aria-valuemax={INDEX_MAX}
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={startResize}
        onDoubleClick={() => setPref("indexWidth", undefined)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 40 : 10;
          if (e.key === "ArrowLeft") setPref("indexWidth", Math.min(INDEX_MAX, width + step));
          else if (e.key === "ArrowRight") setPref("indexWidth", Math.max(INDEX_MIN, width - step));
          else return;
          e.preventDefault();
        }}
      />
      <div className="index-head">Index</div>
      {outline.map((o) => (
        <button
          type="button"
          key={o.id}
          className={`index-item level-${o.level}${activeId === o.id ? " is-active" : ""}`}
          onClick={() => scrollToBlock(o.id, { flash: true })}
        >
          {numbering && <span className="index-num tabular">{o.num}</span>}
          <span className="index-text">{o.text || "Untitled"}</span>
        </button>
      ))}
      {!outline.length && (
        <p className="index-empty">Add a Section or Subsection (type / in the page) and it appears here.</p>
      )}
    </nav>
  );
}
