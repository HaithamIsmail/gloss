// Minimal typings for the parts of foliate-js that Gloss uses (src/books/EpubBook.tsx).

export type LanguageMap = string | Record<string, string>;
export type Contributor = string | { name: LanguageMap } | (string | { name: LanguageMap })[];

export type TocItem = { label: string; href: string; subitems?: TocItem[] };

export type Book = {
  metadata?: { title?: LanguageMap; author?: Contributor; language?: string | string[]; description?: string };
  sections: { id?: string; linear?: string; size?: number }[];
  toc?: TocItem[];
  rendition?: { layout?: string };
  getCover?: () => Promise<Blob | null>;
  destroy?: () => void;
};

export type Location = {
  fraction: number;
  location?: { current: number; next: number; total: number };
  tocItem?: { label: string; href: string } | null;
  pageItem?: { label: string } | null;
  cfi: string;
  range?: Range;
};

export type Contents = { index: number; doc: Document; overlayer?: Overlayer };

export class Overlayer {
  static highlight(rects: DOMRectList, options?: { color?: string }): SVGElement;
  static underline(rects: DOMRectList, options?: { color?: string; width?: number }): SVGElement;
  static outline(rects: DOMRectList, options?: { color?: string; width?: number }): SVGElement;
}

export type DrawFn = (fn: (rects: DOMRectList, options?: object) => SVGElement, options?: object) => void;

export interface FoliateView extends HTMLElement {
  book: Book;
  renderer: HTMLElement & {
    getContents(): Contents[];
    setStyles?(css: string): void;
    next(): Promise<void>;
    prev(): Promise<void>;
  };
  lastLocation: Location | null;
  open(book: string | File | Blob): Promise<void>;
  close(): void;
  init(opts: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
  goTo(target: string | number | { fraction: number }): Promise<unknown>;
  goToFraction(fraction: number): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  getCFI(index: number, range?: Range): string;
  addAnnotation(annotation: { value: string }): Promise<{ index: number; label: string } | undefined>;
  deleteAnnotation(annotation: { value: string }): Promise<unknown>;
  showAnnotation(annotation: { value: string }): Promise<void>;
  addEventListener(type: "load", fn: (e: CustomEvent<{ doc: Document; index: number }>) => void): void;
  addEventListener(type: "relocate", fn: (e: CustomEvent<Location>) => void): void;
  addEventListener(
    type: "draw-annotation",
    fn: (e: CustomEvent<{ draw: DrawFn; annotation: { value: string }; doc: Document; range: Range }>) => void,
  ): void;
  addEventListener(type: "show-annotation", fn: (e: CustomEvent<{ value: string; index: number; range: Range }>) => void): void;
  addEventListener(type: string, fn: (e: Event) => void): void;
}

export function makeBook(file: string | File | Blob): Promise<Book>;
