import "katex/dist/katex.min.css";

import DOMPurify from "dompurify";
import katex from "katex";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import type { MimeBundle } from "../../shared/pages";

const md = new Marked(markedKatex({ throwOnError: false, nonStandard: true }), { gfm: true, breaks: false });

/** Notebook outputs and imported notebooks are untrusted: always sanitize. */
export const sanitize = (html: string) =>
  DOMPurify.sanitize(html, { ADD_ATTR: ["target"], FORBID_TAGS: ["style", "form", "input", "button"] });

/** Markdown (with $math$ and $$display math$$) to safe HTML. Inlines cell attachments. */
export function renderMarkdown(source: string, attachments?: Record<string, MimeBundle>): string {
  let html = md.parse(source, { async: false }) as string;
  if (attachments) {
    html = html.replace(/(src|href)="attachment:([^"]+)"/g, (whole, attr: string, name: string) => {
      const bundle = attachments[decodeURIComponent(name)];
      if (!bundle) return whole;
      const [mime, data] = Object.entries(bundle)[0] ?? [];
      return mime ? `${attr}="data:${mime};base64,${String(Array.isArray(data) ? data.join("") : data)}"` : whole;
    });
  }
  return sanitize(html);
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
