import { useEffect, useState } from "react";
import type { Material } from "../../shared/api";
import { blockElement, scrollToBlock } from "../editor/links";
import { useUI } from "../store";

/** Sticky table of contents built from the material's sections and subsections. */
export function IndexPanel({ material }: { material: Material }) {
  const live = useUI((s) => (s.doc.materialId === material.id ? s.doc.outline : null));
  const numbering = useUI((s) => s.prefs.numbering);
  const outline = live ?? material.outline;
  const [activeId, setActiveId] = useState<string | null>(null);

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
    <nav className="index-panel" aria-label="Index">
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
