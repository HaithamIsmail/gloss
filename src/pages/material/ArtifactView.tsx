import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import CodeMirror from "@uiw/react-codemirror";
import { Code, Download, ExternalLink, FilePlus, History, Maximize, Minimize, RotateCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactMaterial, Material } from "../../../shared/api";
import { asArtifact, isArtifactText, type ArtifactFile } from "../../../shared/pages";
import { api, keys, patchTreeMaterial, queryClient, useTree } from "../../api";
import { pickArtifactFiles, relPathOf } from "../../artifacts/importArtifact";
import { Backlinks } from "../../components/Backlinks";
import { registerFlusher } from "../../flush";
import { download, formatBytes } from "../../format";
import { useUI } from "../../store";
import { toast } from "../../toast";
import { isTyping, TitleInput } from "./shared";

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: "var(--code-keyword)", fontWeight: "600" },
  { tag: [t.string, t.special(t.string), t.regexp, t.attributeValue], color: "var(--code-string)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--code-comment)", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.null, t.unit, t.color], color: "var(--code-number)" },
  { tag: [t.tagName, t.angleBracket], color: "var(--code-keyword)" },
  { tag: [t.attributeName, t.propertyName], color: "var(--code-name)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.className], color: "var(--code-name)", fontWeight: "600" },
  { tag: [t.definition(t.variableName)], color: "var(--code-name)", fontWeight: "700" },
  { tag: [t.heading], color: "var(--code-name)", fontWeight: "800" },
  { tag: [t.link, t.url], color: "var(--code-keyword)" },
]);

const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", fontSize: "13px", height: "100%" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.5" },
  ".cm-content": { padding: "10px 0", caretColor: "var(--color-accent)" },
  ".cm-line": { padding: "0 12px 0 6px" },
  ".cm-gutters": { backgroundColor: "transparent", border: "0", color: "var(--color-neutral-500)" },
  ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--color-accent) 6%, transparent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 18%, transparent) !important",
  },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--color-accent) 15%, transparent)", outline: "none" },
  ".cm-tooltip": { border: "var(--rule-ink)", borderRadius: "var(--radius-sm)", backgroundColor: "var(--color-bg)", color: "var(--color-text)" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--color-accent)", color: "var(--color-on-accent)" },
});

function languageFor(p: string) {
  if (/\.html?$/i.test(p)) return html();
  if (/\.css$/i.test(p)) return css();
  if (/\.(m?js)$/i.test(p)) return javascript();
  if (/\.json$/i.test(p)) return javascript();
  if (/\.md$/i.test(p)) return markdown();
  return [];
}

const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleString();
};


/**
 * An artifact: an HTML page kept with its files and shown in a sandboxed
 * frame, with a source editor beside it. Agents edit the same files through
 * the API; the page notices and reloads.
 */
