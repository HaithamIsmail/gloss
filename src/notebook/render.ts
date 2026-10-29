import "katex/dist/katex.min.css";

import DOMPurify from "dompurify";
import katex from "katex";
import { Marked } from "marked";
import type { MimeBundle } from "../../shared/pages";

const notebookMd = new Marked({ gfm: true, breaks: false });
const commentMd = new Marked({ gfm: true, breaks: true });

/** Notebook outputs and imported notebooks are untrusted: always sanitize. */
export const sanitize = (html: string) =>
  DOMPurify.sanitize(html, { ADD_ATTR: ["target"], FORBID_TAGS: ["style", "form", "input", "button"] });

// ── Math inside Markdown ─────────────────────────────────────────────────
//
// Formulas are taken out before Markdown sees the text (so it can't eat their
// backslashes or underscores), rendered with KaTeX, and put back afterwards.
// Recognised, outside code: $$…$$ and \[…\] (display, may span lines),
// \(…\) and $…$ (inline). An inline $…$ follows Pandoc's rule — no space just
// inside the dollars, no digit right after the closing one — so "$5 and $10"
// stays text. \$ is a literal dollar sign.

const TOKEN = (kind: "M" | "C", i: number) => `GLOSS${kind}${i}Z`;

function katexHtml(tex: string, display: boolean) {
  try {
    return katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false, strict: "ignore" });
  } catch {
    return escapeHtml(tex);
  }
}

function markdownWithMath(source: string, md: Marked, postprocess?: (html: string) => string): string {
  const code: string[] = [];
  const math: { html: string; display: boolean }[] = [];
  const keep = (s: string) => TOKEN("C", code.push(s) - 1);
  const formula = (tex: string, display: boolean) => {
    const id = math.push({ html: katexHtml(tex, display), display }) - 1;
    // A display formula becomes its own paragraph so it can sit on its own line.
    return display ? `\n\n${TOKEN("M", id)}\n\n` : TOKEN("M", id);
  };

  let text = source
    // Fenced code blocks, then inline code: never math.
    .replace(/(^|\n)( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n {0,3}\3[`~]*[ \t]*(?=\n|$)/g, (m, nl: string) => nl + keep(m.slice(nl.length)))
    .replace(/(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g, (m) => keep(m))
    // Escaped dollars stay dollars.
    .replace(/\\\$/g, () => keep("\\$"));

  text = text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => formula(tex, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex: string) => formula(tex, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex: string) => formula(tex, false))
    .replace(/\$(?=\S)((?:[^$\n\\]|\\.)*?\S)\$(?!\d)/g, (_, tex: string) => formula(tex, false));

  // Put the code back for Markdown to render.
  text = text.replace(/GLOSSC(\d+)Z/g, (_, i: string) => code[Number(i)]);

  let html = md.parse(text, { async: false }) as string;
  if (postprocess) html = postprocess(html);
  html = sanitize(html);
  // KaTeX's output goes in after sanitizing (it is generated, not user HTML).
  return html
    .replace(/<p>GLOSSM(\d+)Z<\/p>/g, (_, i: string) => math[Number(i)].html)
    .replace(/GLOSSM(\d+)Z/g, (_, i: string) => math[Number(i)].html);
}

/** Markdown with math, for notebook cells. Inlines cell attachments. */
export function renderMarkdown(source: string, attachments?: Record<string, MimeBundle>): string {
  return markdownWithMath(source, notebookMd, (html) =>
    attachments
      ? html.replace(/(src|href)="attachment:([^"]+)"/g, (whole, attr: string, name: string) => {
          const bundle = attachments[decodeURIComponent(name)];
          if (!bundle) return whole;
          const [mime, data] = Object.entries(bundle)[0] ?? [];
          return mime ? `${attr}="data:${mime};base64,${String(Array.isArray(data) ? data.join("") : data)}"` : whole;
        })
      : html,
  );
}

/** Markdown with math, for region comments: a line break stays a line break, links open in a new tab. */
export function renderCommentMarkdown(source: string): string {
  return markdownWithMath(source, commentMd, (html) => html.replace(/<a href=/g, '<a target="_blank" rel="noreferrer" href='));
}

export function renderLatex(source: string): string {
  const math = source.trim().replace(/^\$\$?|\$\$?$/g, "");
  try {
    return katex.renderToString(math, { displayMode: true, throwOnError: false });
  } catch {
    return escapeHtml(source);
  }
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ANSI_COLORS = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];

/** Terminal colour codes (as in Jupyter tracebacks) to escaped HTML with classes. */
export function ansiToHtml(text: string): string {
  let out = "";
  let fg = "";
  let bold = false;
  const parts = text.split(/\u001b\[([\d;]*)m/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (!parts[i]) continue;
      const cls = [fg && `ansi-${fg}`, bold && "ansi-bold"].filter(Boolean).join(" ");
      out += cls ? `<span class="${cls}">${escapeHtml(parts[i])}</span>` : escapeHtml(parts[i]);
      continue;
    }
    for (const code of (parts[i] || "0").split(";").map(Number)) {
      if (code === 0) {
        fg = "";
        bold = false;
      } else if (code === 1) bold = true;
      else if (code === 22) bold = false;
      else if (code >= 30 && code <= 37) fg = ANSI_COLORS[code - 30];
      else if (code >= 90 && code <= 97) fg = ANSI_COLORS[code - 90];
      else if (code === 39) fg = "";
    }
  }
  return out;
}

/** Applies carriage returns the way a terminal would (progress bars overwrite their line). */
export function applyCarriageReturns(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const i = line.lastIndexOf("\r");
      return i >= 0 ? line.slice(i + 1) : line;
    })
    .join("\n");
}

export const joinText = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join("") : (v ?? ""));
