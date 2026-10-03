// Dragging materials between courses and folders (sidebar and course page).
import type { DragEvent } from "react";
import { create } from "zustand";
import type { MaterialSummary, Tree } from "../shared/api";
import type { MoveTo } from "./api";

export type DropZone = "before" | "after" | "into";
export type DropAt = { id: string; zone: DropZone };

export const useDrag = create<{ drag: MaterialSummary | null; drop: DropAt | null }>(() => ({ drag: null, drop: null }));

const MIME = "application/x-gloss-material";

export function startDrag(e: DragEvent, m: MaterialSummary, image?: Element | null) {
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(MIME, m.id);
  e.dataTransfer.setData("text/plain", m.title);
  if (image) e.dataTransfer.setDragImage(image, 20, 14);
  useDrag.setState({ drag: m, drop: null });
}

export const endDrag = () => useDrag.setState({ drag: null, drop: null });

/** Where a drop on a material row would go, from the pointer's height on it. */
export function zoneFor(e: DragEvent, target: MaterialSummary, drag: MaterialSummary): DropZone | null {
  if (target.id === drag.id) return null;
  // Folders don't nest: a folder can only go between top-level items.
  if (drag.kind === "folder" && target.parentId) return null;
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  if (target.kind === "folder" && drag.kind !== "folder") {
    if (y < 0.28) return "before";
    if (y > 0.72) return "after";
    return "into";
  }
  return y < 0.5 ? "before" : "after";
}

/** Marks a row as a drop target while something is dragged over it. */
export function dragOverRow(e: DragEvent, target: MaterialSummary) {
  const { drag, drop } = useDrag.getState();
  if (!drag) return;
  const zone = zoneFor(e, target, drag);
  if (!zone) return;
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = "move";
  if (drop?.id !== target.id || drop.zone !== zone) useDrag.setState({ drop: { id: target.id, zone } });
}

export function dragOverCourse(e: DragEvent, courseId: string) {
  const { drag, drop } = useDrag.getState();
  if (!drag) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  if (drop?.id !== courseId || drop.zone !== "into") useDrag.setState({ drop: { id: courseId, zone: "into" } });
}

const midpoint = (before?: number, after?: number) =>
  before === undefined ? (after ?? 1) - 1 : after === undefined ? before + 1 : (before + after) / 2;

/** The move a drop makes, or null when it would change nothing. */
export function moveFor(tree: Tree, drag: MaterialSummary, at: DropAt): MoveTo | null {
  const all = tree.courses.flatMap((c) => c.materials);
  const course = tree.courses.find((c) => c.id === at.id);
  if (course) {
    if (drag.courseId === course.id && !drag.parentId) return null;
    return { id: drag.id, courseId: course.id, parentId: null };
  }
  const target = all.find((m) => m.id === at.id);
  if (!target || target.id === drag.id) return null;
  if (at.zone === "into") {
    if (drag.parentId === target.id || drag.kind === "folder") return null;
    return { id: drag.id, courseId: target.courseId, parentId: target.id };
  }
  const siblings = all
    .filter((m) => m.courseId === target.courseId && (m.parentId ?? null) === (target.parentId ?? null) && m.id !== drag.id)
    .sort((a, b) => a.position - b.position);
  const i = siblings.findIndex((m) => m.id === target.id) + (at.zone === "after" ? 1 : 0);
  const position = midpoint(siblings[i - 1]?.position, siblings[i]?.position);
  return { id: drag.id, courseId: target.courseId, parentId: target.parentId ?? null, position };
}

export const dropClass = (drop: DropAt | null, id: string) =>
  drop?.id === id ? ` drop-${drop.zone}` : "";
