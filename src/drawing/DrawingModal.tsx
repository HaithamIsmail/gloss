import { LoaderCircle } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, rememberDrawing, useDrawing } from "../api";
import { useUI, type DrawingSession } from "../store";
import type { DrawingCanvasHandle } from "./DrawingCanvas";

const DrawingCanvas = lazy(() => import("./DrawingCanvas"));

export function CanvasLoading() {
  return (
    <div className="drawing-loading">
      <LoaderCircle size={16} className="spin" /> Loading canvas…
    </div>
  );
}

/** Mounted once at the app root; shows the drawing editor when a page asks for it. */
export function DrawingModalHost() {
  const session = useUI((s) => s.drawingSession);
  if (!session) return null;
  return createPortal(<DrawingModal session={session} />, document.body);
}

function DrawingModal({ session }: { session: DrawingSession }) {
  const isNew = session.drawingId === null;
  const { data: drawing, isLoading, error } = useDrawing(session.drawingId);
  const [title, setTitle] = useState("Untitled drawing");
  const [shapes, setShapes] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const handle = useRef<DrawingCanvasHandle>(null);
  const close = useUI((s) => s.closeDrawing);

  useEffect(() => {
    if (drawing) setTitle(drawing.title);
  }, [drawing]);

  const canSubmit = !saving && (isNew ? shapes > 0 : dirty) && !!handle.current;

  const cancel = () => {
    if (dirty && !confirm("Discard your changes to this drawing?")) return;
    session.onCancel?.();
    close();
  };

  const submit = async () => {
    if (!handle.current) return;
    setSaving(true);
    try {
      const { scene, preview } = await handle.current.snapshot();
      const saved = isNew
        ? await api.createDrawing({ title, scene, preview, courseId: session.courseId })
        : await api.updateDrawing(session.drawingId!, { title, scene, preview });
      rememberDrawing(saved, scene);
      session.onSaved(saved);
      close();
    } catch (err) {
      console.error(err);
      alert("Could not save the drawing. Is the server running?");
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canSubmit) {
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <div className="drawing-modal" role="dialog" aria-label="Drawing">
      <div className="drawing-bar">
        <span className="kicker">{isNew ? "New drawing" : "Edit drawing"}</span>
        <input
          className="drawing-title-input"
          value={title}
          placeholder="Untitled drawing"
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
        />
        <span className="drawing-bar-hint">{isNew ? "Ctrl+Enter to insert" : "Ctrl+Enter to save"}</span>
        <button type="button" className="btn-secondary" onClick={cancel}>
          Cancel
        </button>
        <button type="button" className="btn-primary" disabled={!canSubmit} onClick={() => void submit()}>
          {saving ? "Saving…" : session.submitLabel}
        </button>
      </div>
      <div className="drawing-body">
        {error ? (
          <div className="drawing-loading">This drawing could not be loaded. It may have been deleted.</div>
        ) : !isNew && isLoading ? (
          <CanvasLoading />
        ) : (
          <Suspense fallback={<CanvasLoading />}>
            <DrawingCanvas
              scene={drawing?.scene ?? null}
              name={title}
              handleRef={handle}
              onEdit={(n) => {
                setShapes(n);
                setDirty(true);
              }}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
