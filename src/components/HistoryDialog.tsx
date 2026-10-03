import { useQuery } from "@tanstack/react-query";
import { History, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, keys, patchTreeMaterial, queryClient, useMaterial } from "../api";
import { flushAll } from "../flush";
import { formatBytes, formatWhen } from "../format";
import { StaticContent } from "../print/Static";
import { useUI } from "../store";
import { toast } from "../toast";

export function HistoryHost() {
  const id = useUI((s) => s.historyFor);
  if (!id) return null;
  return <HistoryDialog key={id} materialId={id} onClose={() => useUI.getState().setHistoryFor(null)} />;
}

/** Earlier states of a material: pick one to preview, then restore it. */
function HistoryDialog({ materialId, onClose }: { materialId: string; onClose: () => void }) {
  const [flushed, setFlushed] = useState(false);
  const [selected, setSelected] = useState<string>("current");
  const [restoring, setRestoring] = useState(false);
  const { data: material } = useMaterial(materialId);

  // Send any unsaved edits first, so "Current" is really current.
  useEffect(() => {
    void flushAll().finally(() => setFlushed(true));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const versions = useQuery({
    queryKey: keys.versions(materialId),
    queryFn: () => api.versions(materialId),
    enabled: flushed,
    staleTime: 0,
  });
  const version = useQuery({
    queryKey: ["version", selected],
    queryFn: () => api.version(selected),
    enabled: selected !== "current",
    staleTime: Infinity,
  });

  const content = selected === "current" ? material?.content : version.data?.content;
  const picked = versions.data?.find((v) => v.id === selected);

  const restore = async () => {
    if (!picked) return;
    setRestoring(true);
    try {
      await flushAll();
      const m = await api.restoreVersion(materialId, picked.id);
      queryClient.setQueryData(keys.material(materialId), m);
      const { content: _content, ...summary } = m;
      patchTreeMaterial(summary);
      void queryClient.invalidateQueries({ queryKey: keys.versions(materialId) });
      useUI.getState().reloadMaterial();
      onClose();
      toast(`Restored the version from ${formatWhen(picked.createdAt)}. The one before is kept in history.`);
    } catch (err) {
      toast((err as Error).message || "Could not restore that version.");
      setRestoring(false);
    }
  };

  return (
    <div className="search-backdrop history-backdrop" onMouseDown={onClose}>
      <div className="history-panel" role="dialog" aria-label="Version history" onMouseDown={(e) => e.stopPropagation()}>
        <div className="history-head">
          <History size={17} />
          <span className="grow">
            <strong>Version history</strong>
            <span className="muted"> · {material?.title || "Untitled"}</span>
          </span>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="history-body">
          <nav className="history-list">
            <button
              type="button"
              className={`history-item${selected === "current" ? " is-active" : ""}`}
              onClick={() => setSelected("current")}
            >
              <strong>Current version</strong>
              <small>{material ? formatWhen(material.updatedAt) : ""}</small>
            </button>
            {versions.data?.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`history-item${selected === v.id ? " is-active" : ""}`}
                onClick={() => setSelected(v.id)}
              >
                <strong>{formatWhen(v.createdAt)}</strong>
                <small>
                  {v.title || "Untitled"} · {formatBytes(v.size)}
                </small>
              </button>
            ))}
            {versions.data && !versions.data.length && (
              <p className="history-empty muted">
                No earlier versions yet. While you edit, the previous state is kept every 10 minutes.
              </p>
            )}
            {!versions.data && <p className="history-empty muted">Loading…</p>}
          </nav>
          <div className="history-preview">
            {selected !== "current" && (
              <div className="history-preview-bar">
                <span className="grow">
                  Preview of <strong>{picked ? formatWhen(picked.createdAt) : ""}</strong>
                </span>
                <button type="button" className="btn-primary small" disabled={!picked || restoring} onClick={() => void restore()}>
                  <RotateCcw size={14} /> Restore this version
                </button>
              </div>
            )}
            <div className="history-preview-doc">
              {material && content !== undefined ? (
                <StaticContent material={material} content={content} />
              ) : (
                <p className="muted">Loading…</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
