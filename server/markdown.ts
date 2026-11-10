// Markdown → BlockNote blocks, for agents writing pages over MCP. The inverse of
// `blocksToMarkdown` in export.ts: whatever that writes parses back into the
// same blocks (ids aside), in the shapes the editor saves (src/editor/schema.ts).
import { Marked, type Token, type Tokens, type TokenizerExtension } from "marked";
import { nanoid } from "nanoid";
import { ANNOTATED_IMAGE, DRAWING, MATH_BLOCK, walkBlocks, type LooseBlock } from "../shared/content";
import { blocksToMarkdown } from "./export";

type Styles = Record<string, true | string>;
type Inline = Record<string, unknown>;
/** An image met inside a paragraph; split out into its own block. */
type ImageMark = { type: "__image"; url: string; name: string };

const blockMath: TokenizerExtension = {
  name: "blockMath",
  level: "block",
  start: (src) => /(?:^|\n)\$\$/.exec(src)?.index,
  tokenizer(src) {
    const m = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src);
    if (m) return { type: "blockMath", raw: m[0], text: m[1].trim() };
  },
};

const inlineMath: TokenizerExtension = {
  name: "inlineMath",
  level: "inline",
  // Skips "\$", so the escape tokenizer still sees the backslash.
  start: (src) => /(?<!\\)\$/.exec(src)?.index,
  tokenizer(src) {
    const m = /^\$(?!\s)((?:\\[\s\S]|[^\\$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
    if (m) return { type: "inlineMath", raw: m[0], text: m[1] };
  },
};

const marked = new Marked({ gfm: true, extensions: [blockMath, inlineMath] });

const unescape = (s: string) => s.replace(/\\([!-/:-@[-`{-~])/g, "$1");

const BASE = { backgroundColor: "default", textColor: "default", textAlignment: "left" };
const ALERT_TONE: Record<string, string> = { NOTE: "note", TIP: "tip", WARNING: "warning", CAUTION: "warning", IMPORTANT: "exam" };
const MENTION = /^\/m\/([\w-]+)\/?(?:\?(.*))?$/;
const DRAWING_URL = /^\/api\/drawings\/([\w-]+)\/preview\.svg$/;

export type ParseOptions = {
  /**
   * Blocks this write removes (a replaced block and its children, or the whole page). A block that
   * comes back unchanged under its `<!-- id: … -->` comment keeps its id and exact JSON, and an image
   * whose URL matches an annotated image or drawing here comes back as that block, regions and all.
   */
  reusable?: LooseBlock[];
};

/** Parses agent Markdown into BlockNote blocks with fresh ids (or reused ones, see `reusable`). */
export function markdownToBlocks(md: string, opts: ParseOptions = {}): LooseBlock[] {
  const pool = new Map<string, LooseBlock>();
  walkBlocks(opts.reusable ?? [], (b) => pool.set(b.id, b));
  const used = new Set<string>();
  const take = (id: string) => {
    const b = pool.get(id);
    if (!b || used.has(id)) return null;
    used.add(id);
    return b;
  };
  return new Parser(take, [...pool.values()]).blocks(marked.lexer(md.replace(/\r\n?/g, "\n")));
}

class Parser {
  constructor(
    private take: (id: string) => LooseBlock | null,
    private pool: LooseBlock[],
  ) {}

  private pendingId: string | null = null;

  blocks(tokens: Token[]): LooseBlock[] {
    const out: LooseBlock[] = [];
    for (const t of tokens) {
      if (t.type === "html") {
        const m = /^<!--\s*id:\s*([\w-]+)\s*-->/.exec(t.text.trim());
        if (m) this.pendingId = m[1];
        else if (/^<p>\s*<\/p>$/i.test(t.text.trim())) out.push(...this.adopt([this.para([])]));
        else if (!/^<!--[\s\S]*-->$/.test(t.text.trim())) out.push(...this.adopt([this.para([{ type: "text", text: t.text.trim(), styles: {} }])]));
        continue;
      }
      out.push(...this.adopt(this.block(t)));
    }
    return out;
  }

  /** Swaps a new block for the old one it equals (same id comment, same Markdown), or an image for its annotated image. */
  private adopt(made: LooseBlock[]): LooseBlock[] {
    const id = this.pendingId;
    this.pendingId = null;
    return made.map((b, i) => {
      if (b.type === "image") {
        const url = String(b.props?.url ?? "");
        const d = DRAWING_URL.exec(url);
        const old = this.pool.find((o) =>
          d ? o.type === DRAWING && o.props?.drawingId === d[1] : o.type === ANNOTATED_IMAGE && o.props?.url === url,
        );
        if (old && this.take(old.id)) return { ...old, children: b.children };
        if (d) return { ...b, type: DRAWING, props: { drawingId: d[1] }, content: undefined };
      }
      if (i === 0 && id) {
        const old = this.peek(id);
        if (old && same(old, b) && this.take(id)) return { ...old, children: b.children };
      }
      return b;
    });
  }

  private peek = (id: string) => this.pool.find((b) => b.id === id) ?? null;

  private block(t: Token): LooseBlock[] {
    switch (t.type) {
      case "space":
        return [];
      case "heading": {
        const h = t as Tokens.Heading;
        return [mk("heading", { ...BASE, level: Math.min(3, h.depth), isToggleable: false }, inline(h.tokens))];
      }
      case "paragraph":
      case "text": {
        const tokens = (t as Tokens.Paragraph).tokens ?? [{ type: "text", raw: t.raw, text: (t as Tokens.Text).text }];
        return this.splitImages(inline(tokens));
      }
      case "code": {
        const c = t as Tokens.Code;
        return [mk("codeBlock", { language: c.lang?.trim() || "text" }, c.text ? [txt(c.text)] : [])];
      }
      case "hr":
        return [mk("divider", {}, undefined)];
      case "blockMath":
        return [mk(MATH_BLOCK, { latex: String((t as unknown as { text: string }).text) }, undefined)];
      case "blockquote":
        return [this.quote(t as Tokens.Blockquote)];
      case "list":
        return this.list(t as Tokens.List);
      case "table":
        return [table(t as Tokens.Table)];
      default:
        return t.raw?.trim() ? [this.para([txt(t.raw.trim())])] : [];
    }
  }

  private para(content: Inline[]): LooseBlock {
    return mk("paragraph", { ...BASE }, content);
  }

  /** A paragraph holding images becomes paragraphs and image blocks, in order. */
  private splitImages(content: (Inline | ImageMark)[]): LooseBlock[] {
    if (!content.some((c) => c.type === "__image")) return [this.para(content)];
    const out: LooseBlock[] = [];
    let run: Inline[] = [];
    const flush = () => {
      const trimmed = trimRun(run);
      if (trimmed.length) out.push(this.para(trimmed));
      run = [];
    };
    for (const c of content) {
      if (c.type !== "__image") run.push(c);
      else {
        flush();
        const img = c as ImageMark;
        out.push(mk("image", { backgroundColor: "default", textAlignment: "left", name: img.name, url: img.url, caption: "", showPreview: true }, undefined));
      }
    }
    flush();
    return out;
  }

  private quote(q: Tokens.Blockquote): LooseBlock {
    const alert = /^\[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT)\][ \t]*(?:\n|$)/i.exec(q.text);
    const tokens = alert ? marked.lexer(q.text.slice(alert[0].length)) : q.tokens;
    const content: Inline[] = [];
    for (const t of tokens) {
      if (t.type === "space") continue;
      const part = t.type === "paragraph" || t.type === "text" || t.type === "heading" ? inline((t as Tokens.Paragraph).tokens ?? []) : [txt(t.raw.trim())];
      if (content.length) content.push(txt("\n"));
      content.push(...part.filter((p) => p.type !== "__image"));
    }
    const merged = mergeText(content);
    return alert
      ? mk("callout", { textAlignment: "left", tone: ALERT_TONE[alert[1].toUpperCase()] }, merged)
      : mk("quote", { backgroundColor: "default", textColor: "default" }, merged);
  }

  private list(l: Tokens.List): LooseBlock[] {
    return l.items.map((item) => {
      const type = item.task ? "checkListItem" : l.ordered ? "numberedListItem" : "bulletListItem";
      const props: Record<string, unknown> = { ...BASE, ...(item.task ? { checked: !!item.checked } : {}) };
      const rest = item.tokens.filter((t) => t.type !== "checkbox");
      // The first paragraph is the item's text; whatever follows (nested lists, code…) are its children.
      const firstIdx = rest.findIndex((t) => t.type === "text" || t.type === "paragraph");
      let content: Inline[] = [];
      let kids = rest;
      if (firstIdx === 0) {
        const first = rest[0] as Tokens.Paragraph;
        content = inline(first.tokens ?? [txt(first.text) as unknown as Token]).filter((c) => c.type !== "__image") as Inline[];
        kids = rest.slice(1);
      }
      const saved = this.pendingId;
      this.pendingId = null;
      const children = this.blocks(kids);
      this.pendingId = saved;
      const b = mk(type, props, content);
      b.children = children;
      return b;
    });
  }
}

function same(a: LooseBlock, b: LooseBlock): boolean {
  if (a.type !== b.type) return false;
  const strip = (x: LooseBlock): LooseBlock => ({ ...x, children: [] });
  return blocksToMarkdown([strip(a)]) === blocksToMarkdown([strip(b)]);
}

const mk = (type: string, props: Record<string, unknown>, content: unknown): LooseBlock => ({
  id: nanoid(10),
  type,
  props,
  ...(content === undefined ? {} : { content }),
  children: [],
});

const txt = (text: string, styles: Styles = {}): Inline => ({ type: "text", text, styles: { ...styles } });

function trimRun(run: Inline[]): Inline[] {
  const out = mergeText(run);
  if (out[0]?.type === "text") out[0] = { ...out[0], text: String(out[0].text).replace(/^\s+/, "") };
  const last = out.length - 1;
  if (out[last]?.type === "text") out[last] = { ...out[last], text: String(out[last].text).replace(/\s+$/, "") };
  return out.filter((c) => c.type !== "text" || c.text);
}

/** Joins neighbouring text runs with the same styles. */
function mergeText(items: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    if (it.type === "text" && !it.text) continue;
    if (prev?.type === "text" && it.type === "text" && JSON.stringify(prev.styles) === JSON.stringify(it.styles)) {
      out[out.length - 1] = { ...prev, text: String(prev.text) + String(it.text) };
    } else out.push(it);
  }
  return out;
}

/** Inline tokens → BlockNote inline content (text with styles, links, mentions, math). */
function inline(tokens: Token[]): (Inline | ImageMark)[] {
  const out: (Inline | ImageMark)[] = [];
  let underline = false;
  let region: string | null = null;
  let inSup = false;
  const styleNow = (s: Styles): Styles => {
    const o: Styles = { ...s };
    if (underline) o.underline = true;
    if (region) o.annotation = region;
    return o;
  };
  const walk = (ts: Token[], styles: Styles) => {
    for (const t of ts) {
      if (inSup && !(t.type === "html" && /^<\/sup>/i.test(t.text))) continue;
      switch (t.type) {
        case "text": {
          const tt = t as Tokens.Text;
          if (tt.tokens?.length) walk(tt.tokens, styles);
          else out.push(txt(tt.text, styleNow(styles)));
          break;
        }
        case "escape":
          out.push(txt((t as Tokens.Escape).text, styleNow(styles)));
          break;
        case "strong":
          walk((t as Tokens.Strong).tokens, { ...styles, bold: true });
          break;
        case "em":
          walk((t as Tokens.Em).tokens, { ...styles, italic: true });
          break;
        case "del":
          walk((t as Tokens.Del).tokens, { ...styles, strike: true });
          break;
        case "codespan":
          out.push(txt((t as Tokens.Codespan).text, styleNow({ ...styles, code: true })));
          break;
        case "br":
          out.push(txt("\n", styleNow(styles)));
          break;
        case "checkbox": // a task item's box; the list item reads it
          break;
        case "inlineMath":
          out.push({ type: "math", props: { latex: String((t as unknown as { text: string }).text) } });
          break;
        case "image": {
          const im = t as Tokens.Image;
          out.push({ type: "__image", url: im.href, name: unescape(im.text) });
          break;
        }
        case "link": {
          const l = t as Tokens.Link;
          const m = MENTION.exec(l.href);
          const inner = mergeText(inline(l.tokens).filter((c): c is Inline => c.type === "text"));
          if (m) {
            const q = new URLSearchParams(m[2] ?? "");
            const label = inner.map((c) => String(c.text)).join("").replace(/^@/, "");
            out.push({
              type: "mention",
              props: { targetId: m[1], annotationId: q.get("ann") ?? "", blockId: q.get("block") ?? "", label },
            });
          } else {
            const content = inner.map((c) => ({ ...c, styles: { ...styleNow(styles), ...(c.styles as Styles) } }));
            out.push({ type: "link", href: l.href, content });
          }
          break;
        }
        case "html": {
          const h = t.text.trim();
          if (/^<u>$/i.test(h)) underline = true;
          else if (/^<\/u>$/i.test(h)) underline = false;
          else if (/^<mark\b/i.test(h)) region = /data-region="([^"]*)"/.exec(h)?.[1] || null;
          else if (/^<\/mark>$/i.test(h)) region = null;
          else if (/^<br\s*\/?>$/i.test(h)) out.push(txt("\n", styleNow(styles)));
          else if (/^<sup>/i.test(h)) inSup = true;
          else if (/^<\/sup>/i.test(h)) inSup = false;
          else if (!/^<!--/.test(h)) out.push(txt(t.text, styleNow(styles)));
          break;
        }
        default:
          if (t.raw) out.push(txt(t.raw, styleNow(styles)));
      }
    }
  };
  walk(tokens, {});
  const images = out.filter((c): c is ImageMark => c.type === "__image");
  if (!images.length) return mergeText(out as Inline[]);
  // Keep image markers where they are, merging only the text around them.
  const res: (Inline | ImageMark)[] = [];
  let run: Inline[] = [];
  for (const c of out) {
    if (c.type === "__image") {
      res.push(...mergeText(run), c);
      run = [];
    } else run.push(c as Inline);
  }
  return [...res, ...mergeText(run)];
}

function table(t: Tokens.Table): LooseBlock {
  const cell = (c: Tokens.TableCell) => ({
    type: "tableCell",
    props: { backgroundColor: "default", textColor: "default", textAlignment: c.align ?? "left", colspan: 1, rowspan: 1 },
    content: inline(c.tokens).filter((x): x is Inline => x.type !== "__image"),
  });
  const rows = [t.header, ...t.rows].map((r) => ({ cells: r.map(cell) }));
  return mk("table", { textColor: "default" }, {
    type: "tableContent",
    columnWidths: t.header.map(() => null),
    headerRows: 1,
    rows,
  });
}
