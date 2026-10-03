import { nanoid } from "nanoid";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Annotation } from "../../shared/content";
import { useUI } from "../store";

type Rect = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };

/** Smallest region, in percent of the image. */
const MIN_SIZE = 1.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = <T extends Rect>(r: T): T => ({
  ...r,
  x: +r.x.toFixed(2),
  y: +r.y.toFixed(2),
  w: +r.w.toFixed(2),
  h: +r.h.toFixed(2),
});
const boxStyle = (r: Rect) => ({ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` });

/**
 * An image with numbered regions. Drag on empty space to draw a region, drag a
 * region to move it, drag its corner to resize. Changes are reported once, on
 * pointer release, through `onCommit`.
 */
export function RegionStage({
  url,
  name,
  annotations,
  current,
  onCommit,
  numberOf,
  editing,
  onEdit,
  className = "ann-stage",
}: {
  url: string;
  name: string;
  annotations: Annotation[];
  /** The committed annotations right now (so a drag never starts from a stale render). */
  current: () => Annotation[];
  onCommit: (next: Annotation[]) => void;
  numberOf: (a: Annotation, index: number) => number;
  editing: string | null;
  onEdit: (id: string | null) => void;
  className?: string;
}) {
  // Regions being dragged or resized live here until the pointer is released.
  const [live, setLive] = useState<Annotation[] | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hovered = useUI((s) => s.hovered);
  const setHovered = useUI((s) => s.setHovered);
  const anns = live ?? annotations;

  const toPct = (e: { clientX: number; clientY: number }): Point => {
    const r = stageRef.current!.getBoundingClientRect();
    return {
      x: clamp(((e.clientX - r.left) / r.width) * 100, 0, 100),
      y: clamp(((e.clientY - r.top) / r.height) * 100, 0, 100),
    };
  };

  /** Follows the pointer until release; `moved` is false for a plain click. */
  const track = (e: ReactPointerEvent, onMove: (p: Point) => void, onEnd: (moved: boolean) => void) => {
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 3) moved = true;
      if (moved) onMove(toPct(ev));
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      onEnd(moved);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const onStageDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = toPct(e);
    let rect: Rect | null = null;
    onEdit(null);
    track(
      e,
      (p) => {
        rect = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
        setDraft(rect);
      },
      () => {
        setDraft(null);
        const r = rect as Rect | null;
        if (!r || r.w < MIN_SIZE || r.h < MIN_SIZE) return;
        const ann: Annotation = { id: nanoid(10), ...round(r), comment: "" };
        onCommit([...current(), ann]);
        onEdit(ann.id);
        setHovered(ann.id, "image");
      },
    );
  };

  const dragRegion = (e: ReactPointerEvent, a: Annotation, mode: "move" | "resize") => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start = toPct(e);
    let next = a;
    track(
      e,
      (p) => {
        next =
          mode === "move"
            ? { ...a, x: clamp(a.x + p.x - start.x, 0, 100 - a.w), y: clamp(a.y + p.y - start.y, 0, 100 - a.h) }
            : { ...a, w: clamp(p.x - a.x, MIN_SIZE, 100 - a.x), h: clamp(p.y - a.y, MIN_SIZE, 100 - a.y) };
        setLive(current().map((x) => (x.id === a.id ? next : x)));
      },
      (moved) => {
        setLive(null);
        if (moved) onCommit(current().map((x) => (x.id === a.id ? round(next) : x)));
        else if (mode === "move") onEdit(a.id);
      },
    );
  };

  const hoveredHere = hovered !== null && anns.some((a) => a.id === hovered);

  return (
    <div ref={stageRef} className={className} onPointerDown={onStageDown}>
      <img src={url} alt={name} draggable={false} />
      {anns.map((a, i) => {
        const active = hovered === a.id;
        return (
          <div
            key={a.id}
            data-ann={a.id}
            className={`ann-box${active ? " is-active" : ""}${hoveredHere && !active ? " is-dim" : ""}${editing === a.id ? " is-editing" : ""}`}
            style={boxStyle(a)}
            onPointerDown={(e) => dragRegion(e, a, "move")}
            onMouseEnter={() => setHovered(a.id, "image")}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="ann-box-num">{numberOf(a, i)}</span>
            <span className="ann-box-handle" onPointerDown={(e) => dragRegion(e, a, "resize")} title="Drag to resize" />
          </div>
        );
      })}
      {draft && <div className="ann-draft" style={boxStyle(draft)} />}
    </div>
  );
}
