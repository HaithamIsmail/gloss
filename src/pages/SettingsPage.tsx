import tokensCss from "../styles/tokens.css?raw";

import { Check, Copy, ExternalLink, FilePlus2, FolderOpen, Palette, Plus, Trash2, Upload } from "lucide-react";
import { useMemo, useRef } from "react";
import { NavLink, useParams } from "react-router";
import type { ThemeInfo, ThemeList } from "../../shared/api";
import { api, keys, queryClient, useThemes } from "../api";
import { toast } from "../toast";

const DOCS = "https://github.com/HaithamIsmail/gloss/blob/main/docs/themes.md";

const TABS = [{ id: "themes", label: "Themes", icon: Palette }] as const;

export function SettingsPage() {
  const { tab = "themes" } = useParams();
  return (
    <div className="page page-wide settings-page">
      <div className="kicker">Workspace</div>
      <h1 className="page-title">Settings</h1>
      <nav className="settings-tabs" aria-label="Settings">
        {TABS.map(({ id, label, icon: Icon }) => (
          <NavLink key={id} to={`/settings/${id}`} className={() => `settings-tab${tab === id ? " is-active" : ""}`}>
            <Icon size={15} /> {label}
          </NavLink>
        ))}
      </nav>
      {tab === "themes" && <ThemesTab />}
    </div>
  );
}

// ── Themes ───────────────────────────────────────────────────────────────

const setList = (list: ThemeList) => queryClient.setQueryData(keys.themes, list);
const refresh = () => queryClient.invalidateQueries({ queryKey: keys.themes });

async function use(t: ThemeInfo) {
  try {
    setList(await api.setTheme(t.id));
  } catch (err) {
    toast((err as Error).message || "Could not switch theme.");
  }
}