export default function ArtifactView({ material }: { material: Material }) {
  const { data: tree } = useTree();
  const course = tree?.courses.find((c) => c.id === material.courseId);
  const folder = material.parentId ? course?.materials.find((m) => m.id === material.parentId) : undefined;
  const art = asArtifact(material.content);
  const [frameKey, setFrameKey] = useState(0);
  const [source, setSource] = useState(() => useUI.getState().prefs.artifactSource ?? false);
  const [wide, setWide] = useState(false);
  const [file, setFile] = useState(art.entry);
  const frame = useRef<HTMLIFrameElement>(null);

  const put = useCallback((m: ArtifactMaterial) => {
    queryClient.setQueryData<Material>(keys.material(m.id), m);
    const { content: _c, ...summary } = m;
    patchTreeMaterial(summary);
  }, []);

  const reload = useCallback(() => setFrameKey((k) => k + 1), []);

  // Someone else (an agent, another tab) may change the files: look every few seconds while visible.
  const stamp = useMemo(() => Math.max(0, ...art.files.map((f) => f.updatedAt)) + ":" + art.files.length, [art.files]);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop || document.hidden) return;
      try {
        const files = await api.artifactFiles(material.id);
        const s = Math.max(0, ...files.map((f) => f.updatedAt)) + ":" + files.length;
        if (!stop && s !== stamp) {
          const m = await api.material(material.id);
          put(m as ArtifactMaterial);
          reload();
        }
      } catch {
        // offline for a moment: try again next time
      }
    };
    const id = window.setInterval(() => void tick(), 3000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [material.id, stamp, put, reload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) && !(e.ctrlKey || e.metaKey)) return;
      if (e.key === "Escape" && wide) setWide(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wide]);

  const toggleSource = () => {
    useUI.getState().setPref("artifactSource", !source);
    setSource(!source);
  };

  const addFiles = async () => {
    const picked = await pickArtifactFiles();
    if (!picked.length) return;
    try {
      const m = await api.addArtifactFiles(
        material.id,
        picked.map((f) => ({ file: f, path: relPathOf(f) })),
      );
      if (m) put(m);
      reload();
      toast(picked.length === 1 ? `Added ${picked[0].name}` : `Added ${picked.length} files`);
    } catch (err) {
      toast((err as Error).message || "Could not add those files.");
    }
  };

  const frameSrc = `/artifacts/${material.id}/${art.entry}?v=${frameKey}:${stamp}`;
  const kicker = [course?.code, course?.name, folder?.title, "Artifact"].filter(Boolean).join(" · ");

  return (
    <div className={`artifact-page${wide ? " is-wide" : ""}`}>
      {!wide && (
        <div className="artifact-head">
          <div className="kicker">{kicker}</div>
          <TitleInput material={material} className="input-title artifact-title-input" />
          <DescriptionInput material={material} description={art.description} onSaved={put} />
          <Backlinks materialId={material.id} className="is-inline" />
        </div>
      )}
      <div className="artifact-bar">
        {wide && <span className="artifact-bar-title">{material.title || "Untitled"}</span>}
        <button type="button" className="block-btn" title="Reload the page" onClick={reload}>
          <RotateCw size={14} /> Reload
        </button>
        <a className="block-btn" href={`/artifacts/${material.id}/${art.entry}`} target="_blank" rel="noreferrer" title="Open in its own tab">
          <ExternalLink size={14} /> Open
        </a>
        <button type="button" className="block-btn" title="Download the page and its files as a zip" onClick={() => download(`/api/materials/${material.id}/artifact/download`)}>
          <Download size={14} /> Download
        </button>
        <button type="button" className="block-btn" title="Add files the page uses (images, scripts, data)" onClick={() => void addFiles()}>
          <FilePlus size={14} /> Add files
        </button>
        <span className="grow" />
        <span className="artifact-files-count muted">
          {art.files.length} file{art.files.length === 1 ? "" : "s"}
          {art.source && (
            <>
              {" · "}
              {/^https?:\/\//.test(art.source) ? (
                <a href={art.source} target="_blank" rel="noreferrer">
                  source
                </a>
              ) : (
                art.source
              )}
            </>
          )}
        </span>
        <button type="button" className={`block-btn${source ? " is-on" : ""}`} title="Show the source and edit it" onClick={toggleSource}>
          <Code size={14} /> Source
        </button>
        <button type="button" className="icon-btn" title={wide ? "Back to the page (Esc)" : "Fill the window"} onClick={() => setWide((w) => !w)}>
          {wide ? <Minimize size={16} /> : <Maximize size={16} />}
        </button>
      </div>
      <div className="artifact-body">
        <iframe
          key={frameKey}
          ref={frame}
          className="artifact-frame"
          title={material.title || "Artifact"}
          // Isolation comes from the Content-Security-Policy: sandbox header the server puts on the page
          // (an opaque origin, no access to the app or the API), which also holds when it is opened in its own tab.
          // A sandbox attribute here would be the same thing twice, and some embedded browsers refuse such frames.
          src={frameSrc}
          referrerPolicy="no-referrer"
        />
        {source && (
          <SourcePanel
            material={material}
            files={art.files}
            entry={art.entry}
            file={file}
            setFile={setFile}
            onSaved={(m) => {
              put(m);
              reload();
            }}
            onClose={toggleSource}
          />
        )}
      </div>
    </div>
  );
}

/** The one-line description under the title, saved as you type. */
function DescriptionInput({
  material,
  description,
  onSaved,
}: {
  material: Material;
  description: string;
  onSaved: (m: ArtifactMaterial) => void;
}) {
  const [value, setValue] = useState(description);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (pending.current === null) setValue(description);
  }, [description]);
  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (pending.current === null) return;
    const description = pending.current;
    pending.current = null;
    try {
      onSaved(await api.patchArtifact(material.id, { description }));
    } catch (err) {
      toast((err as Error).message || "Could not save the description.");
    }
  }, [material.id, onSaved]);
  useEffect(() => {
    const unregister = registerFlusher(save);
    return () => {
      unregister();
      void save();
    };
  }, [save]);
  return (
    <input
      className="artifact-description"
      value={value}
      placeholder="What this page is for (optional)"
      onChange={(e) => {
        setValue(e.target.value);
        pending.current = e.target.value;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void save(), 600);
      }}
    />
  );
}

