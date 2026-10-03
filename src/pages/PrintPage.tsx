import { useQueries } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { Course, Material, MaterialSummary } from "../../shared/api";
import { api, keys, useTree } from "../api";
import { APP_NAME } from "../components/Logo";
import { StaticContent } from "../print/Static";
import { childrenOf, topLevel } from "../tree";

type Entry = { summary: MaterialSummary; depth: number };

/** What gets printed: a course (every material, folders with their pages) or one material. */
function entriesFor(course: Course, scope: string, id: string): Entry[] {
  const expand = (m: MaterialSummary, depth: number): Entry[] =>
    m.kind === "folder" ? [{ summary: m, depth }, ...childrenOf(course, m.id).map((c) => ({ summary: c, depth: depth + 1 }))] : [{ summary: m, depth }];
  if (scope === "c") return topLevel(course).flatMap((m) => expand(m, 0));
  const m = course.materials.find((x) => x.id === id);
  return m ? expand(m, 0) : [];
}

/**
 * A clean, printable view of a course or material. The browser's print
 * dialog saves it as a PDF.
 */
export function PrintPage() {
  const { scope = "m", id = "" } = useParams();
  const [params] = useSearchParams();
  const { data: tree, isLoading } = useTree();
  const course = tree?.courses.find((c) => (scope === "c" ? c.id === id : c.materials.some((m) => m.id === id)));
  const entries = course ? entriesFor(course, scope, id) : [];

  const results = useQueries({
    queries: entries
      .filter((e) => e.summary.kind !== "folder")
      .map((e) => ({ queryKey: keys.material(e.summary.id), queryFn: () => api.material(e.summary.id), staleTime: 0 })),
  });
  const byId = new Map(results.filter((r) => r.data).map((r) => [r.data!.id, r.data as Material]));
  const ready = !!course && results.every((r) => !r.isLoading);

  const title =
    scope === "c"
      ? [course?.code, course?.name].filter(Boolean).join(" · ") || "Course"
      : (entries[0]?.summary.title ?? "Material");

  useEffect(() => {
    document.title = `${title} · ${APP_NAME}`;
  }, [title]);

  // Opened with ?auto=1: print as soon as everything (images included) has loaded.
  const printed = useRef(false);
  useEffect(() => {
    if (!ready || printed.current || params.get("auto") !== "1") return;
    printed.current = true;
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>(".print-page img"));
    void Promise.all(imgs.map((img) => (img.complete ? null : img.decode().catch(() => null)))).then(() =>
      window.setTimeout(() => window.print(), 300),
    );
  }, [ready, params]);

  if (isLoading) return <div className="print-page muted">Loading…</div>;
  if (!course || !entries.length) {
    return (
      <div className="print-page">
        <p>Nothing to print here. <Link to="/">Back to {APP_NAME}</Link></p>
      </div>
    );
  }

  return (
    <div className="print-page">
      <div className="print-bar no-print">
        <Link to={scope === "c" ? `/c/${id}` : `/m/${id}`} className="btn-secondary small">
          <ArrowLeft size={15} /> Back
        </Link>
        <span className="grow muted">Use “Save as PDF” as the printer to get a PDF.</span>
        <button type="button" className="btn-primary small" disabled={!ready} onClick={() => window.print()}>
          <Printer size={15} /> Print or save as PDF
        </button>
      </div>

      <header className="print-head">
        <div className="kicker">{scope === "c" ? "Course" : [course.code, course.name].filter(Boolean).join(" · ")}</div>
        <h1>{title}</h1>
        {scope === "c" && (
          <ol className="print-toc">
            {entries
              .filter((e) => e.depth === 0)
              .map((e) => (
                <li key={e.summary.id}>{e.summary.title || "Untitled"}</li>
              ))}
          </ol>
        )}
      </header>

      {!ready && <p className="muted">Loading materials…</p>}
      {ready &&
        entries.map(({ summary, depth }, i) => {
          const m = byId.get(summary.id);
          const showTitle = !(scope === "m" && i === 0 && summary.kind !== "folder");
          return (
            <article
              key={summary.id}
              className={`print-material kind-${summary.kind}${depth ? " is-nested" : ""}`}
            >
              {showTitle && (summary.kind === "folder" ? <h1 className="print-folder">{summary.title || "Untitled"}</h1> : <h2>{summary.title || "Untitled"}</h2>)}
              {m && <StaticContent material={m} content={m.content} />}
            </article>
          );
        })}
    </div>
  );
}
