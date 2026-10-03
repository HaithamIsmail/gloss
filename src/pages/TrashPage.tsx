import { useQuery } from "@tanstack/react-query";
import { BookOpen, PenTool, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { TrashItem } from "../../shared/api";
import { api, keys, queryClient, restoreFromTrash } from "../api";
import { timeAgo } from "../format";
import { KIND_ICON } from "../kinds";
import { toast } from "../toast";
import { plural } from "./HomePage";

const DAYS = 30;

function iconFor(t: TrashItem) {
  if (t.kind === "course") return BookOpen;
  if (t.kind === "drawing") return PenTool;
  return KIND_ICON[t.materialKind ?? "doc"];
}

function describe(t: TrashItem) {
  const what = t.kind === "course" ? "Course" : t.kind === "drawing" ? "Drawing" : t.materialKind === "folder" ? "Folder" : "Material";
  const parts = [what];
  if (t.where) parts.push(`in ${t.where}`);
  if (t.contains) parts.push(t.kind === "course" ? plural(t.contains, "material") : plural(t.contains, "page"));
  return parts.join(" · ");
}

export function TrashPage() {
  const { data: items, isLoading } = useQuery({ queryKey: keys.trash, queryFn: api.trash, staleTime: 0 });
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.trash });

  const restore = async (t: TrashItem) => {
    setBusy(t.id);
    await restoreFromTrash(t.id, t.title);
    setBusy(null);
  };

  const purge = async (t: TrashItem) => {
    if (!confirm(`Delete “${t.title}” for good? This cannot be undone.`)) return;
    setBusy(t.id);
    await api.purgeTrash(t.id).catch(() => toast("Could not delete that."));
    setBusy(null);
    void refresh();
  };

  const empty = async () => {
    if (!confirm(`Delete all ${items?.length ?? 0} items in the trash for good? This cannot be undone.`)) return;
    await api.emptyTrash();
    void refresh();
    toast("Trash emptied");
  };

  return (
    <div className="page page-narrow">
      <div className="kicker">Workspace</div>
      <h1 className="page-title">Trash</h1>
      <p className="muted page-lede">
        Deleted courses, materials and drawings wait here for {DAYS} days, then they are deleted for good.
      </p>

      <div className="section-head">
        <span className="section-head-title">{items ? plural(items.length, "item") : "Items"}</span>
        <span className="section-head-actions">
          {!!items?.length && (
            <button type="button" className="btn-secondary" onClick={() => void empty()}>
              <Trash2 size={15} />
              <span>Empty trash</span>
            </button>
          )}
        </span>
      </div>

      {isLoading && <p className="muted">Loading…</p>}
      {items && !items.length && <p className="muted empty-note">The trash is empty.</p>}

      <div className="trash-list">
        {items?.map((t) => {
          const Icon = iconFor(t);
          const left = Math.max(0, DAYS - Math.floor((Date.now() - t.deletedAt) / 86_400_000));
          return (
            <div key={t.id} className="trash-item">
              <Icon size={17} className="trash-icon" />
              <span className="trash-main">
                <strong>{t.title}</strong>
                <small>{describe(t)}</small>
              </span>
              <span className="trash-when" title={`Deleted for good in ${plural(left, "day")}`}>
                {timeAgo(t.deletedAt)}
              </span>
              <button
                type="button"
                className="btn-secondary small"
                disabled={busy === t.id}
                onClick={() => void restore(t)}
              >
                <RotateCcw size={14} />
                <span>Restore</span>
              </button>
              <button
                type="button"
                className="icon-btn danger"
                title="Delete for good"
                disabled={busy === t.id}
                onClick={() => void purge(t)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