/** The files of the artifact: text ones open in the editor; Ctrl S saves; the entry page has earlier versions. */
function SourcePanel({
  material,
  files,
  entry,
  file,
  setFile,
  onSaved,
  onClose,
}: {
  material: Material;
  files: ArtifactFile[];
  entry: string;
  file: string;
  setFile: (p: string) => void;
  onSaved: (m: ArtifactMaterial) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ at: number; size: number }[] | null>(null);
  const dirty = text !== null && text !== saved;
  const current = files.find((f) => f.path === file) ?? files[0];
  const editable = !!current && isArtifactText(current.path);

  // Load the file; reload it when it changes on disk and nothing is unsaved here.
  useEffect(() => {
    if (!current || !editable) return void setText(null);
    if (dirty) return;
    if (current.updatedAt === loadedAt && saved !== null) return;
    let gone = false;
    api
      .artifactText(material.id, current.path)
      .then((f) => {
        if (gone) return;
        setText(f.text);
        setSaved(f.text);
        setLoadedAt(current.updatedAt);
      })
      .catch(() => !gone && toast("Could not read that file."));
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material.id, current?.path, current?.updatedAt, editable]);

  const save = useCallback(async () => {
    if (!current || text === null || text === saved || busy) return;
    setBusy(true);
    try {
      const m = await api.writeArtifactText(material.id, current.path, text);
      setSaved(text);
      setLoadedAt(asArtifact(m.content).files.find((f) => f.path === current.path)?.updatedAt ?? Date.now());
      onSaved(m);
      setHistory(null);
    } catch (err) {
      toast((err as Error).message || "Could not save.");
    } finally {
      setBusy(false);
    }
  }, [current, text, saved, busy, material.id, onSaved]);

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => registerFlusher(() => saveRef.current()), []);

  const extensions = useMemo(
    () => [
      languageFor(current?.path ?? ""),
      syntaxHighlighting(highlight),
      theme,
      EditorView.lineWrapping,
      Prec.highest(keymap.of([{ key: "Mod-s", run: () => (void saveRef.current(), true) }])),
    ],
    [current?.path],
  );

  const remove = async () => {
    if (!current || current.path === entry) return;
    if (!window.confirm(`Remove ${current.path} from this artifact?`)) return;
    try {
      onSaved(await api.deleteArtifactFile(material.id, current.path));
      setFile(entry);
      setText(null);
      setSaved(null);
    } catch (err) {
      toast((err as Error).message || "Could not remove that file.");
    }
  };

  const showHistory = async () => {
    if (history) return void setHistory(null);
    try {
      setHistory(await api.artifactHistory(material.id));
    } catch {
      toast("Could not load earlier versions.");
    }
  };

  const restore = async (at: number) => {
    if (dirty && !window.confirm("Discard your unsaved edits and restore this version?")) return;
    try {
      const m = await api.restoreArtifactHistory(material.id, at);
      setText(null);
      setSaved(null);
      setHistory(null);
      onSaved(m);
      toast("Earlier version restored. The one it replaced is in the history.");
    } catch (err) {
      toast((err as Error).message || "Could not restore that version.");
    }
  };

  return (
    <aside className="artifact-source">
      <div className="artifact-source-bar">
        <select className="artifact-file-select" value={current?.path ?? ""} onChange={(e) => setFile(e.target.value)} title="File">
          {files.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path} · {formatBytes(f.size)}
            </option>
          ))}
        </select>
        {current?.path === entry && (
          <button type="button" className={`icon-btn${history ? " is-on" : ""}`} title="Earlier versions of the page" onClick={() => void showHistory()}>
            <History size={15} />
          </button>
        )}
        {current && current.path !== entry && (
          <button type="button" className="icon-btn danger" title="Remove this file" onClick={() => void remove()}>
            <Trash2 size={15} />
          </button>
        )}
        <span className="grow" />
        {editable && (
          <button type="button" className="btn-primary small artifact-save" disabled={!dirty || busy} onClick={() => void save()} title="Save (Ctrl S)">
            {busy ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        )}
        <button type="button" className="icon-btn" title="Close the source" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      {history && (
        <div className="artifact-history">
          {!history.length && <span className="muted">No earlier versions yet. One is kept each time the page is saved.</span>}
          {history.map((h) => (
            <button type="button" key={h.at} className="artifact-history-item" onClick={() => void restore(h.at)} title="Restore this version">
              <span>{new Date(h.at).toLocaleString()}</span>
              <span className="muted">
                {ago(h.at)} · {formatBytes(h.size)}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="artifact-editor">
        {!current ? (
          <p className="muted artifact-note">No files.</p>
        ) : !editable ? (
          <p className="muted artifact-note">
            {current.path} is a binary file ({formatBytes(current.size)}). Use <strong>Add files</strong> to replace it.
          </p>
        ) : text === null ? (
          <p className="muted artifact-note">Loading…</p>
        ) : (
          <CodeMirror value={text} onChange={setText} extensions={extensions} theme="none" height="100%" indentWithTab />
        )}
      </div>
    </aside>
  );
}
