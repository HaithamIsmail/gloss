import { LoaderCircle, TriangleAlert } from "lucide-react";
import type { NavigateFunction } from "react-router";
import { keys, queryClient } from "../api";
import { useUI } from "../store";
import { importSlides, SLIDE_ACCEPT } from "./importSlides";

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** Asks for a PDF or deck and imports it into the course as a folder of annotated pages. */
export async function startSlideImport(courseId: string, navigate: NavigateFunction) {
  if (useUI.getState().slideImport) return;
  const file = await pickFile(SLIDE_ACCEPT);
  if (!file) return;

  const ctrl = new AbortController();
  const { setSlideImport, setExpanded } = useUI.getState();
  setSlideImport({ fileName: file.name, message: "Starting…", cancel: () => ctrl.abort() });
  const update = (patch: Partial<NonNullable<ReturnType<typeof useUI.getState>["slideImport"]>>) =>
    useUI.setState((s) => (s.slideImport ? { slideImport: { ...s.slideImport, ...patch } } : {}));

  try {
    const folder = await importSlides(file, courseId, (step) => update(step), ctrl.signal);
    await queryClient.invalidateQueries({ queryKey: keys.tree });
    setExpanded(courseId, true);
    setExpanded(folder.id, true);
    setSlideImport(null);
    navigate(`/m/${folder.id}`);
  } catch (err) {
    if (ctrl.signal.aborted) return setSlideImport(null);
    console.error(err);
    update({ error: (err as Error).message || "The import failed.", cancel: () => setSlideImport(null) });
  }
}

/** Progress for an import in flight. Mounted once in the app layout. */
export function SlideImportHost() {
  const job = useUI((s) => s.slideImport);
  if (!job) return null;
  const pct = job.total ? Math.round(((job.done ?? 0) / job.total) * 100) : null;

  return (
    <div className="search-backdrop">
      <div className="search-panel import-panel" role="dialog" aria-label="Importing slides">
        <div className="picker-head">
          <span className="section-head-title">{job.error ? "Import failed" : "Importing"}</span>
        </div>
        <div className="import-body">
          <div className="import-file">{job.fileName}</div>
          {job.error ? (
            <div className="import-error">
              <TriangleAlert size={15} /> {job.error}
            </div>
          ) : (
            <>
              <div className="import-step">
                <LoaderCircle size={15} className="spin" /> {job.message}
              </div>
              <div className={`import-bar${pct === null ? " is-indeterminate" : ""}`}>
                <span style={pct === null ? undefined : { width: `${pct}%` }} />
              </div>
            </>
          )}
          <div className="import-actions">
            <button type="button" className="btn-secondary" onClick={job.cancel}>
              {job.error ? "Close" : "Cancel"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
