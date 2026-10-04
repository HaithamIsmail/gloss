import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import type { MaterialSummary } from "../../shared/api";
import { useTree } from "../api";
import { isTyping } from "../pages/material/shared";
import { useUI } from "../store";
import { childrenOf } from "../tree";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Where a material sits in its folder: the folder, its position and its neighbours. */
export function useFolderPosition(material: MaterialSummary | undefined) {
  const { data: tree } = useTree();
  const course = tree?.courses.find((c) => c.id === material?.courseId);
  const folder = material?.parentId ? course?.materials.find((m) => m.id === material.parentId) : undefined;
  const items = folder && course ? childrenOf(course, folder.id) : [];
  const index = items.findIndex((m) => m.id === material?.id);
  return {
    folder,
    index,
    count: items.length,
    prev: index > 0 ? items[index - 1] : undefined,
    next: index >= 0 && index < items.length - 1 ? items[index + 1] : undefined,
  };
}

/**
 * ‹ 3 / 12 › in the top bar for anything inside a folder. Keys: ← / → (when not
 * typing), Page Up / Page Down, and Alt+← / Alt+→ (also while typing, except on
 * a Mac where Option+arrows move by word in text).
 */
export function FolderNav({ material }: { material: MaterialSummary }) {
  const navigate = useNavigate();
  const { folder, index, count, prev, next } = useFolderPosition(material);
  const nav = useRef({ prev, next });
  nav.current = { prev, next };

  useEffect(() => {
    if (!folder) return;
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState();
      if (ui.searchOpen || ui.drawingSession || e.defaultPrevented || e.ctrlKey || e.metaKey) return;
      if (document.querySelector(".tour, .search-backdrop, .history-panel")) return;
      const typing = isTyping(e.target);
      const back = e.key === "ArrowLeft" || e.key === "PageUp";
      const forward = e.key === "ArrowRight" || e.key === "PageDown";
      if (!back && !forward) return;
      const arrow = e.key === "ArrowLeft" || e.key === "ArrowRight";
      const allowed = e.altKey ? !(typing && isMac) : !typing && !e.shiftKey && (arrow || !e.altKey);
      if (!allowed || (e.altKey && !arrow)) return;
      const target = back ? nav.current.prev : nav.current.next;
      if (!target) return;
      e.preventDefault();
      navigate(`/m/${target.id}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [folder?.id, navigate]);

  if (!folder || index < 0) return null;
  return (
    <div className="folder-nav" title={`In “${folder.title || "Untitled"}”`}>
      <button
        type="button"
        className="icon-btn"
        title={prev ? `Previous: ${prev.title || "Untitled"} (←)` : "First in the folder"}
        disabled={!prev}
        onClick={() => prev && navigate(`/m/${prev.id}`)}
      >
        <ChevronLeft size={17} />
      </button>
      <span className="folder-nav-pos tabular">
        {index + 1} / {count}
      </span>
      <button
        type="button"
        className="icon-btn"
        title={next ? `Next: ${next.title || "Untitled"} (→)` : "Last in the folder"}
        disabled={!next}
        onClick={() => next && navigate(`/m/${next.id}`)}
      >
        <ChevronRight size={17} />
      </button>
    </div>
  );
}
