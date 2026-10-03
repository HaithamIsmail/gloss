import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { SearchResult } from "../../shared/api";
import { api } from "../api";
import { useUI } from "../store";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function SearchDialog() {
  const open = useUI((s) => s.searchOpen);
  if (!open) return null;
  return <SearchPanel />;
}

function SearchPanel() {
  const setOpen = useUI((s) => s.setSearchOpen);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const query = useDebounced(q, 120);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["search", query],
    queryFn: () => api.search(query),
    placeholderData: keepPreviousData,
    staleTime: 5_000,
  });

  useEffect(() => setIdx(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  const close = () => setOpen(false);

  const go = (r: SearchResult) => {
    close();
    if (r.kind === "Course") return navigate(`/c/${r.courseId}`);
    if (r.kind === "Drawing") return navigate(`/canvas/${r.drawingId}`);
    const params = new URLSearchParams();
    if (r.blockId) params.set("block", r.blockId);
    if (r.annotationId) params.set("ann", r.annotationId);
    const qs = params.toString();
    navigate(`/m/${r.materialId}${qs ? `?${qs}` : ""}`);
  };

  return (
    <div className="search-backdrop" onMouseDown={close}>
      <div className="search-panel" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
        <div className="search-input-row">
          <Search size={18} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search courses, materials, sections, comments and drawings"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && results[idx]) {
                e.preventDefault();
                go(results[idx]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="search-results" ref={listRef}>
          {results.map((r, i) => (
            <div
              key={`${r.kind}-${r.materialId ?? r.drawingId ?? r.courseId}-${r.blockId ?? ""}-${r.annotationId ?? ""}-${i}`}
              data-idx={i}
              className={`search-result${i === idx ? " is-active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                go(r);
              }}
              onMouseEnter={() => setIdx(i)}
            >
              <span className="search-kind">{r.label}</span>
              <div className="search-text">
                <div className="search-title">{r.title || "Untitled"}</div>
                <div className="search-path">{r.path}</div>
              </div>
            </div>
          ))}
          {!results.length && !isFetching && <div className="search-empty">No results</div>}
        </div>
      </div>
    </div>
  );
}
