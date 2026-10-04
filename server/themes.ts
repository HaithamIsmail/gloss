// Themes are CSS files, like Typora's: the built-in ones live in themes/, your
// own in data/themes/. A theme overrides the variables in src/styles/tokens.css
// and may add any CSS of its own. Fonts and images go in a folder named after
// the theme (themes/washi.css → themes/washi/…) and are linked relatively.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ThemeInfo, ThemeList } from "../shared/api";
import { DATA_DIR, getSetting, setSetting } from "./db";
import { UserError } from "./repo";

export const BUILTIN_THEMES = fileURLToPath(new URL("../themes", import.meta.url));
export const USER_THEMES = path.join(DATA_DIR, "themes");
fs.mkdirSync(USER_THEMES, { recursive: true });

export const DEFAULT_THEME = "builtin/modernist";
const TEMPLATE = path.join(BUILTIN_THEMES, "_template.css");
const dirOf = (source: "builtin" | "user") => (source === "builtin" ? BUILTIN_THEMES : USER_THEMES);

const orders = new Map<string, number>();

/** The header comment: @name, @author, @description, @scheme, @order. */
function readMeta(css: string): Record<string, string> {
  const head = /^\s*\/\*([\s\S]*?)\*\//.exec(css)?.[1] ?? "";
  const meta: Record<string, string> = {};
  for (const m of head.matchAll(/@(\w+)[ \t]+([^\n]*?)\s*(?:\*\/)?$/gm)) meta[m[1].toLowerCase()] = m[2].replace(/^\*\s*/, "").trim();
  return meta;
}

function info(source: "builtin" | "user", file: string): ThemeInfo | null {
  const full = path.join(dirOf(source), file);
  let css: string;
  let st: fs.Stats;
  try {
    css = fs.readFileSync(full, "utf8");
    st = fs.statSync(full);
  } catch {
    return null;
  }
  const meta = readMeta(css);
  const stem = file.replace(/\.css$/i, "");
  // @order: where a theme sits in the list (built-in themes use it).
  if (meta.order && Number.isFinite(Number(meta.order))) orders.set(`${source}/${stem}`, Number(meta.order));
  return {
    id: `${source}/${stem}`,
    name: meta.name || stem,
    author: meta.author ?? "",
    description: meta.description ?? "",
    scheme: meta.scheme === "dark" ? "dark" : "light",
    source,
    href: `/themes/${source}/${encodeURIComponent(file)}?v=${Math.round(st.mtimeMs)}`,
    updatedAt: st.mtimeMs,
  };
}

const cssFiles = (dir: string) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".css") && !f.startsWith("_") && !f.startsWith(".")) : [];

export function listThemes(): ThemeList {
  const order = (t: ThemeInfo) => (t.id === DEFAULT_THEME ? -1 : (orders.get(t.id) ?? 100));
  const builtin = cssFiles(BUILTIN_THEMES)
    .map((f) => info("builtin", f))
    .filter((t): t is ThemeInfo => !!t)
    .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  const user = cssFiles(USER_THEMES)
    .map((f) => info("user", f))
    .filter((t): t is ThemeInfo => !!t)
    .sort((a, b) => a.name.localeCompare(b.name));
  const themes = [...builtin, ...user];
  const chosen = getSetting("ui.theme", DEFAULT_THEME);
  return {
    current: themes.some((t) => t.id === chosen) ? chosen : DEFAULT_THEME,
    themes,
    folder: USER_THEMES,
  };
}

/** Resolves a theme id to its file, refusing anything outside the theme folders. */
function locate(id: string): { source: "builtin" | "user"; stem: string; file: string } {
  const m = /^(builtin|user)\/([^/\\]+)$/.exec(id);
  if (!m || m[2].startsWith(".")) throw new UserError("Unknown theme.", 404);
  const source = m[1] as "builtin" | "user";
  const file = path.join(dirOf(source), `${m[2]}.css`);
  if (!fs.existsSync(file)) throw new UserError("That theme no longer exists.", 404);
  return { source, stem: m[2], file };
}

