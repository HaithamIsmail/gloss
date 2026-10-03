import { BookOpen, Folder, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useMoveMaterial, useTree } from "../api";
import { useUI } from "../store";
import { toast } from "../toast";
import { findMaterial, topLevel } from "../tree";

export function MoveHost() {
  const id = useUI((s) => s.moving);
  if (!id) return null;
  return <MoveDialog key={id} materialId={id} onClose={() => useUI.getState().setMoving(null)} />;
}

/** Pick a course (or a folder in it) to move a material to. */
function MoveDialog({ materialId, onClose }: { materialId: string; onClose: () => void }) {
  const { data: tree } = useTree();
  const { material } = findMaterial(tree, materialId);
  const move = useMoveMaterial();
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!tree || !material) return null;
  const isFolder = material.kind === "folder";
  const match = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase());

  const go = (courseId: string, parentId: string | null, label: string) => {
    onClose();
    // The dialog is gone by the time this settles, so wait on the promise (errors toast in the hook).
    move
      .mutateAsync({ id: material.id, courseId, parentId })
      .then(() => toast(`Moved “${material.title || "Untitled"}” to ${label}`))
      .catch(() => undefined);
    if (parentId) useUI.getState().setExpanded(parentId, true);
    useUI.getState().setExpanded(courseId, true);
  };

  return (
    <div className="search-backdrop" onMouseDown={onClose}>
      <div className="search-panel move-panel" role="dialog" aria-label="Move to" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <input
            autoFocus
            value={q}
            placeholder={`Move “${material.title || "Untitled"}” to…`}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="search-results move-list">
          {tree.courses.map((c) => {
            const folders = isFolder ? [] : topLevel(c).filter((m) => m.kind === "folder" && match(m.title));
            const courseHit = match(c.name) || match(c.code);
            if (!courseHit && !folders.length) return null;
            const here = c.id === material.courseId && !material.parentId;
            return (
              <div key={c.id} className="move-group">
                <button
                  type="button"
                  className="move-option"
                  disabled={here}
                  onClick={() => go(c.id, null, c.name || "Untitled course")}
                >
                  <BookOpen size={16} />
                  <span className="grow">{c.name || "Untitled course"}</span>
                  {here && <small className="muted">Current place</small>}
                </button>
                {folders.map((f) => {
                  const inside = f.id === material.parentId;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      className="move-option is-nested"
                      disabled={inside}
                      onClick={() => go(c.id, f.id, f.title || "Untitled")}
                    >
                      <Folder size={15} />
                      <span className="grow">{f.title || "Untitled"}</span>
                      {inside && <small className="muted">Current place</small>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        {isFolder && <p className="move-note muted">A folder moves with all its pages. Folders can't go inside other folders.</p>}
      </div>
    </div>
  );
}
