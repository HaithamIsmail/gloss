import { Download, FileText, Plus } from "lucide-react";
import { useNavigate } from "react-router";
import type { Material, MaterialSummary } from "../../../shared/api";
import { asFolder } from "../../../shared/pages";
import { useMoveMaterial, useTree } from "../../api";
import { Backlinks } from "../../components/Backlinks";
import { NewMaterialMenu } from "../../components/NewMaterialMenu";
import { dragOverRow, dropClass, endDrag, moveFor, startDrag, useDrag } from "../../dnd";
import { KIND_ICON, KIND_LABEL } from "../../kinds";
import { childrenOf } from "../../tree";
import { plural } from "../HomePage";
import { TitleInput } from "./shared";

/**
 * A folder: imported slides (one annotated page per slide) or a group of
 * materials you made. Images show as thumbnails, other materials as cards.
 */
export default function FolderView({ material }: { material: Material }) {
  const navigate = useNavigate();
  const { data: tree } = useTree();
  const course = tree?.courses.find((c) => c.id === material.courseId);
  const items = course ? childrenOf(course, material.id) : [];
  const source = asFolder(material.content).source;
  const regions = items.reduce((n, p) => n + p.regions, 0);
  const label = source?.type === "pdf" ? "page" : source ? "slide" : "item";
  const drag = useDrag((s) => s.drag);
  const drop = useDrag((s) => s.drop);
  const move = useMoveMaterial();

  const onDrop = (e: React.DragEvent) => {
    const { drag, drop } = useDrag.getState();
    endDrag();
    if (!tree || !drag || !drop) return;
    e.preventDefault();
    const m = moveFor(tree, drag, drop);
    if (m) move.mutate(m);
  };

  const kicker = [course?.code, course?.name, source ? (source.type === "pdf" ? "PDF" : "Slides") : "Folder"];

  return (
    <div className="page page-wide folder-page">
      <div className="kicker">{kicker.filter(Boolean).join(" · ")}</div>
      <TitleInput material={material} />
      <div className="folder-meta">
        <span>
          {plural(items.length, label)}
          {regions > 0 && ` · ${plural(regions, "region")}`}
        </span>
        {source && (
          <>
            <a className="folder-link" href={source.url} download={source.name}>
              <Download size={14} /> {source.name}
            </a>
            {source.type === "slides" && (
              <a className="folder-link" href={source.pdfUrl} target="_blank" rel="noreferrer">
                <FileText size={14} /> PDF
              </a>
            )}
          </>
        )}
        <span className="grow" />
        <NewMaterialMenu courseId={material.courseId} parentId={material.id} className="btn-secondary small">
          <Plus size={14} strokeWidth={2.4} />
          <span>Add to folder</span>
        </NewMaterialMenu>
      </div>

      <div className="slide-grid" onDragEnd={endDrag}>
        {items.map((p, i) => (
          <button
            type="button"
            key={p.id}
            className={`slide-card${p.kind === "image" ? "" : " is-material"}${drag?.id === p.id ? " is-dragging" : ""}${dropClass(drop, p.id)}`}
            style={{ animationDelay: `${Math.min(i, 20) * 20}ms` }}
            onClick={() => navigate(`/m/${p.id}`)}
            draggable
            onDragStart={(e) => startDrag(e, p, e.currentTarget)}
            onDragOver={(e) => dragOverRow(e, p)}
            onDrop={onDrop}
          >
            <span className="slide-thumb">
              {p.kind === "image" ? <SlideImage materialId={p.id} /> : <MaterialThumb m={p} />}
              {p.regions > 0 && <span className="slide-regions">{p.regions}</span>}
            </span>
            <span className="slide-title">{p.title || `${label} ${i + 1}`}</span>
          </button>
        ))}
      </div>
      {!items.length && (
        <p className="muted empty-note">
          This folder is empty. Use <strong>Add to folder</strong>, or drag materials onto the folder in the sidebar.
        </p>
      )}
      <Backlinks materialId={material.id} />
    </div>
  );
}

/** The page image; fetched lazily so a 60-slide deck doesn't load every material up front. */
function SlideImage({ materialId }: { materialId: string }) {
  return <img src={`/api/materials/${materialId}/image`} alt="" loading="lazy" decoding="async" />;
}

/** A page or notebook in a folder: its kind and first sections. */
function MaterialThumb({ m }: { m: MaterialSummary }) {
  const Icon = KIND_ICON[m.kind];
  return (
    <span className="material-thumb">
      <span className="material-thumb-kind">
        <Icon size={15} /> {KIND_LABEL[m.kind]}
      </span>
      <span className="material-thumb-outline">
        {m.outline.slice(0, 5).map((o) => (
          <span key={o.id} className={`level-${o.level}`}>
            {o.num} {o.text || "Untitled"}
          </span>
        ))}
        {!m.outline.length && <span className="muted">No sections yet</span>}
      </span>
    </span>
  );
}
