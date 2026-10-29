// What the two book viewers (PDF and EPUB) have in common, so BookView drives either.
import type { BookLoc, BookProgress } from "../../shared/pages";

export type TocEntry = { id: string; label: string; depth: number; go: () => void };

/** Text selected in the book, ready to become a highlight. `rect` is in viewport pixels. */
export type BookSelection = {
  loc: BookLoc;
  quote: string;
  /** 0–1 position in the book. */
  at: number;
  rect: { x: number; y: number; w: number; h: number };
};

export type ViewerProps = {
  url: string;
  highlights: { id: string; loc: BookLoc }[];
  activeId: string | null;
  /** Where to open: the saved reading position. */
  initial: BookLoc | null;
  onReady: (info: { length: number; toc: TocEntry[] }) => void;
  onLocation: (p: Omit<BookProgress, "updatedAt">) => void;
  onSelection: (sel: BookSelection | null) => void;
  onHighlightClick: (id: string) => void;
  onFind: (count: { current: number; total: number } | null) => void;
  onError: (message: string) => void;
};

export type ViewerHandle = {
  goTo: (loc: BookLoc) => Promise<void>;
  next: () => void;
  prev: () => void;
  /** 1 = bigger, -1 = smaller, 0 = back to the default. */
  zoom: (dir: 1 | -1 | 0) => void;
  /** PDF only: jump to a page. */
  goToPage?: (n: number) => void;
  /** Search the book: the same query again moves to the next (or previous) match. */
  find: (query: string, dir: 1 | -1) => void;
  clearFind: () => void;
  clearSelection: () => void;
};

export const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** foliate-js entries have `label` and `subitems`; pdf.js outline items have `title` and `items`. */
export const flattenToc = <T extends { label?: string; title?: string; subitems?: T[] | null; items?: T[] | null }>(
  items: T[] | null | undefined,
  go: (item: T) => void,
  depth = 0,
  out: TocEntry[] = [],
  prefix = "t",
): TocEntry[] => {
  (items ?? []).forEach((it, i) => {
    const id = `${prefix}${i}`;
    out.push({ id, label: (it.label ?? it.title ?? "").trim() || "Untitled", depth, go: () => go(it) });
    flattenToc(it.subitems ?? it.items ?? [], go, depth + 1, out, `${id}.`);
  });
  return out;
};

export const normalizeQuote = (s: string) => s.replace(/\s+/g, " ").trim();
