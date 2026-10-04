import { useLayoutEffect, useState } from "react";
import { blockElement } from "../editor/links";
import { useUI } from "../store";
import { CommentText } from "../annotate/CommentText";

const WIDTH = 300;
const GAP = 10;

/**
 * Hovering a linked passage highlights its region on the image. When that
 * image is scrolled out of view, this card shows the region next to the
 * passage instead.
 */
export function RegionPeek() {
  const hovered = useUI((s) => s.hovered);
  const source = useUI((s) => s.hoverSource);
  const region = useUI((s) => (s.hovered ? s.doc.regions.find((r) => r.id === s.hovered) : undefined));
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);

  useLayoutEffect(() => {
    setPos(null);
    if (source !== "text" || !region?.url || !hovered) return;

    const stage = blockElement(region.blockId)?.querySelector(".ann-stage");
    const scroller = document.getElementById("main-scroll");
    if (stage && scroller) {
      const s = stage.getBoundingClientRect();
      const v = scroller.getBoundingClientRect();
      const visible = Math.min(s.bottom, v.bottom) - Math.max(s.top, v.top);
      if (visible > Math.min(s.height, v.height) * 0.5) return; // image already on screen
    }

    const anchor = document.querySelector(`.ann-link[data-value="${CSS.escape(hovered)}"]:hover`);
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const left = Math.min(Math.max(12, a.left), window.innerWidth - WIDTH - 12);
    const above = a.bottom + 260 > window.innerHeight;
    setPos({ left, top: above ? a.top - GAP : a.bottom + GAP, above });
  }, [hovered, source, region]);

  if (!pos || !region) return null;

  return (
    <div
      className={`region-peek${pos.above ? " is-above" : ""}`}
      style={{ left: pos.left, top: pos.top, width: WIDTH }}
      aria-hidden
    >
      <div className="region-peek-stage">
        <div className="region-peek-frame">
          <img src={region.url} alt="" />
          <div
            className="region-peek-box"
            style={{ left: `${region.x}%`, top: `${region.y}%`, width: `${region.w}%`, height: `${region.h}%` }}
          >
            <span>{region.n}</span>
          </div>
        </div>
      </div>
      <div className="region-peek-body">
        <span className="ann-badge is-solid">{region.n}</span>
        {region.comment ? <CommentText text={region.comment} /> : <span>No comment yet</span>}
      </div>
    </div>
  );
}
