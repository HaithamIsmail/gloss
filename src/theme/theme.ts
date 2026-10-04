// Applies a theme's CSS to the app.
//
// The theme goes into document.adoptedStyleSheets, which the browser always
// cascades after the page's own stylesheets, so a theme wins over app CSS that
// loads later (lazily loaded pages add stylesheets as you open them). The
// prepared CSS is also cached in localStorage so index.html can apply it before
// the first paint (see the inline script there).
import type { ThemeInfo } from "../../shared/api";

export const CACHE_KEY = "gloss-theme";
/** Bumped when the way CSS is prepared changes, so older cached copies are redone. */
const CACHE_VERSION = 2;

export type CachedTheme = {
  v: number;
  id: string;
  scheme: "light" | "dark";
  updatedAt: number;
  /** CSS with relative url()s made absolute and @imports taken out. */
  css: string;
  imports: string[];
};

type GlossWindow = Window & { __glossTheme?: { sheet: CSSStyleSheet; links: HTMLLinkElement[] } };
const w = window as GlossWindow;

/** Relative url(...) → absolute (relative to the theme file); @import rules pulled out. */
export function prepare(css: string, href: string): { css: string; imports: string[] } {
  const base = new URL(href, location.href);
  const abs = (u: string) => (/^(data:|[a-z]+:|\/|#)/i.test(u) ? u : new URL(u, base).href);
  const imports: string[] = [];
  let out = css.replace(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?[^;]*;/g, (_, u: string) => {
    imports.push(abs(u));
    return "";
  });
  // Quoted arguments are taken whole, so a data: URI with url(#…) inside it is left alone.
  out = out.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s]+))\s*\)/g, (_, dq?: string, sq?: string, bare?: string) => {
    const q = dq !== undefined ? '"' : sq !== undefined ? "'" : "";
    return `url(${q}${abs((dq ?? sq ?? bare ?? "").trim())}${q})`;
  });
  return { css: out, imports };
}

function clear() {
  const cur = w.__glossTheme;
  if (!cur) return;
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== cur.sheet);
  cur.links.forEach((l) => l.remove());
  w.__glossTheme = undefined;
}

/** Puts prepared theme CSS into effect (null = the default look). */
export function install(theme: { id: string; scheme: "light" | "dark"; css: string; imports: string[] } | null) {
  const html = document.documentElement;
  // A dark theme would print dark pages; printing keeps the default look.
  const printing = location.pathname.startsWith("/print/");
  if (!theme || (printing && theme.scheme === "dark")) {
    clear();
    delete html.dataset.theme;
    delete html.dataset.scheme;
    return;
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(theme.css);
  const links = theme.imports.map((href) => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    document.head.appendChild(l);
    return l;
  });
  clear();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  w.__glossTheme = { sheet, links };
  html.dataset.theme = theme.id;
  html.dataset.scheme = theme.scheme;
}

export function readCache(): CachedTheme | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
  } catch {
    return null;
  }
}

function writeCache(c: CachedTheme | null) {
  try {
    if (c) localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // storage full or blocked: the theme still applies, it just loads after the first paint
  }
}

/** Fetches and applies a theme (skipping the work when the cached copy is current). */
export async function applyTheme(t: ThemeInfo | undefined, defaultId: string) {
  if (!t || t.id === defaultId) {
    writeCache(null);
    install(null);
    return;
  }
  const cached = readCache();
  if (cached && cached.v === CACHE_VERSION && cached.id === t.id && cached.updatedAt === t.updatedAt) {
    if (document.documentElement.dataset.theme !== t.id || !w.__glossTheme) install(cached);
    return;
  }
  const res = await fetch(t.href);
  if (!res.ok) return;
  const prepared = prepare(await res.text(), t.href);
  const next: CachedTheme = { v: CACHE_VERSION, id: t.id, scheme: t.scheme, updatedAt: t.updatedAt, ...prepared };
  writeCache(next);
  install(next);
}
