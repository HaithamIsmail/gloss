import { Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { useCreateCourse, useTree } from "../api";
import { useUI } from "../store";
import { topLevel } from "../tree";

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function HomePage() {
  const { data: tree, isLoading } = useTree();
  const navigate = useNavigate();
  const createCourse = useCreateCourse();
  const courses = tree?.courses ?? [];
  const materialCount = courses.reduce((n, c) => n + topLevel(c).length, 0);

  const addCourse = async () => {
    const c = await createCourse.mutateAsync({});
    useUI.getState().setExpanded(c.id, true);
    navigate(`/c/${c.id}`);
  };

  return (
    <div className="page page-wide">
      <div className="kicker">Workspace</div>
      <h1 className="page-title">Courses</h1>
      <p className="muted">{isLoading ? "Loading…" : `${plural(courses.length, "course")} · ${plural(materialCount, "material")}`}</p>

      <div className="course-grid">
        {courses.map((c, i) => {
          const sections = c.materials.reduce((n, m) => n + m.outline.filter((o) => o.level === 1).length, 0);
          const regions = c.materials.reduce((n, m) => n + m.regions, 0);
          return (
            <button
              type="button"
              key={c.id}
              className="course-card"
              style={{ animationDelay: `${i * 40}ms` }}
              onClick={() => navigate(`/c/${c.id}`)}
            >
              <span className="kicker">{c.code || "No code"}</span>
              <span className="course-card-name">{c.name || "Untitled course"}</span>
              <span className="course-card-meta">
                {plural(topLevel(c).length, "material")} · {plural(sections, "section")}
                {regions > 0 && ` · ${plural(regions, "region")}`}
              </span>
            </button>
          );
        })}
        <button type="button" className="course-card is-new" onClick={addCourse}>
          <Plus size={22} />
          <span className="course-card-new">New course</span>
        </button>
      </div>
    </div>
  );
}
