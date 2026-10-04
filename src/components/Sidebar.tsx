import { ChevronDown, ChevronRight, Compass, DatabaseBackup, LayoutGrid, PenTool, Plus, Search, Settings, Trash2 } from "lucide-react";
import { useEffect, useRef, type DragEvent } from "react";
import { Link, useMatch, useNavigate } from "react-router";
import type { Course, MaterialSummary } from "../../shared/api";
import { useCreateCourse, useDeleteMaterial, useMoveMaterial, useTree } from "../api";
import { dragOverCourse, dragOverRow, dropClass, endDrag, moveFor, startDrag, useDrag } from "../dnd";
import { scrollToBlock } from "../editor/links";
import { KIND_ICON } from "../kinds";
import { useUI } from "../store";
import { startTour } from "../tour/state";
import { childrenOf, topLevel } from "../tree";
import { APP_NAME, LogoMark } from "./Logo";
import { NewMaterialMenu } from "./NewMaterialMenu";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function Sidebar() {
  const { data: tree } = useTree();
  const navigate = useNavigate();
  const homeMatch = useMatch("/");
  const canvasMatch = useMatch("/canvas/*");
  const trashMatch = useMatch("/trash");
  const backupsMatch = useMatch("/backups");
  const settingsMatch = useMatch("/settings/*");
  const courseMatch = useMatch("/c/:courseId");
  const materialMatch = useMatch("/m/:materialId");
  const activeMaterialId = materialMatch?.params.materialId;
  const activeCourseId =
    courseMatch?.params.courseId ??
    tree?.courses.find((c) => c.materials.some((m) => m.id === activeMaterialId))?.id;

  const createCourse = useCreateCourse();
  const setSearchOpen = useUI((s) => s.setSearchOpen);

  const addCourse = async () => {
    const c = await createCourse.mutateAsync({});
    useUI.getState().setExpanded(c.id, true);
    navigate(`/c/${c.id}`);
  };

  return (
    <aside className="sidebar">
      <Link to="/" className="sidebar-brand" title="All courses">
        <LogoMark size={26} />
        <span className="brand-name">{APP_NAME}</span>
      </Link>

      <div className="sidebar-nav">
        <button type="button" className="side-btn" data-tour="search" onClick={() => setSearchOpen(true)}>
          <Search size={16} />
          <span className="grow">Search</span>
          <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
        <button type="button" className={`side-btn${homeMatch ? " is-active" : ""}`} onClick={() => navigate("/")}>
          <LayoutGrid size={16} />
          <span>All courses</span>
        </button>
        <button
          type="button"
          className={`side-btn${canvasMatch ? " is-active" : ""}`}
          data-tour="canvas"
          onClick={() => navigate("/canvas")}
        >
          <PenTool size={16} />
          <span>Canvas</span>
        </button>
      </div>

      <div className="sidebar-label label-caps">Courses</div>
      <nav className="sidebar-tree" onDragEnd={endDrag}>
        {tree?.courses.map((c) => (
          <CourseNode
            key={c.id}
            course={c}
            active={courseMatch?.params.courseId === c.id}
            containsActive={activeCourseId === c.id}
            activeMaterialId={activeMaterialId}
          />
        ))}
        <button type="button" className="side-btn muted-btn" onClick={addCourse}>
          <Plus size={15} />
          <span>New course</span>
        </button>
      </nav>

      <div className="sidebar-nav sidebar-bottom">
        <button type="button" className={`side-btn${trashMatch ? " is-active" : ""}`} onClick={() => navigate("/trash")}>
          <Trash2 size={16} />
          <span>Trash</span>
        </button>
        <button type="button" className={`side-btn${backupsMatch ? " is-active" : ""}`} onClick={() => navigate("/backups")}>
          <DatabaseBackup size={16} />
          <span>Backups and export</span>
        </button>
        <button
          type="button"
          className={`side-btn${settingsMatch ? " is-active" : ""}`}
          data-tour="settings"
          onClick={() => navigate("/settings/themes")}
        >
          <Settings size={16} />
          <span>Settings</span>
        </button>
        <button type="button" className="side-btn" data-tour="tour" onClick={startTour}>
          <Compass size={16} />
          <span>Guided tour</span>
        </button>
      </div>
    </aside>
  );
}

/** Opens a collapsed course or folder when something is held over it for a moment. */
function useSpringOpen(open: boolean, expand: () => void) {
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return {
    onDragEnter: () => {
      if (open || !useDrag.getState().drag) return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(expand, 650);
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as Element).contains(e.relatedTarget as Node | null)) window.clearTimeout(timer.current);
    },
  };
}

function useDropHandler() {
  const { data: tree } = useTree();
  const move = useMoveMaterial();
  return (e: DragEvent) => {
    const { drag, drop } = useDrag.getState();
    endDrag();
    if (!tree || !drag || !drop) return;
    e.preventDefault();
    e.stopPropagation();
    const m = moveFor(tree, drag, drop);
    if (!m) return;
    move.mutate(m);
    if (m.parentId) useUI.getState().setExpanded(m.parentId, true);
    if (m.courseId) useUI.getState().setExpanded(m.courseId, true);
  };
}

