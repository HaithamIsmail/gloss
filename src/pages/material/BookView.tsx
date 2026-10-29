import {
  ChevronLeft,
  ChevronRight,
  Download,
  Highlighter,
  Link,
  List,
  Maximize,
  Minus,
  MoreHorizontal,
  PanelRight,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { nanoid } from "nanoid";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { BookPatch, Material } from "../../../shared/api";
import {
  asBook,
  BOOK_STATUS_LABEL,
  bookProgressLabel,
  type BookHighlight,
  type BookProgress,
  type BookStatus,
} from "../../../shared/pages";
import { api, keys, patchTreeMaterial, queryClient, useTree } from "../../api";
import { CommentText } from "../../annotate/CommentText";
import type { BookSelection, TocEntry, ViewerHandle } from "../../books/types";
import { Backlinks } from "../../components/Backlinks";
import { useFolderPosition } from "../../components/FolderNav";
import { useUI } from "../../store";
import { toast } from "../../toast";
import { findMaterial } from "../../tree";
import { isTyping, TitleInput } from "./shared";

const PdfBook = lazy(() => import("../../books/PdfBook").then((m) => ({ default: m.PdfBook })));
const EpubBook = lazy(() => import("../../books/EpubBook").then((m) => ({ default: m.EpubBook })));

const SPLIT_KEY = "gloss-book-split";
const PANEL_KEY = "gloss-book-panel";
const DETAILS_KEY = "gloss-book-details";

/** Entries whose next entry is deeper have children; ids nest as "t0", "t0.2", "t0.2.1". */
const hasChildren = (toc: TocEntry[], i: number) => i + 1 < toc.length && toc[i + 1].depth > toc[i].depth;
const isHidden = (collapsed: Set<string>, id: string) => {
  for (const c of collapsed) if (id.startsWith(`${c}.`)) return true;
  return false;
};

function readSplit() {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY));
    return v > 0.3 && v < 0.9 ? v : 0.68;
  } catch {
    return 0.68;
  }
}

/** Puts an absolute link to a place in the app on the clipboard. */
async function copyLink(path: string) {
  try {
    await navigator.clipboard.writeText(`${location.origin}${path}`);
    toast("Link copied");
  } catch {
    toast("Could not copy the link.");
  }
}

