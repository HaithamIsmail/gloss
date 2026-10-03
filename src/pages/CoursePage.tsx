import { FileDown, FolderInput, GripVertical, Plus, Presentation, Printer, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { Course } from "../../shared/api";
import {
  api,
  patchTreeCourse,
  useDeleteCourse,
  useDeleteMaterial,
  useMoveMaterial,
  useTree,
} from "../api";
import { NewMaterialMenu } from "../components/NewMaterialMenu";
import { dragOverRow, dropClass, endDrag, moveFor, startDrag, useDrag } from "../dnd";
import { download } from "../format";
import { KIND_ICON, KIND_LABEL } from "../kinds";
import { startSlideImport } from "../slides/SlideImport";
import { useUI } from "../store";
import { childrenOf, topLevel } from "../tree";
import { plural } from "./HomePage";

export function CoursePage() {
  const { courseId } = useParams();
  const { data: tree, isLoading } = useTree();
  const course = tree?.courses.find((c) => c.id === courseId);

  if (isLoading) return <div className="page page-narrow muted">Loading…</div>;
  if (!course) {
    return (
      <div className="page page-narrow">
        <div className="kicker">Not found</div>
        <h1 className="page-title">This course no longer exists</h1>
      </div>
    );
  }
  return <CourseView key={course.id} course={course} />;
}

/** Saves after a short pause; a pending save still goes out if the page unmounts. */
function useDebouncedSave(save: (v: string) => void, ms = 400) {
  const t = useRef<number | undefined>(undefined);
  const pending = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      window.clearTimeout(t.current);
      pending.current?.();
    },
    [],
  );
  return (v: string) => {
    window.clearTimeout(t.current);
    pending.current = () => {
      pending.current = null;
      save(v);
    };
    t.current = window.setTimeout(() => pending.current?.(), ms);
  };
}

function CourseView({ course }: { course: Course }) {
  const items = topLevel(course);
  const folderRegions = (id: string) => childrenOf(course, id).reduce((n, p) => n + p.regions, 0);
  const navigate = useNavigate();
  const [name, setName] = useState(course.name);
  const [code, setCode] = useState(course.code);
  const { data: tree } = useTree();
  const deleteMaterial = useDeleteMaterial();
  const deleteCourse = useDeleteCourse();
  const moveMaterial = useMoveMaterial();
  const drag = useDrag((s) => s.drag);
  const drop = useDrag((s) => s.drop);
  const nameRef = useRef<HTMLInputElement>(null);

  // A fresh course: put the cursor in its name, ready to type over it.
  useEffect(() => {
    if (course.name === "Untitled course") nameRef.current?.select();
  }, []);

  const saveName = useDebouncedSave((v) => void api.updateCourse(course.id, { name: v }));
  const saveCode = useDebouncedSave((v) => void api.updateCourse(course.id, { code: v }));

  const onDrop = (e: React.DragEvent) => {
    const { drag, drop } = useDrag.getState();
    endDrag();
    if (!tree || !drag || !drop) return;
    e.preventDefault();
    const m = moveFor(tree, drag, drop);
    if (m) moveMaterial.mutate(m);
  };

  return (
    <div className="page page-narrow">
      <input
        className="input-kicker"
        value={code}
        placeholder="COURSE CODE"
        onChange={(e) => {
          setCode(e.target.value);
          patchTreeCourse(course.id, { code: e.target.value });
          saveCode(e.target.value);
        }}
      />
      <input
        ref={nameRef}
        className="input-title"
        value={name}
        placeholder="Untitled course"
        onChange={(e) => {
          setName(e.target.value);
          patchTreeCourse(course.id, { name: e.target.value });
          saveName(e.target.value);
        }}
      />

      <div className="section-head">
        <span className="section-head-title">Materials</span>
        <span className="section-head-actions">
          <button type="button" className="btn-secondary" onClick={() => void startSlideImport(course.id, navigate)}>
            <Presentation size={15} />
            <span>Import slides or PDF</span>
          </button>
          <NewMaterialMenu courseId={course.id} className="btn-primary">
            <Plus size={15} strokeWidth={2.4} />
            <span>New material</span>
          </NewMaterialMenu>
        </span>
      </div>

      <div className="material-list" onDragEnd={endDrag}>
        {items.map((m, i) => {
          const sections = m.outline.filter((o) => o.level === 1).length;
          const KindIcon = KIND_ICON[m.kind];
          return (
            <div
              key={m.id}
              className={`material-item${drag?.id === m.id ? " is-dragging" : ""}${dropClass(drop, m.id)}`}
              onClick={() => navigate(`/m/${m.id}`)}
              onDragOver={(e) => dragOverRow(e, m)}
              onDrop={onDrop}
            >
              <span
                className="material-grip"
                draggable
                onClick={(e) => e.stopPropagation()}
                onDragStart={(e) => startDrag(e, m, e.currentTarget.closest(".material-item"))}
                title={m.kind === "folder" ? "Drag to reorder" : "Drag to reorder, or onto a folder"}
              >
                <GripVertical size={16} />
              </span>
              <span className="material-num tabular">{String(i + 1).padStart(2, "0")}</span>
              <span className="material-title">{m.title || "Untitled"}</span>
              <span className="material-meta">
                <span className="material-kind" title={KIND_LABEL[m.kind]}>
                  <KindIcon size={14} />
                  {m.kind !== "doc" && KIND_LABEL[m.kind]}
                </span>
                {m.kind === "folder"
                  ? [plural(childrenOf(course, m.id).length, "item"), folderRegions(m.id) > 0 && plural(folderRegions(m.id), "region")]
                      .filter(Boolean)
                      .join(" · ")
                  : m.kind === "image"
                  ? plural(m.regions, "region")
                  : [plural(sections, "section"), m.regions > 0 && plural(m.regions, "region")].filter(Boolean).join(" · ")}
              </span>
              <span className="material-actions">
                <button
                  type="button"
                  className="icon-btn"
                  title="Move to…"
                  onClick={(e) => {
                    e.stopPropagation();
                    useUI.getState().setMoving(m.id);
                  }}
                >
                  <FolderInput size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn danger"
                  title="Move to trash"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteMaterial.mutate(m.id);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </span>
            </div>
          );
        })}
      </div>
      {!items.length && (
        <p className="muted empty-note">No materials yet. Add lecture notes, a chapter or a lab handout.</p>
      )}

      <div className="course-foot">
        <button type="button" className="btn-secondary small" onClick={() => download(`/api/export/course/${course.id}`)}>
          <FileDown size={14} />
          <span>Export as Markdown</span>
        </button>
        <button
          type="button"
          className="btn-secondary small"
          onClick={() => window.open(`/print/c/${course.id}?auto=1`, "_blank")}
        >
          <Printer size={14} />
          <span>Print or save as PDF</span>
        </button>
        <span className="grow" />
        <button
          type="button"
          className="btn-secondary small danger"
          onClick={async () => {
            await deleteCourse.mutateAsync(course.id);
            navigate("/");
          }}
        >
          <Trash2 size={14} />
          <span>Move course to trash</span>
        </button>
      </div>
    </div>
  );
}
