import { FilePlus2, Trash2, X } from "lucide-react";
import { nanoid } from "nanoid";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { Drawing } from "../../shared/api";
import { DRAWING } from "../../shared/content";
import {
  announceTrashed,
  api,
  forgetDrawing,
  keys,
  patchTreeMaterial,
  queryClient,
  rememberDrawing,
  useDrawing,
  useTree,
} from "../api";
import type { DrawingCanvasHandle } from "../drawing/DrawingCanvas";
import { CanvasLoading } from "../drawing/DrawingModal";
import { registerFlusher } from "../flush";
import { useUI } from "../store";

const DrawingCanvas = lazy(() => import("../drawing/DrawingCanvas"));

const SAVE_DELAY = 1000;

export function CanvasPage() {
  const { drawingId } = useParams();
  const { data: drawing, isLoading, error } = useDrawing(drawingId);

  useEffect(() => () => useUI.getState().setSave("idle"), [drawingId]);

  if (isLoading) return <CanvasLoading />;
  if (error || !drawing) {
    return (
      <div className="page page-narrow">
        <div className="kicker">Not found</div>
        <h1 className="page-title">This drawing no longer exists</h1>
        <p className="muted">
          <Link to="/canvas">Back to the Canvas</Link>
        </p>
      </div>
    );
  }
  return <CanvasEditor key={drawing.id} drawing={drawing} />;
}

function CanvasEditor({ drawing }: { drawing: Drawing }) {
  const navigate = useNavigate();
  const { data: tree } = useTree();
  const setSave = useUI((s) => s.setSave);
  const [title, setTitle] = useState(drawing.title);
  const [courseId, setCourseId] = useState(drawing.courseId);
  const [picking, setPicking] = useState(false);

  // Kept outside the canvas so a pending save can still run after it unmounts.
  const handle = useRef<DrawingCanvasHandle>(null);
  const lastHandle = useRef<DrawingCanvasHandle | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<{ scene: boolean; title?: string; courseId?: string | null }>({ scene: false });

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    if (!p.scene && p.title === undefined && p.courseId === undefined) return;
    pending.current = { scene: false };
    setSave("saving");
    try {
      const snap = p.scene && lastHandle.current ? await lastHandle.current.snapshot() : null;
      const saved = await api.updateDrawing(drawing.id, {
        title: p.title,
        courseId: p.courseId,
        ...(snap ? { scene: snap.scene, preview: snap.preview } : {}),
      });
      rememberDrawing(saved, snap?.scene);
      setSave("saved");
    } catch (err) {
      console.error(err);
      pending.current = { ...p, ...pending.current, scene: p.scene || pending.current.scene };
      setSave("error");
    }
  }, [drawing.id, setSave]);

  const schedule = (patch: { scene?: boolean; title?: string; courseId?: string | null }) => {
    pending.current = { ...pending.current, ...patch, scene: pending.current.scene || !!patch.scene };
    setSave("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY);
  };

  useEffect(() => {
    // The scene is exported asynchronously, so a closing tab can't wait for it:
    // start saving and let the browser ask before leaving with unsaved strokes.
    const onUnload = (e: BeforeUnloadEvent) => {
      const p = pending.current;
      if (!p.scene && p.title === undefined && p.courseId === undefined) return;
      void flush();
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    const unregister = registerFlusher(flush);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      unregister();
      void flush();
    };
  }, [flush]);

  const remove = async () => {
    await flush();
    pending.current = { scene: false };
    window.clearTimeout(timer.current);
    const res = await api.deleteDrawing(drawing.id);
    forgetDrawing(drawing.id);
    announceTrashed(title || "Untitled drawing", res);
    navigate("/canvas");
  };

  return (
    <div className="canvas-page">
      <div className="drawing-bar">
        <span className="kicker">Drawing</span>
        <input
          className="drawing-title-input"
          value={title}
          placeholder="Untitled drawing"
          onChange={(e) => {
            setTitle(e.target.value);
            schedule({ title: e.target.value });
          }}
        />
        <select
          className="drawing-course-select"
          value={courseId ?? ""}
          title="Course"
          onChange={(e) => {
            const v = e.target.value || null;
            setCourseId(v);
            schedule({ courseId: v });
          }}
        >
          <option value="">No course</option>
          {tree?.courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || "Untitled course"}
            </option>
          ))}
        </select>
        <button type="button" className="btn-primary" onClick={() => setPicking(true)}>
          <FilePlus2 size={15} strokeWidth={2.2} />
          <span>Add to page</span>
        </button>
        <button type="button" className="icon-btn danger" title="Delete drawing" onClick={remove}>
          <Trash2 size={15} />
        </button>
      </div>
      <div className="drawing-body">
        <Suspense fallback={<CanvasLoading />}>
          <DrawingCanvas
            scene={drawing.scene}
            name={title}
            handleRef={handle}
            onEdit={() => {
              lastHandle.current = handle.current;
              schedule({ scene: true });
            }}
          />
        </Suspense>
      </div>
      {picking && (
        <AddToPageDialog
          drawingId={drawing.id}
          preferCourseId={courseId}
          beforeAdd={flush}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

/** Picks a material and appends this drawing to the end of it. */
function AddToPageDialog({
  drawingId,
  preferCourseId,
  beforeAdd,
  onClose,
}: {
  drawingId: string;
  preferCourseId: string | null;
  beforeAdd: () => Promise<void>;
  onClose: () => void;
}) {
  const { data: tree } = useTree();
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<{ id: string; title: string } | null>(null);
  const courses = [...(tree?.courses ?? [])].sort(
    (a, b) => Number(b.id === preferCourseId) - Number(a.id === preferCourseId),
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const add = async (materialId: string, title: string) => {
    setBusy(materialId);
    try {
      await beforeAdd();
      const summary = await api.appendToMaterial(materialId, [
        { id: nanoid(10), type: DRAWING, props: { drawingId }, children: [] },
      ]);
      // The cached copy of that page is now out of date.
      queryClient.removeQueries({ queryKey: keys.material(materialId) });
      patchTreeMaterial(summary);
      setAdded({ id: materialId, title });
    } catch (err) {
      console.error(err);
      alert("Could not add the drawing to that page.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="search-backdrop" onMouseDown={onClose}>
      <div className="search-panel picker" role="dialog" aria-label="Add to page" onMouseDown={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="section-head-title">{added ? "Added" : "Add to page"}</span>
          <button type="button" className="icon-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
        {added ? (
          <div className="picker-done">
            <p>
              The drawing is now at the end of <strong>{added.title}</strong>. Edits you make here show up there too.
            </p>
            <Link className="btn-primary" to={`/m/${added.id}`} onClick={onClose}>
              Open page
            </Link>
          </div>
        ) : (
          <div className="search-results">
            {courses.map((c) => (
              <div key={c.id}>
                <div className="picker-course">{c.name || "Untitled course"}</div>
                {c.materials.filter((m) => m.kind === "doc").map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    className="picker-item"
                    disabled={!!busy}
                    onClick={() => void add(m.id, m.title || "Untitled")}
                  >
                    {busy === m.id ? "Adding…" : m.title || "Untitled"}
                  </button>
                ))}
                {!c.materials.some((m) => m.kind === "doc") && <div className="picker-empty">No pages</div>}
              </div>
            ))}
            {!courses.length && <div className="search-empty">Create a course and a material first.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