function CourseNode({
  course,
  active,
  containsActive,
  activeMaterialId,
}: {
  course: Course;
  active: boolean;
  containsActive: boolean;
  activeMaterialId?: string;
}) {
  const navigate = useNavigate();
  const expanded = useUI((s) => s.expanded[course.id]);
  const setExpanded = useUI((s) => s.setExpanded);
  const open = expanded ?? containsActive;
  const drop = useDrag((s) => s.drop);
  const onDrop = useDropHandler();
  const spring = useSpringOpen(open, () => setExpanded(course.id, true));

  return (
    <div className="tree-group">
      <div
        className={`tree-row course-row${active ? " is-active" : ""}${dropClass(drop, course.id)}`}
        onClick={() => navigate(`/c/${course.id}`)}
        onDragOver={(e) => dragOverCourse(e, course.id)}
        onDrop={onDrop}
        {...spring}
      >
        <button
          type="button"
          className="tree-toggle"
          aria-label={open ? "Collapse" : "Expand"}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(course.id, !open);
          }}
        >
          {open ? <ChevronDown size={14} strokeWidth={2.4} /> : <ChevronRight size={14} strokeWidth={2.4} />}
        </button>
        <span className="tree-label">{course.name || "Untitled course"}</span>
        <NewMaterialMenu courseId={course.id} className="tree-action" title="Add material">
          <Plus size={14} />
        </NewMaterialMenu>
      </div>

      {open && (
        <>
          {topLevel(course).map((m) =>
            m.kind === "folder" ? (
              <FolderNode key={m.id} course={course} folder={m} activeMaterialId={activeMaterialId} />
            ) : (
              <MaterialNode key={m.id} m={m} active={m.id === activeMaterialId} />
            ),
          )}
          <NewMaterialMenu courseId={course.id} className="tree-row add-row">
            <Plus size={14} />
            <span className="tree-label">Add material</span>
          </NewMaterialMenu>
        </>
      )}
    </div>
  );
}

/** A folder: collapsible, opens by itself when one of its pages is open. Drop pages on it to file them. */
function FolderNode({
  course,
  folder,
  activeMaterialId,
}: {
  course: Course;
  folder: MaterialSummary;
  activeMaterialId?: string;
}) {
  const navigate = useNavigate();
  const expanded = useUI((s) => s.expanded[folder.id]);
  const setExpanded = useUI((s) => s.setExpanded);
  const deleteMaterial = useDeleteMaterial();
  const pages = childrenOf(course, folder.id);
  const containsActive = pages.some((p) => p.id === activeMaterialId);
  const open = expanded ?? containsActive;
  const active = folder.id === activeMaterialId;
  const Icon = KIND_ICON.folder;
  const drop = useDrag((s) => s.drop);
  const dragging = useDrag((s) => s.drag?.id === folder.id);
  const onDrop = useDropHandler();
  const spring = useSpringOpen(open, () => setExpanded(folder.id, true));

  return (
    <>
      <div
        className={`tree-row material-row folder-row${active ? " is-active" : ""}${dragging ? " is-dragging" : ""}${dropClass(drop, folder.id)}`}
        onClick={() => navigate(`/m/${folder.id}`)}
        draggable
        onDragStart={(e) => startDrag(e, folder, e.currentTarget)}
        onDragOver={(e) => dragOverRow(e, folder)}
        onDrop={onDrop}
        {...spring}
      >
        <button
          type="button"
          className="tree-toggle"
          aria-label={open ? "Collapse" : "Expand"}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(folder.id, !open);
          }}
        >
          {open ? <ChevronDown size={13} strokeWidth={2.4} /> : <ChevronRight size={13} strokeWidth={2.4} />}
        </button>
        <Icon size={15} className="tree-icon" />
        <span className="tree-label">{folder.title || "Untitled"}</span>
        <span className="tree-count tabular">{pages.length}</span>
        <NewMaterialMenu courseId={course.id} parentId={folder.id} className="tree-action" title="Add to folder">
          <Plus size={13} />
        </NewMaterialMenu>
        <button
          type="button"
          className="tree-action"
          title="Move folder to trash"
          onClick={(e) => {
            e.stopPropagation();
            deleteMaterial.mutate(folder.id);
            if (active || containsActive) navigate(`/c/${course.id}`);
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
      {open && pages.map((p) => <MaterialNode key={p.id} m={p} active={p.id === activeMaterialId} nested />)}
      {open && !pages.length && <div className="tree-row tree-empty is-nested">Empty folder</div>}
    </>
  );
}

function MaterialNode({ m, active, nested }: { m: MaterialSummary; active: boolean; nested?: boolean }) {
  const Icon = KIND_ICON[m.kind];
  const navigate = useNavigate();
  const live = useUI((s) => (s.doc.materialId === m.id ? s.doc.outline : null));
  const numbering = useUI((s) => s.prefs.numbering);
  const deleteMaterial = useDeleteMaterial();
  const drop = useDrag((s) => s.drop);
  const dragging = useDrag((s) => s.drag?.id === m.id);
  const onDrop = useDropHandler();
  const outline = live ?? m.outline;

  return (
    <>
      <div
        className={`tree-row material-row${nested ? " is-nested" : ""}${active ? " is-active" : ""}${dragging ? " is-dragging" : ""}${dropClass(drop, m.id)}`}
        onClick={() => navigate(`/m/${m.id}`)}
        draggable
        onDragStart={(e) => startDrag(e, m, e.currentTarget)}
        onDragOver={(e) => dragOverRow(e, m)}
        onDrop={onDrop}
      >
        <Icon size={15} className="tree-icon" />
        <span className="tree-label">{m.title || "Untitled"}</span>
        <button
          type="button"
          className="tree-action"
          title="Move to trash"
          onClick={(e) => {
            e.stopPropagation();
            deleteMaterial.mutate(m.id);
            if (active) navigate(m.parentId ? `/m/${m.parentId}` : `/c/${m.courseId}`);
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
      {active &&
        outline.map((o) => (
          <div
            key={o.id}
            className={`tree-row outline-row level-${o.level}`}
            onClick={() => scrollToBlock(o.id, { flash: true })}
          >
            {numbering && <span className="tree-num tabular">{o.num}</span>}
            <span className="tree-label">{o.text || "Untitled"}</span>
          </div>
        ))}
    </>
  );
}
