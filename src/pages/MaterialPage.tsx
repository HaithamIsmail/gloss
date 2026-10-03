import { lazy, Suspense, useEffect } from "react";
import { useParams } from "react-router";
import { useMaterial } from "../api";
import { resetDoc, useUI } from "../store";
import FolderView from "./material/FolderView";
import ImageView from "./material/ImageView";

// Each page kind pulls in its own editor, so load them on demand.
const DocView = lazy(() => import("./material/DocView"));
const NotebookView = lazy(() => import("./material/NotebookView"));

const loading = <div className="page page-narrow muted">Loading…</div>;

export function MaterialPage() {
  const { materialId } = useParams();
  const { data: material, isLoading, error } = useMaterial(materialId);
  const revision = useUI((s) => s.revision);

  useEffect(() => {
    document.getElementById("main-scroll")?.scrollTo({ top: 0 });
    return () => {
      resetDoc();
    };
  }, [materialId]);

  if (isLoading) return loading;
  if (error || !material) {
    return (
      <div className="page page-narrow">
        <div className="kicker">Not found</div>
        <h1 className="page-title">This material no longer exists</h1>
      </div>
    );
  }
  return (
    <Suspense fallback={loading}>
      {material.kind === "folder" ? (
        <FolderView key={`${material.id}:${revision}`} material={material} />
      ) : material.kind === "image" ? (
        <ImageView key={`${material.id}:${revision}`} material={material} />
      ) : material.kind === "notebook" ? (
        <NotebookView key={`${material.id}:${revision}`} material={material} />
      ) : (
        <DocView key={`${material.id}:${revision}`} material={material} />
      )}
    </Suspense>
  );
}
