import "katex/dist/katex.min.css";

import katex from "katex";

const cache = new Map<string, string>();

/** LaTeX to HTML with KaTeX. Mistakes render in red instead of throwing. */
export function mathHtml(latex: string, display = false): string {
  const key = `${display ? "D" : "I"}${latex}`;
  let html = cache.get(key);
  if (html === undefined) {
    try {
      html = katex.renderToString(latex, { displayMode: display, throwOnError: false, strict: "ignore" });
    } catch {
      html = latex.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    }
    if (cache.size > 500) cache.clear();
    cache.set(key, html);
  }
  return html;
}