function ThemesTab() {
  const { data, isLoading } = useThemes();
  const fileRef = useRef<HTMLInputElement>(null);
  const builtin = data?.themes.filter((t) => t.source === "builtin") ?? [];
  const mine = data?.themes.filter((t) => t.source === "user") ?? [];

  const openFolder = () => void api.openThemesFolder().catch(() => toast("Could not open the folder."));

  const created = async (t: ThemeInfo, verb: string) => {
    await refresh();
    await use(t);
    toast(`${verb} “${t.name}” in your themes folder. Edit its CSS, then come back here.`, {
      label: "Open folder",
      run: openFolder,
    });
  };

  const newTheme = async () => {
    try {
      await created(await api.createTheme(), "Created");
    } catch (err) {
      toast((err as Error).message || "Could not create a theme.");
    }
  };

  const addFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const t = await api.createTheme({ css: await file.text(), fileName: file.name });
      await refresh();
      await use(t);
      toast(`Added “${t.name}”.`);
    } catch (err) {
      toast((err as Error).message || "Could not add that theme.");
    }
  };

  return (
    <section className="themes-tab">
      <p className="page-lede muted">
        Change the colours, fonts and feel of Gloss. Themes are CSS files, like Typora's: pick one below, or make your
        own and drop it in your themes folder.
      </p>

      <div className="section-head">
        <span className="section-head-title">Built-in</span>
      </div>
      {isLoading && <p className="muted">Loading…</p>}
      <div className="theme-grid">
        {builtin.map((t) => (
          <ThemeCard key={t.id} theme={t} current={data?.current === t.id} />
        ))}
      </div>

      <div className="section-head">
        <span className="section-head-title">Your themes</span>
        <span className="section-head-actions">
          <button type="button" className="btn-secondary" onClick={() => void newTheme()}>
            <FilePlus2 size={15} />
            <span>New theme</span>
          </button>
          <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
            <Upload size={15} />
            <span>Add a theme file…</span>
          </button>
          <button type="button" className="btn-secondary" onClick={openFolder}>
            <FolderOpen size={15} />
            <span>Open themes folder</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".css,text/css"
            hidden
            onChange={(e) => {
              void addFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </span>
      </div>
      {data && !mine.length && (
        <p className="muted empty-note">
          None yet. <strong>New theme</strong> starts one from a commented template; <strong>Duplicate</strong> on a
          theme above copies it so you can change it.
        </p>
      )}
      <div className="theme-grid">
        {mine.map((t) => (
          <ThemeCard key={t.id} theme={t} current={data?.current === t.id} />
        ))}
      </div>

      <div className="theme-howto">
        <h2>Make your own</h2>
        <ol>
          <li>
            <strong>New theme</strong> (or <strong>Duplicate</strong> one you like). It appears under <em>Your themes</em>{" "}
            and is switched on.
          </li>
          <li>
            <strong>Open themes folder</strong> and edit its <code>.css</code> file in any text editor. Every setting is
            explained in the file: colours, fonts, corner radius, line weight, backgrounds, code colours.
          </li>
          <li>Save, then come back to Gloss: the change shows as soon as this window has focus.</li>
          <li>
            Fonts and pictures go in a folder with the theme's name next to it (<code>my-theme/fonts/…</code>). Share a
            theme by sending its <code>.css</code> file (and that folder).
          </li>
        </ol>
        <p className="muted">
          Your themes folder: <code>{data?.folder ?? "data/themes"}</code>{" "}
          <button
            type="button"
            className="icon-btn inline"
            title="Copy the path"
            onClick={() => data && void navigator.clipboard.writeText(data.folder).then(() => toast("Path copied"))}
          >
            <Copy size={13} />
          </button>
          {" · "}
          <a href={DOCS} target="_blank" rel="noreferrer">
            Theme guide <ExternalLink size={12} />
          </a>
        </p>
      </div>
    </section>
  );
}

function ThemeCard({ theme: t, current }: { theme: ThemeInfo; current: boolean }) {
  const duplicate = async () => {
    try {
      const copy = await api.duplicateTheme(t.id);
      await refresh();
      await use(copy);
      toast(`Duplicated as “${copy.name}”. Edit its CSS in your themes folder.`, {
        label: "Open folder",
        run: () => void api.openThemesFolder(),
      });
    } catch (err) {
      toast((err as Error).message || "Could not duplicate that theme.");
    }
  };

  const remove = async () => {
    if (!confirm(`Remove “${t.name}”? Its file moves to data/themes/.removed/.`)) return;
    try {
      setList(await api.removeTheme(t.id));
      toast(`Removed “${t.name}”`);
    } catch (err) {
      toast((err as Error).message || "Could not remove that theme.");
    }
  };

  return (
    <article className={`theme-card${current ? " is-current" : ""}`}>
      <button type="button" className="theme-preview" onClick={() => void use(t)} title={`Use ${t.name}`}>
        <ThemePreview href={t.href} />
        {current && (
          <span className="theme-current">
            <Check size={13} strokeWidth={3} /> In use
          </span>
        )}
      </button>
      <div className="theme-info">
        <strong className="theme-name">{t.name}</strong>
        <span className="theme-badges">
          {t.source === "user" && <span className="theme-badge">Yours</span>}
          {t.scheme === "dark" && <span className="theme-badge">Dark</span>}
        </span>
        {t.description && <p className="theme-description">{t.description}</p>}
        {t.author && <span className="theme-author">by {t.author}</span>}
      </div>
      <div className="theme-actions">
        {!current && (
          <button type="button" className="btn-primary small" onClick={() => void use(t)}>
            <Plus size={14} /> Use
          </button>
        )}
        <button type="button" className="btn-secondary small" onClick={() => void duplicate()} title="Copy into your themes to change it">
          <Copy size={14} /> Duplicate
        </button>
        {t.source === "user" && (
          <button type="button" className="icon-btn danger" title="Remove theme" onClick={() => void remove()}>
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </article>
  );
}

/** The app's fonts (Archivo…) for previews: copied from the page's own @font-face rules. */
function pageFontFaces(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) if (rule instanceof CSSFontFaceRule) out.push(rule.cssText);
    } catch {
      // a stylesheet from another origin
    }
  }
  return out.join("\n");
}

