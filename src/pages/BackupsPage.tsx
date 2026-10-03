import { useQuery } from "@tanstack/react-query";
import { Archive, DatabaseBackup, Download, FileDown, Printer } from "lucide-react";
import { useState } from "react";
import { api, keys, queryClient, useTree } from "../api";
import { download, formatBytes, formatWhen } from "../format";
import { toast } from "../toast";

export function BackupsPage() {
  const { data: tree } = useTree();
  const { data: backups, isLoading } = useQuery({ queryKey: keys.backups, queryFn: api.backups, staleTime: 0 });
  const [busy, setBusy] = useState(false);
  const [courseId, setCourseId] = useState("");
  const course = tree?.courses.find((c) => c.id === courseId) ?? tree?.courses[0];

  const backupNow = async () => {
    setBusy(true);
    try {
      const b = await api.backupNow();
      toast(`Backed up (${formatBytes(b.size)})`);
      void queryClient.invalidateQueries({ queryKey: keys.backups });
    } catch (err) {
      toast((err as Error).message || "Backup failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-narrow">
      <div className="kicker">Workspace</div>
      <h1 className="page-title">Backups and export</h1>

      <div className="section-head">
        <span className="section-head-title">Backups</span>
        <span className="section-head-actions">
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void backupNow()}>
            <DatabaseBackup size={15} />
            <span>{busy ? "Backing up…" : "Back up now"}</span>
          </button>
        </span>
      </div>
      <p className="muted page-lede">
        Each time Gloss starts, it copies its database to <code>data/backups/</code> (if anything changed since the
        last copy) and keeps the latest 20. Images and files you added live in <code>data/uploads/</code>, which Gloss
        only ever adds to. To restore a backup, stop Gloss and replace <code>data/study.db</code> with the backup file
        (renamed to <code>study.db</code>).
      </p>

      {isLoading && <p className="muted">Loading…</p>}
      {backups && !backups.length && <p className="muted empty-note">No backups yet.</p>}
      <div className="trash-list">
        {backups?.map((b, i) => (
          <div key={b.name} className="trash-item">
            <DatabaseBackup size={17} className="trash-icon" />
            <span className="trash-main">
              <strong>
                {formatWhen(b.createdAt)}
                {i === 0 && <span className="pill">Latest</span>}
              </strong>
              <small>{b.name}</small>
            </span>
            <span className="trash-when tabular">{formatBytes(b.size)}</span>
            <a className="btn-secondary small" href={`/api/backups/${encodeURIComponent(b.name)}`} download>
              <Download size={14} />
              <span>Download</span>
            </a>
          </div>
        ))}
      </div>

      <div className="section-head">
        <span className="section-head-title">Export</span>
      </div>
      <div className="export-grid">
        <div className="export-card">
          <Archive size={20} />
          <strong>Everything</strong>
          <p className="muted">The database plus every image, file and notebook folder, as one .zip.</p>
          <button type="button" className="btn-secondary small" onClick={() => download("/api/export/all")}>
            <Download size={14} /> Download .zip
          </button>
        </div>
        <div className="export-card">
          <FileDown size={20} />
          <strong>A course</strong>
          <p className="muted">As Markdown files with their images, or as a printable page to save as PDF.</p>
          {tree?.courses.length ? (
            <>
              <select className="select" value={course?.id ?? ""} onChange={(e) => setCourseId(e.target.value)}>
                {tree.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || "Untitled course"}
                  </option>
                ))}
              </select>
              <span className="export-actions">
                <button
                  type="button"
                  className="btn-secondary small"
                  disabled={!course}
                  onClick={() => course && download(`/api/export/course/${course.id}`)}
                >
                  <Download size={14} /> Markdown
                </button>
                <button
                  type="button"
                  className="btn-secondary small"
                  disabled={!course}
                  onClick={() => course && window.open(`/print/c/${course.id}?auto=1`, "_blank")}
                >
                  <Printer size={14} /> PDF
                </button>
              </span>
            </>
          ) : (
            <p className="muted">No courses yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
