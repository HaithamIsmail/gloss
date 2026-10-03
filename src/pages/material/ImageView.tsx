import { ChevronLeft, ChevronRight, ImageUp, LoaderCircle, Maximize, Minus, Plus, Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { Material } from "../../../shared/api";
import type { Annotation } from "../../../shared/content";
import { asImagePage, type ImagePageContent } from "../../../shared/pages";
import { api, useTree } from "../../api";
import { RegionComments } from "../../annotate/RegionComments";
import { RegionStage } from "../../annotate/RegionStage";
import { Backlinks } from "../../components/Backlinks";
import { useUI } from "../../store";
import { childrenOf } from "../../tree";
import { isTyping, TitleInput, useContentSaver } from "./shared";

const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3, 4];
const SPLIT_KEY = "study-ws-image-split";

function readSplit() {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY));
    return v > 0.2 && v < 0.85 ? v : 0.58;
  } catch {
    return 0.58;
  }
}

/** A whole page given to one image: the image on the left, its numbered comments on the right. */
export default function ImageView({ material }: { material: Material }) {
  const { data: tree } = useTree();
  const course = tree?.courses.find((c) => c.id === material.courseId);
  const { save } = useContentSaver(material.id);
  const navigate = useNavigate();

  // Pages imported from a deck sit in a folder: previous / next slide.
  const folder = material.parentId ? course?.materials.find((m) => m.id === material.parentId) : undefined;
  // Page Up / Page Down step through the folder's images (its slides).
  const siblings = folder && course ? childrenOf(course, folder.id).filter((m) => m.kind === "image") : [];
  const index = siblings.findIndex((m) => m.id === material.id);
  const prev = index > 0 ? siblings[index - 1] : undefined;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : undefined;
  const slideNav = useRef({ prev, next });
  slideNav.current = { prev, next };

  const [page, setPage] = useState<ImagePageContent>(() => asImagePage(material.content));
  const pageRef = useRef(page);
  const history = useRef<{ past: ImagePageContent[]; future: ImagePageContent[] }>({ past: [], future: [] });
  const [editing, setEditing] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileOver, setFileOver] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [split, setSplit] = useState(readSplit);
  const [aspect, setAspect] = useState<number | null>(null);
  const [pane, setPane] = useState({ w: 0, h: 0 });
  const paneRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const setHovered = useUI((s) => s.setHovered);

  const commit = useCallback(
    (next: ImagePageContent) => {
      history.current.past.push(pageRef.current);
      if (history.current.past.length > 200) history.current.past.shift();
      history.current.future = [];
      pageRef.current = next;
      setPage(next);
      save(next);
    },
    [save],
  );

  const step = useCallback(
    (dir: "undo" | "redo") => {
      const h = history.current;
      const from = dir === "undo" ? h.past : h.future;
      const to = dir === "undo" ? h.future : h.past;
      const target = from.pop();
      if (!target) return;
      to.push(pageRef.current);
      pageRef.current = target;
      setPage(target);
      save(target);
    },
    [save],
  );

  const setAnnotations = (annotations: Annotation[]) => commit({ ...pageRef.current, annotations });
  const current = useCallback(() => pageRef.current.annotations, []);
  const numberOf = (_a: Annotation, i: number) => i + 1;

  const upload = useCallback(
    async (file: File | undefined | null) => {
      if (!file || !file.type.startsWith("image/")) return;
      setUploading(true);
      try {
        const { url } = await api.upload(file);
        commit({ ...pageRef.current, url, name: file.name });
        setZoom(1);
      } catch (err) {
        console.error(err);
        alert("Upload failed. Is the server running?");
      } finally {
        setUploading(false);
      }
    },
    [commit],
  );

  // Natural size of the image, to fit it inside the pane.
  useEffect(() => {
    if (!page.url) return setAspect(null);
    const img = new Image();
    img.onload = () => setAspect(img.naturalWidth / img.naturalHeight || 1);
    img.src = page.url;
  }, [page.url]);

  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPane({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = 48;
  const fitWidth = aspect ? Math.max(120, Math.min(pane.w - pad, (pane.h - pad) * aspect)) : pane.w - pad;
  const stageWidth = Math.round(fitWidth * zoom);

  // Keyboard: undo/redo, zoom, and pasting an image.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || useUI.getState().searchOpen) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        step(e.shiftKey ? "redo" : "undo");
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        step("redo");
      } else if (!mod && (e.key === "+" || e.key === "=")) {
        setZoom((z) => ZOOMS.find((v) => v > z) ?? z);
      } else if (!mod && e.key === "-") {
        setZoom((z) => [...ZOOMS].reverse().find((v) => v < z) ?? z);
      } else if (!mod && e.key === "0") {
        setZoom(1);
      } else if (e.key === "PageDown" || (e.altKey && e.key === "ArrowRight")) {
        const n = slideNav.current.next;
        if (n) {
          e.preventDefault();
          navigate(`/m/${n.id}`);
        }
      } else if (e.key === "PageUp" || (e.altKey && e.key === "ArrowLeft")) {
        const p = slideNav.current.prev;
        if (p) {
          e.preventDefault();
          navigate(`/m/${p.id}`);
        }
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      if (!pageRef.current.url || confirm("Replace the image with the pasted one? Regions are kept.")) void upload(file);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, [step, upload]);

  // Arriving from search: light up the region and open its comment.
  const [params, setParams] = useSearchParams();
  const annParam = params.get("ann");
  useEffect(() => {
    if (!annParam) return;
    const t = window.setTimeout(() => {
      document.querySelector(`.ann-box[data-ann="${CSS.escape(annParam)}"]`)?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      document.querySelector(`[data-comment="${CSS.escape(annParam)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      setHovered(annParam, "search");
      window.setTimeout(() => {
        if (useUI.getState().hoverSource === "search") setHovered(null);
      }, 2400);
      setParams({}, { replace: true });
    }, 200);
    return () => window.clearTimeout(t);
  }, [annParam, setHovered, setParams]);

  const startSplitDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const move = (ev: PointerEvent) => setSplit(Math.min(0.85, Math.max(0.2, (ev.clientX - box.left) / box.width)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      setSplit((v) => {
        try {
          localStorage.setItem(SPLIT_KEY, String(v));
        } catch {
          /* private mode */
        }
        return v;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const fileDrag = {
    onDragOver: (e: ReactDragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setFileOver(true);
    },
    onDragLeave: () => setFileOver(false),
    onDrop: (e: ReactDragEvent) => {
      setFileOver(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      e.preventDefault();
      void upload(file);
    },
  };

  const h = history.current;

  return (
    <div className="image-page" onMouseLeave={() => useUI.getState().hoverSource !== "search" && setHovered(null)}>
      <div className="image-page-head">
        <div className="image-page-title">
          <div className="kicker">
            {folder
              ? [course?.code, folder.title, `${index + 1} of ${siblings.length}`].filter(Boolean).join(" · ")
              : [course?.code, course?.name, "Annotated image"].filter(Boolean).join(" · ")}
          </div>
          <TitleInput material={material} className="input-title image-title-input" />
          <Backlinks materialId={material.id} className="is-inline" />
        </div>
        <div className="image-tools">
          {folder && (
            <>
              <button
                type="button"
                className="icon-btn"
                title="Previous (Page Up)"
                disabled={!prev}
                onClick={() => prev && navigate(`/m/${prev.id}`)}
              >
                <ChevronLeft size={17} />
              </button>
              <span className="slide-pos tabular">
                {index + 1}/{siblings.length}
              </span>
              <button
                type="button"
                className="icon-btn"
                title="Next (Page Down)"
                disabled={!next}
                onClick={() => next && navigate(`/m/${next.id}`)}
              >
                <ChevronRight size={17} />
              </button>
              <span className="tool-sep" />
            </>
          )}
          <button type="button" className="icon-btn" title="Undo (Ctrl+Z)" disabled={!h.past.length} onClick={() => step("undo")}>
            <Undo2 size={16} />
          </button>
          <button type="button" className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!h.future.length} onClick={() => step("redo")}>
            <Redo2 size={16} />
          </button>
          <span className="tool-sep" />
          <button type="button" className="icon-btn" title="Zoom out (−)" onClick={() => setZoom((z) => [...ZOOMS].reverse().find((v) => v < z) ?? z)}>
            <Minus size={16} />
          </button>
          <button type="button" className="zoom-label" title="Fit to pane (0)" onClick={() => setZoom(1)}>
            {zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}
          </button>
          <button type="button" className="icon-btn" title="Zoom in (+)" onClick={() => setZoom((z) => ZOOMS.find((v) => v > z) ?? z)}>
            <Plus size={16} />
          </button>
          <button type="button" className="icon-btn" title="Fit to pane" onClick={() => setZoom(1)}>
            <Maximize size={15} />
          </button>
          <span className="tool-sep" />
          <button type="button" className="block-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <LoaderCircle size={14} className="spin" /> : <ImageUp size={14} strokeWidth={2.2} />}
            <span>{page.url ? "Replace image" : "Upload image"}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="image-split" style={{ gridTemplateColumns: `${split}fr 10px ${1 - split}fr` }}>
        <div ref={paneRef} className={`image-pane${fileOver ? " is-file-over" : ""}${zoom > 1 ? " is-zoomed" : ""}`} {...fileDrag}>
          {page.url ? (
            <div className="image-pane-inner" style={{ width: stageWidth }}>
              <RegionStage
                url={page.url}
                name={page.name}
                annotations={page.annotations}
                current={current}
                onCommit={setAnnotations}
                numberOf={numberOf}
                editing={editing}
                onEdit={setEditing}
              />
            </div>
          ) : (
            <button type="button" className="block-empty image-empty" onClick={() => fileRef.current?.click()}>
              <span>
                {uploading ? (
                  <>
                    <LoaderCircle size={14} className="spin" /> Uploading…
                  </>
                ) : (
                  "Drop an image here, paste one (Ctrl+V), or click to upload"
                )}
              </span>
            </button>
          )}
        </div>
        <div className="split-handle" onPointerDown={startSplitDrag} title="Drag to resize" />
        <RegionComments
          className="ann-comments image-comments"
          annotations={page.annotations}
          numberOf={numberOf}
          editing={editing}
          onEdit={setEditing}
          hasImage={!!page.url}
          onComment={(id, comment) =>
            setAnnotations(pageRef.current.annotations.map((a) => (a.id === id ? { ...a, comment } : a)))
          }
          onDelete={(id) => {
            setAnnotations(pageRef.current.annotations.filter((a) => a.id !== id));
            setEditing(null);
            setHovered(null);
          }}
        />
      </div>
    </div>
  );
}
