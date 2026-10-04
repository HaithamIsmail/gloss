import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import { sanitize } from "../notebook/render";

// Region comments are written in Markdown with $math$ / $$display math$$.
// A single line break stays a line break (comments are typed like notes).
const md = new Marked(markedKatex({ throwOnError: false, nonStandard: true }), { gfm: true, breaks: true });

const cache = new Map<string, string>();

/** Markdown + LaTeX to safe HTML; links open in a new tab. */
export function renderComment(source: string): string {
  let html = cache.get(source);
  if (html === undefined) {
    html = sanitize((md.parse(source, { async: false }) as string).replace(/<a href=/g, '<a target="_blank" rel="noreferrer" href='));
    if (cache.size > 300) cache.clear();
    cache.set(source, html);
  }
  return html;
}

/** A region comment, rendered. */
export function CommentText({ text, className = "" }: { text: string; className?: string }) {
  return <div className={`md-comment ${className}`} dangerouslySetInnerHTML={{ __html: renderComment(text) }} />;
}