export function setCurrentTheme(id: string) {
  if (id !== DEFAULT_THEME) locate(id);
  setSetting("ui.theme", id);
  return listThemes();
}

const slug = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "theme";

/** A file stem in data/themes not used yet (also free of an asset folder). */
function freeStem(name: string) {
  const base = slug(name);
  let stem = base;
  for (let i = 2; fs.existsSync(path.join(USER_THEMES, `${stem}.css`)) || fs.existsSync(path.join(USER_THEMES, stem)); i++) {
    stem = `${base}-${i}`;
  }
  return stem;
}

/** Sets (or adds) the @name in the header comment. */
function withName(css: string, name: string) {
  if (/@name[ \t]+[^\n]*/.test(css)) return css.replace(/(@name[ \t]+)[^\n*]*/, (_, a) => `${a}${name}`);
  return `/*\n * @name ${name}\n */\n${css}`;
}

function uniqueName(name: string) {
  const names = new Set(listThemes().themes.map((t) => t.name.toLowerCase()));
  let n = name;
  for (let i = 2; names.has(n.toLowerCase()); i++) n = `${name} ${i}`;
  return n;
}

/** A new theme in data/themes: from the template, or from CSS you upload. */
export function createTheme(input: { name?: string; css?: string; fileName?: string }): ThemeInfo {
  let css = input.css;
  let name = input.name?.trim();
  if (css !== undefined) {
    if (css.length > 2_000_000) throw new UserError("That file is too large to be a theme.");
    name = name || readMeta(css).name || input.fileName?.replace(/\.css$/i, "") || "My theme";
  } else {
    css = fs.readFileSync(TEMPLATE, "utf8");
    name = name || "My theme";
  }
  name = uniqueName(name);
  const stem = freeStem(name);
  fs.writeFileSync(path.join(USER_THEMES, `${stem}.css`), withName(css, name));
  return info("user", `${stem}.css`)!;
}

/** Copies a theme (and its fonts/images folder) into data/themes so you can change it. */
export function duplicateTheme(id: string): ThemeInfo {
  const src = locate(id);
  const original = info(src.source, `${src.stem}.css`)!;
  const name = uniqueName(`${original.name} copy`);
  const stem = freeStem(name);
  let css = fs.readFileSync(src.file, "utf8");
  const assets = path.join(dirOf(src.source), src.stem);
  if (fs.existsSync(assets) && fs.statSync(assets).isDirectory()) {
    fs.cpSync(assets, path.join(USER_THEMES, stem), { recursive: true });
    // Point relative links (url("washi/fonts/…")) at the copied folder.
    const escaped = src.stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    css = css.replace(new RegExp(`(url\\(\\s*["']?|@import\\s+["'])(\\./)?${escaped}/`, "g"), (_, a) => `${a}${stem}/`);
  }
  fs.writeFileSync(path.join(USER_THEMES, `${stem}.css`), withName(css, name));
  return info("user", `${stem}.css`)!;
}

/** Your own themes can be removed; they are moved to data/themes/.removed/, not deleted. */
export function removeTheme(id: string) {
  const t = locate(id);
  if (t.source !== "user") throw new UserError("Built-in themes can't be removed.");
  const bin = path.join(USER_THEMES, ".removed", `${new Date().toISOString().replace(/[:.]/g, "-")}-${t.stem}`);
  fs.mkdirSync(bin, { recursive: true });
  fs.renameSync(t.file, path.join(bin, `${t.stem}.css`));
  const assets = path.join(USER_THEMES, t.stem);
  if (fs.existsSync(assets)) fs.renameSync(assets, path.join(bin, t.stem));
  if (getSetting("ui.theme", DEFAULT_THEME) === id) setSetting("ui.theme", DEFAULT_THEME);
  return listThemes();
}

/** Shows data/themes in the file manager (Explorer, Finder…). */
export function openThemesFolder() {
  const [cmd, args] =
    process.platform === "win32"
      ? ["explorer", [USER_THEMES]]
      : process.platform === "darwin"
        ? ["open", [USER_THEMES]]
        : ["xdg-open", [USER_THEMES]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
}