const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.round(bytes / 1024)} KB`;

/** A book: the file as it is, read in the app, with highlights you can link to from any page. */
export default function BookView({ material }: { material: Material }) {
  const { data: tree } = useTree();
  // From the tree, so a move (to a course or to the library only) shows at once.
  const { course } = findMaterial(tree, material.id);
  const { folder, index, count } = useFolderPosition(material);
  const book = useMemo(() => asBook(material.content), [material.content]);
  const viewer = useRef<ViewerHandle>(null);

  const [info, setInfo] = useState<{ length: number; toc: TocEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<BookSelection | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [panel, setPanel] = useState(() => localStorage.getItem(PANEL_KEY) !== "closed");
  const [split, setSplit] = useState(readSplit);
  const [tocOpen, setTocOpen] = useState(false);
  // Contents: branches start folded; a chevron opens them.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const collapsed = useMemo(() => {
    const set = new Set<string>();
    info?.toc.forEach((t, i) => {
      if (hasChildren(info.toc, i) && !expanded.has(t.id)) set.add(t.id);
    });
    return set;
  }, [info, expanded]);
  const toggleBranch = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // The title block (cover, author, status, file…) is tucked away unless asked for.
  const [details, setDetails] = useState(() => localStorage.getItem(DETAILS_KEY) === "open");
  const [moreOpen, setMoreOpen] = useState(false);
  const toggleDetails = () => {
    setDetails((d) => {
      remember(DETAILS_KEY, d ? "closed" : "open");
      return !d;
    });
    setMoreOpen(false);
  };
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ current: number; total: number } | null>(null);
  const [pos, setPos] = useState<Omit<BookProgress, "updatedAt"> | null>(null);
  const [pageInput, setPageInput] = useState("");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [authors, setAuthors] = useState(book.meta.authors);
  const findRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Saving: every change is a partial update, so two tabs never overwrite each other ──
  const patch = useCallback(
    async (p: BookPatch) => {
      try {
        const m = await api.patchBook(material.id, p);
        queryClient.setQueryData(keys.material(material.id), m);
        const { content: _c, ...summary } = m;
        patchTreeMaterial(summary);
        return m;
      } catch (err) {
        toast((err as Error).message || "Could not save that.");
        return null;
      }
    },
    [material.id],
  );

  // Where you are is saved after a pause (and when you leave).
  const pending = useRef<Omit<BookProgress, "updatedAt"> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const flushProgress = useCallback(() => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    void patch({ progress: { ...p, updatedAt: Date.now() } });
  }, [patch]);
  const onLocation = useCallback(
    (p: Omit<BookProgress, "updatedAt">) => {
      setPos(p);
      if (p.loc?.kind === "pdf") setPageInput(String(p.loc.page));
      pending.current = p;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flushProgress, 1500);
    },
    [flushProgress],
  );
  useEffect(() => {
    const onUnload = () => {
      const p = pending.current;
      if (!p) return;
      void fetch(`/api/materials/${material.id}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ progress: { ...p, updatedAt: Date.now() } }),
        keepalive: true,
      });
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      flushProgress();
    };
  }, [flushProgress, material.id]);

  // Highlights made in another tab show up when you come back to this one.
  useEffect(() => {
    const onFocus = () => void queryClient.invalidateQueries({ queryKey: keys.material(material.id) });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [material.id]);

  // ── Highlights ──
  const goTo = useCallback((h: BookHighlight) => {
    setActive(h.id);
    void viewer.current?.goTo(h.loc);
  }, []);

  const addHighlight = async () => {
    if (!sel) return;
    const h: BookHighlight = {
      id: nanoid(10),
      loc: sel.loc,
      quote: sel.quote.slice(0, 2000),
      note: "",
      at: sel.at,
      createdAt: Date.now(),
    };
    setSel(null);
    viewer.current?.clearSelection();
    const m = await patch({ addHighlight: h });
    if (!m) return;
    setActive(h.id);
    setPanel(true);
    remember(PANEL_KEY, "open");
    setEditingNote(h.id);
  };

  const removeHighlight = async (id: string) => {
    if (active === id) setActive(null);
    await patch({ removeHighlight: id });
  };

  // Arriving from a link or search: open the book at that highlight.
  const [params, setParams] = useSearchParams();
  const annParam = params.get("ann");
  useEffect(() => {
    if (!info || !annParam) return;
    const h = book.highlights.find((x) => x.id === annParam);
    if (h) {
      goTo(h);
      setPanel(true);
    } else {
      toast("That highlight is no longer in the book.");
    }
    setParams({}, { replace: true });
  }, [info, annParam, book.highlights, goTo, setParams]);

  // …or at a page (?page=N, PDFs) or an EPUB location (?loc=<cfi>), with no highlight involved.
  const pageParam = params.get("page");
  const locParam = params.get("loc");
  useEffect(() => {
    if (!info || (!pageParam && !locParam)) return;
    const n = Number(pageParam);
    if (pageParam && n >= 1) viewer.current?.goToPage?.(Math.min(n, info.length || n));
    else if (locParam) viewer.current?.goTo({ kind: "epub", cfi: locParam });
    setParams({}, { replace: true });
  }, [info, pageParam, locParam, setParams]);

  // A link to where you are now (the page of a PDF, the location in an EPUB).
  const hereLink = () => {
    const loc = pos?.loc ?? book.progress.loc;
    if (loc?.kind === "pdf") return `/m/${material.id}?page=${loc.page}`;
    if (loc?.kind === "epub") return `/m/${material.id}?loc=${encodeURIComponent(loc.cfi)}`;
    return `/m/${material.id}`;
  };

  useEffect(() => {
    if (!active) return;
    panelRef.current?.querySelector(`[data-hl="${CSS.escape(active)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  // ── Keys: ← → turn pages, + − 0 zoom, Ctrl F finds in the book, Esc closes things ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState();
      if (ui.searchOpen || ui.drawingSession || document.querySelector(".tour, .search-backdrop, .history-panel")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
        window.setTimeout(() => findRef.current?.select(), 0);
        return;
      }
      if (e.key === "Escape") {
        if (findOpen) {
          e.preventDefault();
          setFindOpen(false);
          setQuery("");
          viewer.current?.clearFind();
        } else if (tocOpen) setTocOpen(false);
        else if (sel) {
          setSel(null);
          viewer.current?.clearSelection();
        } else if (editingNote) setEditingNote(null);
        return;
      }
      if (isTyping(e.target) || mod || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        e.stopPropagation();
        viewer.current?.next();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        e.stopPropagation();
        viewer.current?.prev();
      } else if (e.key === "+" || e.key === "=") viewer.current?.zoom(1);
      else if (e.key === "-") viewer.current?.zoom(-1);
      else if (e.key === "0") viewer.current?.zoom(0);
    };
    // Capture: runs before the folder's ‹ › keys, which would otherwise change material.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [findOpen, tocOpen, sel, editingNote]);

  // ── Metadata ──
  const authorsTimer = useRef<number | undefined>(undefined);
  const onAuthors = (v: string) => {
    setAuthors(v);
    window.clearTimeout(authorsTimer.current);
    authorsTimer.current = window.setTimeout(() => void patch({ meta: { authors: v } }), 600);
  };

  const startSplitDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const move = (ev: PointerEvent) => setSplit(Math.min(0.9, Math.max(0.3, (ev.clientX - box.left) / box.width)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      setSplit((v) => {
        remember(SPLIT_KEY, String(v));
        return v;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const togglePanel = () => {
    setPanel((p) => {
      remember(PANEL_KEY, p ? "closed" : "open");
      return !p;
    });
  };

  const isPdf = book.file.format === "pdf";
  const viewerHighlights = useMemo(() => book.highlights.map((h) => ({ id: h.id, loc: h.loc })), [book.highlights]);
  const where = pos ? (pos.loc?.kind === "pdf" ? `p. ${pos.loc.page} / ${info?.length ?? book.length}` : pos.label) : bookProgressLabel(book);
  const kicker = folder
    ? [course?.code, folder.title, `${index + 1} of ${count}`]
    : [...(course ? [course.code, course.name] : ["Library"]), isPdf ? "PDF" : "EPUB"];

  const viewerProps = {
    ref: viewer,
    url: book.file.url,
    highlights: viewerHighlights,
    activeId: active,
    initial: book.progress.loc,
    onReady: (i: { length: number; toc: TocEntry[] }) => {
      setInfo(i);
      setPageInput((v) => v || String(book.progress.loc?.kind === "pdf" ? book.progress.loc.page : 1));
    },
    onLocation,
    onSelection: setSel,
    onHighlightClick: (id: string) => {
      setActive(id);
      setPanel(true);
    },
    onFind: setFound,
    onError: setError,
  };

  return (
    <div className="book-page">
      {details && (
      <div className="book-head">
        {book.coverUrl && <img className="book-head-cover" src={book.coverUrl} alt="" />}
        <div className="book-head-title">
          <div className="kicker">{kicker.filter(Boolean).join(" · ")}</div>
          <TitleInput material={material} className="input-title book-title-input" />
          <input
            className="book-authors-input"
            value={authors}
            placeholder="Author"
            onChange={(e) => onAuthors(e.target.value)}
            aria-label="Author"
          />
          <div className="book-facts">
            <select
              className="book-status"
              value={book.status}
              onChange={(e) => void patch({ status: e.target.value as BookStatus })}
              aria-label="Reading status"
            >
              {(Object.keys(BOOK_STATUS_LABEL) as BookStatus[]).map((s) => (
                <option key={s} value={s}>
                  {BOOK_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <span className="book-progress" title="Where you are">
              <span className="book-progress-bar">
                <span style={{ width: `${Math.round((pos?.fraction ?? book.progress.fraction) * 100)}%` }} />
              </span>
              <span className="tabular">{where}</span>
            </span>
            <span>{plural(book.highlights.length, "highlight")}</span>
            {book.file.url && (
              <a className="folder-link" href={book.file.url} download={book.file.name} title={formatSize(book.file.size)}>
                <Download size={14} /> {book.file.name}
              </a>
            )}
          </div>
          <Backlinks materialId={material.id} className="is-inline" />
        </div>
      </div>
      )}

      <div className={`book-bar${details ? "" : " is-compact"}`}>
        {!details && <TitleInput material={material} className="book-bar-title" />}
        <div className="view-menu">
          <button
            type="button"
            className={`icon-btn${moreOpen ? " is-on" : ""}`}
            title="More"
            onClick={() => setMoreOpen((o) => !o)}
          >
            <MoreHorizontal size={16} />
          </button>
          {moreOpen && (
            <div className="menu-pop book-more" onMouseLeave={() => setMoreOpen(false)}>
              <button type="button" className="menu-item" onClick={toggleDetails}>
                {details ? "Hide details" : "Show details"}
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setMoreOpen(false);
                  void copyLink(hereLink());
                }}
              >
                <Link size={14} /> {isPdf ? "Copy link to this page" : "Copy link to this spot"}
              </button>
              {!details && (
                <div className="menu-label book-more-facts">
                  {BOOK_STATUS_LABEL[book.status]} · {where} · {plural(book.highlights.length, "highlight")}
                </div>
              )}
            </div>
          )}
        </div>
        <span className="grow" />
        <div className="image-tools book-tools">
          <div className="view-menu">
            <button
              type="button"
              className={`icon-btn${tocOpen ? " is-on" : ""}`}
              title="Contents"
              disabled={!info?.toc.length}
              onClick={() => setTocOpen((o) => !o)}
            >
              <List size={16} />
            </button>
            {tocOpen && info && (
              <div className="menu-pop book-toc" onMouseLeave={() => setTocOpen(false)}>
                <div className="menu-label">Contents</div>
                {info.toc.map((t, i) => {
                  if (isHidden(collapsed, t.id)) return null;
                  const branch = hasChildren(info.toc, i);
                  return (
                    <div key={t.id} className="book-toc-row" style={{ paddingLeft: 4 + t.depth * 14 }}>
                      {branch ? (
                        <button
                          type="button"
                          className={`book-toc-fold${collapsed.has(t.id) ? "" : " is-open"}`}
                          title={collapsed.has(t.id) ? "Expand" : "Collapse"}
                          aria-expanded={!collapsed.has(t.id)}
                          onClick={() => toggleBranch(t.id)}
                        >
                          <ChevronRight size={13} strokeWidth={2.4} />
                        </button>
                      ) : (
                        <span className="book-toc-fold" />
                      )}
                      <button
                        type="button"
                        className="menu-item book-toc-item"
                        onClick={() => {
                          t.go();
                          setTocOpen(false);
                        }}
                      >
                        {t.label}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <button
            type="button"
            className={`icon-btn${findOpen ? " is-on" : ""}`}
            title="Find in the book (Ctrl F)"
            onClick={() => {
              setFindOpen((o) => !o);
              window.setTimeout(() => findRef.current?.select(), 0);
            }}
          >
            <Search size={16} />
          </button>
          <span className="tool-sep" />
          <button type="button" className="icon-btn" title="Previous page (←)" onClick={() => viewer.current?.prev()}>
            <ChevronLeft size={17} />
          </button>
          {isPdf ? (
            <form
              className="book-page-form"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(pageInput);
                if (n) viewer.current?.goToPage?.(n);
                (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.blur();
              }}
            >
              <input
                className="book-page-input tabular"
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
                onFocus={(e) => e.target.select()}
                aria-label="Page"
              />
              <span className="tabular">/ {info?.length ?? (book.length || "…")}</span>
            </form>
          ) : (
            <span className="book-where tabular">{pos?.label ?? ""}</span>
          )}
          <button type="button" className="icon-btn" title="Next page (→)" onClick={() => viewer.current?.next()}>
            <ChevronRight size={17} />
          </button>
          <span className="tool-sep" />
          <button type="button" className="icon-btn" title={isPdf ? "Zoom out (−)" : "Smaller text (−)"} onClick={() => viewer.current?.zoom(-1)}>
            <Minus size={16} />
          </button>
          <button type="button" className="icon-btn" title={isPdf ? "Fit to width (0)" : "Default text size (0)"} onClick={() => viewer.current?.zoom(0)}>
            <Maximize size={15} />
          </button>
          <button type="button" className="icon-btn" title={isPdf ? "Zoom in (+)" : "Larger text (+)"} onClick={() => viewer.current?.zoom(1)}>
            <Plus size={16} />
          </button>
          <span className="tool-sep" />
          <button type="button" className="block-btn" disabled={!sel} title="Highlight the selected text" onClick={() => void addHighlight()}>
            <Highlighter size={14} strokeWidth={2.2} />
            <span>Highlight</span>
          </button>
          <button type="button" className={`icon-btn${panel ? " is-on" : ""}`} title={panel ? "Hide highlights" : "Show highlights"} onClick={togglePanel}>
            <PanelRight size={16} />
          </button>
        </div>
      </div>

      {findOpen && (
        <form
          className="book-find"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) viewer.current?.find(query.trim(), e.nativeEvent instanceof SubmitEvent && (e.nativeEvent.submitter as HTMLButtonElement | null)?.value === "prev" ? -1 : 1);
          }}
        >
          <Search size={15} />
          <input
            ref={findRef}
            autoFocus
            value={query}
            placeholder={isPdf ? "Find in the PDF…" : "Find in the book…"}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value.trim()) {
                viewer.current?.clearFind();
              }
            }}
          />
          <span className="book-find-count tabular">
            {found ? (found.total ? `${found.current} / ${found.total}` : "No matches") : ""}
          </span>
          <button type="submit" value="prev" className="icon-btn" title="Previous match">
            <ChevronLeft size={16} />
          </button>
          <button type="submit" value="next" className="icon-btn" title="Next match">
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Close (Esc)"
            onClick={() => {
              setFindOpen(false);
              setQuery("");
              viewer.current?.clearFind();
            }}
          >
            <X size={16} />
          </button>
        </form>
      )}

      <div className="book-split" style={{ gridTemplateColumns: panel ? `${split}fr 10px ${1 - split}fr` : "1fr" }}>
        <div className="book-pane">
          {error ? (
            <div className="book-error">
              <TriangleAlert size={18} />
              <div>
                <strong>The book could not be opened.</strong>
                <div className="muted">{error}</div>
              </div>
            </div>
          ) : !book.file.url ? (
            <div className="book-error muted">This book has no file.</div>
          ) : (
            <Suspense fallback={<div className="book-loading muted">Opening the book…</div>}>
              {isPdf ? <PdfBook {...viewerProps} /> : <EpubBook {...viewerProps} />}
            </Suspense>
          )}
          {!error && !info && book.file.url && <div className="book-loading muted">Opening the book…</div>}
        </div>
        {panel && <div className="split-handle" onPointerDown={startSplitDrag} title="Drag to resize" />}
        {panel && (
          <HighlightPanel
            ref={panelRef}
            highlights={book.highlights}
            active={active}
            editing={editingNote}
            onEdit={setEditingNote}
            onGo={goTo}
            onNote={(id, note) => void patch({ updateHighlight: { id, note } })}
            onCopyLink={(id) => void copyLink(`/m/${material.id}?ann=${id}`)}
            onDelete={(id) => void removeHighlight(id)}
          />
        )}
      </div>

      {sel && (
        <button
          type="button"
          className="book-hl-pop"
          style={{
            left: Math.min(window.innerWidth - 70, Math.max(70, sel.rect.x + sel.rect.w / 2)),
            top: Math.max(8, sel.rect.y - 44),
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void addHighlight()}
        >
          <Highlighter size={14} strokeWidth={2.2} /> Highlight
        </button>
      )}
    </div>
  );
}

/** The book's highlights in reading order, each with its note. Click one to go there. */
function HighlightPanel({
  ref,
  highlights,
  active,
  editing,
  onEdit,
  onGo,
  onNote,
  onCopyLink,
  onDelete,
}: {
  ref: React.Ref<HTMLDivElement>;
  highlights: BookHighlight[];
  active: string | null;
  editing: string | null;
  onEdit: (id: string | null) => void;
  onGo: (h: BookHighlight) => void;
  onNote: (id: string, note: string) => void;
  onCopyLink: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="ann-comments image-comments book-panel" ref={ref}>
      <div className="ann-comments-head">{highlights.length ? plural(highlights.length, "highlight") : "Highlights"}</div>
      {!highlights.length && (
        <div className="ann-comments-empty">
          Select text in the book and press <strong>Highlight</strong>. Each highlight gets a note, and pages can link to it
          with <strong>@</strong>.
        </div>
      )}
      {highlights.map((h, i) => (
        <div key={h.id} data-hl={h.id} className={`ann-comment book-hl-item${active === h.id ? " is-active" : ""}`}>
          <span className="ann-badge">{i + 1}</span>
          <div className="ann-comment-main">
            <button type="button" className="book-hl-quote" title="Go to this passage" onClick={() => onGo(h)}>
              {h.quote || "(no text)"}
            </button>
            <div className="book-hl-where muted">{h.loc.kind === "pdf" ? `p. ${h.loc.page}` : `${Math.round(h.at * 100)}%`}</div>
            {editing === h.id ? (
              <NoteEditor initial={h.note} onCommit={(note) => onNote(h.id, note)} onDone={() => onEdit(null)} />
            ) : (
              <div
                className={`ann-comment-text${h.note ? "" : " is-empty"}`}
                title={h.note ? "Click to edit (Markdown and $math$ work)" : undefined}
                onClick={(e) => {
                  if (!(e.target as Element).closest("a")) onEdit(h.id);
                }}
              >
                {h.note ? <CommentText text={h.note} /> : "Add a note…"}
              </div>
            )}
            <div className="ann-comment-actions">
              <button type="button" className="ann-del book-hl-copy" title="Copy link to this highlight" onClick={() => onCopyLink(h.id)}>
                <Link size={13} />
              </button>
              <button type="button" className="ann-del" title="Delete highlight" onClick={() => onDelete(h.id)}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function NoteEditor({ initial, onCommit, onDone }: { initial: string; onCommit: (v: string) => void; onDone: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  const finish = () => {
    if (value !== initial) onCommit(value);
    onDone();
  };
  return (
    <textarea
      ref={ref}
      className="ann-comment-input"
      value={value}
      placeholder="A note on this passage… (Markdown, $math$)"
      onChange={(e) => {
        setValue(e.target.value);
        e.target.style.height = "auto";
        e.target.style.height = `${e.target.scrollHeight}px`;
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          setValue(initial);
          onDone();
        } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          finish();
        }
      }}
    />
  );
}
