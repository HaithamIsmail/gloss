// Helpers for reading BlockNote documents (stored as JSON). Shared by the
// server (outline, search) and the client (index, region numbering).

export type LooseBlock = {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: LooseBlock[];
};

/** A rectangular region on an image, in percent of the image size. */
export type Annotation = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  comment: string;
};

export type OutlineItem = {
  id: string;
  level: 1 | 2;
  text: string;
  /** "1", "1.2", … */
  num: string;
};

export const ANNOTATED_IMAGE = "annotatedImage";

/** Depth-first walk over a block tree, in document order. */
export function walkBlocks(blocks: LooseBlock[], fn: (b: LooseBlock) => void) {
  for (const b of blocks) {
    fn(b);
    if (b.children?.length) walkBlocks(b.children, fn);
  }
}

/** Collects every `text` string found in a block's content (inline, table or plain). */
export function contentText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(contentText).join("");
  if (typeof content === "object") {
    const o = content as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    const props = (o.props ?? {}) as Record<string, unknown>;
    if (o.type === "math") return String(props.latex ?? "");
    if (o.type === "mention") return String(props.label ?? "");
    if (o.type === "tableContent" && Array.isArray(o.rows)) {
      return (o.rows as { cells: unknown[] }[])
        .map((r) => r.cells.map(contentText).join(" · "))
        .join("\n");
    }
    if ("content" in o) return contentText(o.content);
  }
  return "";
}

export function parseAnnotations(raw: unknown): Annotation[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function isSectionHeading(b: LooseBlock): 1 | 2 | null {
  if (b.type !== "heading") return null;
  const level = Number(b.props?.level ?? 1);
  return level === 1 || level === 2 ? level : null;
}

/** Sections (H1) and subsections (H2), numbered the same way the page renders them. */
export function buildOutline(blocks: LooseBlock[]): OutlineItem[] {
  const out: OutlineItem[] = [];
  let s = 0;
  let ss = 0;
  walkBlocks(blocks, (b) => {
    const level = isSectionHeading(b);
    if (level === 1) {
      s++;
      ss = 0;
      out.push({ id: b.id, level, text: contentText(b.content), num: `${s}` });
    } else if (level === 2) {
      ss++;
      out.push({ id: b.id, level, text: contentText(b.content), num: `${s}.${ss}` });
    }
  });
  return out;
}

export function countRegions(blocks: LooseBlock[]): number {
  let n = 0;
  walkBlocks(blocks, (b) => {
    if (b.type === ANNOTATED_IMAGE) n += parseAnnotations(b.props?.annotations).length;
  });
  return n;
}

export const DRAWING = "drawing";

/** The words written in an Excalidraw scene (its text elements), for search. */
export function sceneText(scene: { elements?: unknown[] } | null | undefined): string {
  return (scene?.elements ?? [])
    .map((e) => {
      const el = e as { type?: string; isDeleted?: boolean; originalText?: string; text?: string };
      return el.type === "text" && !el.isDeleted ? (el.originalText ?? el.text ?? "") : "";
    })
    .filter(Boolean)
    .join("\n");
}

/** A display formula block (inline formulas are inline content of type "math"). */
export const MATH_BLOCK = "mathBlock";

/** A link to another material (or one region in it), typed with "@" in a page. */
export type MentionProps = {
  targetId: string;
  /** Set when the link points at one region of an image. */
  annotationId: string;
  /** The image block holding that region, when it sits inside a page. */
  blockId: string;
  /** Title when the link was made: shown if the target is gone. */
  label: string;
};

/** Visits every inline content item (text, links, mentions, math) in a block tree. */
export function walkInline(blocks: LooseBlock[], fn: (item: Record<string, unknown>) => void) {
  const visit = (content: unknown) => {
    if (Array.isArray(content)) return content.forEach(visit);
    if (!content || typeof content !== "object") return;
    const o = content as Record<string, unknown>;
    if (o.type === "tableContent" && Array.isArray(o.rows)) {
      for (const row of o.rows as { cells: unknown[] }[]) {
        for (const cell of row.cells) visit((cell as { content?: unknown })?.content ?? cell);
      }
      return;
    }
    fn(o);
    if (Array.isArray(o.content)) visit(o.content);
  };
  walkBlocks(blocks, (b) => visit(b.content));
}

/** The materials (and regions) a page links to with "@". */
export function extractMentions(blocks: LooseBlock[]): { targetId: string; annotationId: string }[] {
  const seen = new Map<string, { targetId: string; annotationId: string }>();
  walkInline(blocks, (item) => {
    if (item.type !== "mention") return;
    const p = (item.props ?? {}) as Partial<MentionProps>;
    if (!p.targetId) return;
    const annotationId = p.annotationId ?? "";
    seen.set(`${p.targetId}|${annotationId}`, { targetId: p.targetId, annotationId });
  });
  return [...seen.values()];
}
