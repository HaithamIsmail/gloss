import { Check, FileDown, FolderInput, History, MoreHorizontal, PanelLeft, Printer, SlidersHorizontal, Trash2 } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { useMatch, useNavigate } from "react-router";
import type { MaterialSummary } from "../../shared/api";
import { useDeleteMaterial, useDrawings, useTree } from "../api";
import { flushAll } from "../flush";
import { FolderNav } from "./FolderNav";
import { download } from "../format";
import { useUI, type Prefs } from "../store";
import { APP_NAME } from "./Logo";

export function TopBar() {
  const navigate = useNavigate();
  const { data: tree } = useTree();
  const courseMatch = useMatch("/c/:courseId");
  const materialMatch = useMatch("/m/:materialId");
  const canvasMatch = useMatch("/canvas/*");
  const drawingMatch = useMatch("/canvas/:drawingId");
  const trashMatch = useMatch("/trash");
  const backupsMatch = useMatch("/backups");
  const settingsMatch = useMatch("/settings/*");
  const { data: drawings } = useDrawings();
  const save = useUI((s) => s.save);
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const setSidebarOpen = useUI((s) => s.setSidebarOpen);

  const materialId = materialMatch?.params.materialId;
  const course = tree?.courses.find(
    (c) => c.id === courseMatch?.params.courseId || c.materials.some((m) => m.id === materialId),
  );
  const material = course?.materials.find((m) => m.id === materialId);

  const crumbs: { label: string; onClick: () => void; current: boolean }[] = [
    { label: "Courses", onClick: () => navigate("/"), current: !course },
  ];
  if (canvasMatch) {
    crumbs[0].current = false;
    crumbs.push({ label: "Canvas", onClick: () => navigate("/canvas"), current: !drawingMatch });
    const d = drawings?.find((x) => x.id === drawingMatch?.params.drawingId);
    if (drawingMatch) crumbs.push({ label: d?.title || "Untitled drawing", onClick: () => {}, current: true });
  }
  if (trashMatch || backupsMatch || settingsMatch) {
    crumbs[0].current = false;
    const label = trashMatch ? "Trash" : backupsMatch ? "Backups and export" : "Settings";
    crumbs.push({ label, onClick: () => {}, current: true });
  }
  if (course) {
    crumbs.push({ label: course.name || "Untitled course", onClick: () => navigate(`/c/${course.id}`), current: !material });
  }
  const folder = material?.parentId ? course?.materials.find((m) => m.id === material.parentId) : undefined;
  if (folder) crumbs.push({ label: folder.title || "Untitled", onClick: () => navigate(`/m/${folder.id}`), current: false });
  if (material) {
    crumbs.push({
      label: material.title || "Untitled",
      onClick: () => document.getElementById("main-scroll")?.scrollTo({ top: 0, behavior: "smooth" }),
      current: true,
    });
  }

  // Tab title: where you are, then the app ("3. Heart sounds · Gloss").
  const here = crumbs.length > 1 ? crumbs[crumbs.length - 1].label : "";
  useEffect(() => {
    document.title = here ? `${here} · ${APP_NAME}` : APP_NAME;
  }, [here]);

  return (
    <header className="topbar">
      <button
        type="button"
        className={`icon-btn${sidebarOpen ? "" : " is-on"}`}
        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        <PanelLeft size={16} />
      </button>
      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="crumb-sep">/</span>}
            <button type="button" className={`crumb${c.current ? " is-current" : ""}`} onClick={c.onClick}>
              {c.label}
            </button>
          </Fragment>
        ))}
      </nav>
      <div className="topbar-right">
        {material?.parentId && <FolderNav material={material} />}
        {(materialId || drawingMatch) && <SaveStatus state={save} />}
        {materialId && <ViewMenu />}
        {material && <PageMenu material={material} />}
      </div>
    </header>
  );
}

/** The open material's actions: history, move, export, trash. */
function PageMenu({ material }: { material: MaterialSummary }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const deleteMaterial = useDeleteMaterial();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const act = (fn: () => void | Promise<void>) => () => {
    setOpen(false);
    void fn();
  };
  const isFolder = material.kind === "folder";

  return (
    <div className="view-menu" ref={ref}>
      <button
        type="button"
        className={`icon-btn${open ? " is-on" : ""}`}
        title="More actions"
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="menu-pop page-menu">
          {!isFolder && (
            <button type="button" className="menu-item" onClick={act(() => useUI.getState().setHistoryFor(material.id))}>
              <History size={15} /> Version history
            </button>
          )}
          <button type="button" className="menu-item" onClick={act(() => useUI.getState().setMoving(material.id))}>
            <FolderInput size={15} /> Move to…
          </button>
          <div className="menu-sep" />
          <button
            type="button"
            className="menu-item"
            onClick={act(async () => {
              await flushAll();
              download(`/api/export/material/${material.id}`);
            })}
          >
            <FileDown size={15} /> Export as Markdown
          </button>
          <button
            type="button"
            className="menu-item"
            onClick={act(async () => {
              await flushAll();
              window.open(`/print/m/${material.id}?auto=1`, "_blank");
            })}
          >
            <Printer size={15} /> Print or save as PDF
          </button>
          <div className="menu-sep" />
          <button
            type="button"
            className="menu-item danger"
            onClick={act(async () => {
              await flushAll();
              deleteMaterial.mutate(material.id);
              navigate(material.parentId ? `/m/${material.parentId}` : `/c/${material.courseId}`);
            })}
          >
            <Trash2 size={15} /> Move to trash
          </button>
        </div>
      )}
    </div>
  );
}

function SaveStatus({ state }: { state: ReturnType<typeof useUI.getState>["save"] }) {
  if (state === "idle") return null;
  const text = { saving: "Saving…", saved: "Saved", error: "Not saved — retrying on next edit" }[state];
  return <span className={`save-status is-${state}`}>{text}</span>;
}

function ViewMenu() {
  const [open, setOpen] = useState(false);
  const prefs = useUI((s) => s.prefs);
  const setPref = useUI((s) => s.setPref);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const Toggle = ({ k, label }: { k: "numbering" | "showIndex"; label: string }) => (
    <button type="button" className="menu-item" onClick={() => setPref(k, !prefs[k])}>
      <span className={`check${prefs[k] ? " is-on" : ""}`}>{prefs[k] && <Check size={12} strokeWidth={3.5} />}</span>
      {label}
    </button>
  );

  const Highlight = ({ value, label }: { value: Prefs["highlight"]; label: string }) => (
    <button type="button" className="menu-item" onClick={() => setPref("highlight", value)}>
      <span className={`radio${prefs.highlight === value ? " is-on" : ""}`} />
      {label}
    </button>
  );

  return (
    <div className="view-menu" ref={ref}>
      <button
        type="button"
        className={`icon-btn${open ? " is-on" : ""}`}
        title="Page view options"
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal size={16} />
      </button>
      {open && (
        <div className="menu-pop">
          <div className="menu-label">Page</div>
          <Toggle k="numbering" label="Number sections" />
          <Toggle k="showIndex" label="Show index" />
          <div className="menu-label">Linked passages</div>
          <Highlight value="marker" label="Marker" />
          <Highlight value="underline" label="Underline only" />
        </div>
      )}
    </div>
  );
}
