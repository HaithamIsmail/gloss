import { renderCommentMarkdown } from "../notebook/render";

const cache = new Map<string, string>();

/** Region comments are Markdown with $math$ / $$display math$$, rendered to safe HTML. */
export function renderComment(source: string): string {
  let html = cache.get(source);
  if (html === undefined) {
    html = renderCommentMarkdown(source);
    if (cache.size > 300) cache.clear();
    cache.set(source, html);
  }
  return html;
}

/** A region comment, rendered. */
export function CommentText({ text, className = "" }: { text: string; className?: string }) {
  return <div className={`md-comment ${className}`} dangerouslySetInnerHTML={{ __html: renderComment(text) }} />;
}
