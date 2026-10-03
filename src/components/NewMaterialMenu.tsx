import { Presentation, Upload } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import type { MaterialKind } from "../../shared/pages";
import { useCreateMaterial } from "../api";
import { KIND_ICON, KIND_LABEL } from "../kinds";
import { pickIpynbFile, readIpynb } from "../notebook/ipynb";
import { startSlideImport } from "../slides/SlideImport";
import { useUI } from "../store";

export { KIND_ICON, KIND_LABEL };

const OPTIONS: { kind: MaterialKind; hint: string }[] = [
  { kind: "doc", hint: "Sections, text, images and drawings" },
  { kind: "image", hint: "One image, with numbered regions and comments" },
  { kind: "notebook", hint: "Python code and markdown cells, like Jupyter" },
  { kind: "folder", hint: "Group pages, images and notebooks together" },
];

/** A button that opens a small menu to create a material of any kind. */
export function NewMaterialMenu({
  courseId,
  parentId = null,
  className,
  title,
  children,
}: {
  courseId: string;
  /** Create inside this folder. */
  parentId?: string | null;
  className: string;
  title?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const create = useCreateMaterial();

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const width = 300;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: r.bottom + 6 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const make = async (input: { kind: MaterialKind; title?: string; content?: unknown }) => {
    setOpen(false);
    const m = await create.mutateAsync({ courseId, parentId, ...input });
    useUI.getState().setExpanded(courseId, true);
    if (parentId) useUI.getState().setExpanded(parentId, true);
    navigate(`/m/${m.id}`);
  };

  const importNotebook = async () => {
    setOpen(false);
    const file = await pickIpynbFile();
    if (!file) return;
    try {
      const content = await readIpynb(file);
      await make({ kind: "notebook", title: file.name.replace(/\.ipynb$/i, ""), content });
    } catch (err) {
      alert((err as Error).message || "Could not read that notebook.");
    }
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={className}
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div ref={pop} className="new-menu" style={{ left: pos.left, top: pos.top }} onClick={(e) => e.stopPropagation()}>
            {OPTIONS.filter((o) => !(parentId && o.kind === "folder")).map(({ kind, hint }) => {
              const Icon = KIND_ICON[kind];
              return (
                <button key={kind} type="button" className="new-menu-item" onClick={() => void make({ kind })}>
                  <Icon size={18} />
                  <span>
                    <strong>{KIND_LABEL[kind]}</strong>
                    <small>{hint}</small>
                  </span>
                </button>
              );
            })}
            <div className="new-menu-sep" />
            {!parentId && (
              <button
                type="button"
                className="new-menu-item"
                onClick={() => {
                  setOpen(false);
                  void startSlideImport(courseId, navigate);
                }}
              >
                <Presentation size={18} />
                <span>
                  <strong>Import slides or PDF</strong>
                  <small>A folder with one annotated page per slide (.pptx, .pdf)</small>
                </span>
              </button>
            )}
            <button type="button" className="new-menu-item" onClick={() => void importNotebook()}>
              <Upload size={18} />
              <span>
                <strong>Import notebook</strong>
                <small>Open a .ipynb file as a new notebook</small>
              </span>
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