const MOCK_CSS = `
html, body { margin: 0; height: 100%; overflow: hidden; }
body { font: 15px/1.5 var(--font-body); color: var(--color-text); background: var(--page-background); }
.app { display: grid; grid-template-columns: 210px 1fr; height: 100%; }
.sidebar { background: var(--sidebar-background); border-right: var(--rule); color: var(--color-text); }
.sidebar-brand { display: flex; align-items: center; gap: 9px; height: 52px; padding: 0 16px; border-bottom: var(--rule); }
.sidebar-brand svg { width: 26px; height: 26px; flex: none; }
.brand-name { font: var(--font-heading-weight) 20px/1 var(--font-heading); }
.label { padding: 16px 16px 6px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--color-neutral-700); }
.tree-row { padding: 6px 12px 6px 30px; margin: 0 8px; font-size: 14px; border-radius: var(--radius-sm); }
.tree-row.course { padding-left: 12px; font-weight: 600; }
.material-row.is-active { background: var(--color-accent-200); color: var(--color-accent-800); font-weight: 600; }
.main { padding: 30px 40px; overflow: hidden; }
.kicker { font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--color-accent-700); }
.page-title { margin: 6px 0 14px; font: var(--font-heading-weight) 38px/1.12 var(--font-heading); }
.h { display: flex; gap: 12px; align-items: baseline; margin: 0 0 8px; padding-top: 12px; border-top: var(--rule-ink); font: var(--font-heading-weight) 22px/1.2 var(--font-heading); }
.h b { color: var(--color-accent-700); }
p { margin: 0 0 14px; max-width: 380px; }
.ann-link { background: var(--color-accent-100); border-bottom: 2px solid var(--color-accent-400); }
.ann-link sup { color: var(--color-accent-700); font-weight: 800; }
.row { display: flex; gap: 18px; align-items: flex-start; }
.img { position: relative; width: 210px; height: 120px; background: var(--color-image-bg); border: var(--rule); border-radius: var(--radius); }
.ann-box { position: absolute; left: 92px; top: 26px; width: 70px; height: 58px; border: 2px solid var(--color-accent); background: color-mix(in srgb, var(--color-accent) 12%, transparent); }
.ann-box span { position: absolute; left: -2px; top: -2px; padding: 2px 6px; background: var(--color-accent); color: var(--color-on-accent); font: 800 11px/1 var(--font-body); }
.shape { position: absolute; left: 20px; top: 34px; width: 54px; height: 54px; border-radius: 40%; border: 2px solid var(--color-neutral-600); }
.callout { padding: 10px 12px; width: 190px; border-left: 3px solid var(--color-text); background: var(--color-surface); border-radius: var(--radius); font-size: 13px; }
.btn-primary { display: inline-block; margin-top: 12px; padding: 8px 16px; border: 0; background: var(--color-accent); color: var(--color-on-accent); font: 800 14px var(--font-body); border-radius: var(--radius-sm); }
`;

const MOCK_HTML = `
<div class="app">
  <aside class="sidebar">
    <div class="sidebar-brand">
      <svg viewBox="0 0 48 48"><rect width="48" height="48" fill="var(--color-accent)"/><rect x="13" y="13" width="22" height="22" fill="none" stroke="var(--color-on-accent)" stroke-width="4"/><rect x="11" y="11" width="14" height="14" fill="var(--color-on-accent)"/><path d="M16.5 13.7H19.5V22.3H16.5V16L14.3 17.4V15.3Z" fill="var(--color-accent)"/></svg>
      <span class="brand-name">Gloss</span>
    </div>
    <div class="label">Courses</div>
    <div class="tree-row course">Human Anatomy</div>
    <div class="tree-row material-row is-active">Unit 3 · The Heart</div>
    <div class="tree-row material-row">Unit 4 · Vessels</div>
    <div class="tree-row course">Linear Algebra</div>
    <div class="tree-row material-row">Eigenvalues</div>
  </aside>
  <main class="main">
    <div class="kicker">ANAT 201 · Human Anatomy</div>
    <div class="page-title">The Heart</div>
    <div class="h"><b>2</b> Chambers</div>
    <p>The <span class="ann-link">left ventricle<sup>1</sup></span> has the thickest wall of the four chambers.</p>
    <div class="row">
      <div class="img"><div class="shape"></div><div class="ann-box"><span>1</span></div></div>
      <div><div class="callout">Exam tip: name every vessel of each chamber.</div><span class="btn-primary">Link text</span></div>
    </div>
  </main>
</div>`;

/** A small mock of the app, drawn with the theme's own stylesheet in an isolated frame. */
function ThemePreview({ href }: { href: string }) {
  const doc = useMemo(
    () => `<!doctype html><html><head><meta charset="utf-8">
<style>${pageFontFaces()}</style>
<style>${tokensCss}</style>
<style>${MOCK_CSS}</style>
<link rel="stylesheet" href="${href}">
</head><body>${MOCK_HTML}</body></html>`,
    [href],
  );
  return <iframe className="theme-frame" srcDoc={doc} title="Theme preview" tabIndex={-1} aria-hidden="true" loading="lazy" />;
}
