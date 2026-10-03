import { Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { api, rememberDrawing, useDrawings, useTree } from "../api";
import { plural } from "./HomePage";

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

export function CanvasListPage() {
  const navigate = useNavigate();
  const { data: drawings, isLoading } = useDrawings();
  const { data: tree } = useTree();
  const courseName = (id: string | null) => tree?.courses.find((c) => c.id === id)?.name;

  const create = async () => {
    const d = await api.createDrawing({});
    rememberDrawing(d, { elements: [] });
    navigate(`/canvas/${d.id}`);
  };

  return (
    <div className="page page-wide">
      <div className="kicker">Workspace</div>
      <h1 className="page-title">Canvas</h1>
      <p className="muted">
        {isLoading
          ? "Loading…"
          : `${plural(drawings?.length ?? 0, "drawing")} · sketches, diagrams and mind maps. Add any of them to a page.`}
      </p>

      <div className="course-grid drawing-grid">
        <button type="button" className="course-card is-new" onClick={create}>
          <Plus size={22} />
          <span className="course-card-new">New drawing</span>
        </button>
        {drawings?.map((d, i) => (
          <button
            type="button"
            key={d.id}
            className="course-card drawing-card"
            style={{ animationDelay: `${i * 30}ms` }}
            onClick={() => navigate(`/canvas/${d.id}`)}
          >
            <span className="drawing-thumb">
              {d.hasPreview ? (
                <img src={`/api/drawings/${d.id}/preview.svg?v=${d.updatedAt}`} alt="" loading="lazy" />
              ) : (
                <span className="drawing-thumb-empty">Empty</span>
              )}
            </span>
            <span className="kicker">{courseName(d.courseId) ?? "No course"}</span>
            <span className="drawing-card-title">{d.title || "Untitled drawing"}</span>
            <span className="course-card-meta">Edited {dateFmt.format(d.updatedAt)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
