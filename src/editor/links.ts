import type { BlockNoteEditor } from "@blocknote/core";

type AnyEditor = BlockNoteEditor<any, any, any>;

/** Strips the annotation mark for the given region ids from every passage. */
export function removeAnnotationLinks(editor: AnyEditor, ids: string[]) {
  const doomed = new Set(ids);
  editor.transact((tr) => {
    const type = tr.doc.type.schema.marks.annotation;
    if (!type) return;
    const doc = tr.doc;
    doc.descendants((node, pos) => {
      if (!node.isText) return;
      for (const mark of node.marks) {
        if (mark.type === type && doomed.has(mark.attrs.stringValue)) {
          tr.removeMark(pos, pos + node.nodeSize, mark);
        }
      }
    });
  });
}

/** Number of separate linked passages per region id. */
export function countLinks(editor: AnyEditor): Record<string, number> {
  const counts: Record<string, number> = {};
  const lastEnd: Record<string, number> = {};
  editor.prosemirrorState.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name !== "annotation") continue;
      const id = mark.attrs.stringValue as string;
      if (lastEnd[id] !== pos) counts[id] = (counts[id] ?? 0) + 1;
      lastEnd[id] = pos + node.nodeSize;
    }
  });
  return counts;
}

export function passageElements(id: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`.ann-link[data-value="${CSS.escape(id)}"]`));
}

/** A page element by id: an editor block, or a notebook cell/heading (data-outline-id). */
export function blockElement(blockId: string): HTMLElement | null {
  const id = CSS.escape(blockId);
  return (
    document.querySelector<HTMLElement>(`.bn-block-outer[data-id="${id}"]`) ??
    document.querySelector<HTMLElement>(`[data-outline-id="${id}"]`)
  );
}

export function flash(el: Element) {
  el.classList.remove("flash");
  // Restart the animation.
  void (el as HTMLElement).offsetWidth;
  el.classList.add("flash");
  window.setTimeout(() => el.classList.remove("flash"), 1600);
}

export function scrollToBlock(blockId: string, opts: { flash?: boolean; block?: ScrollLogicalPosition } = {}) {
  const el = blockElement(blockId);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: opts.block ?? "start" });
  if (opts.flash) flash(el.querySelector(".bn-block-content") ?? el);
  return true;
}
