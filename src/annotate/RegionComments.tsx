import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Annotation } from "../../shared/content";
import { useUI } from "../store";

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The numbered comment list that goes with a RegionStage. */
export function RegionComments({
  annotations,
  numberOf,
  editing,
  onEdit,
  onComment,
  onDelete,
  actions,
  hasImage,
  className = "ann-comments",
}: {
  annotations: Annotation[];
  numberOf: (a: Annotation, index: number) => number;
  editing: string | null;
  onEdit: (id: string | null) => void;
  onComment: (id: string, comment: string) => void;
  onDelete: (id: string) => void;
  /** Extra buttons per comment (e.g. linking it to text). */
  actions?: (a: Annotation) => ReactNode;
  hasImage: boolean;
  className?: string;
}) {
  const hovered = useUI((s) => s.hovered);
  const setHovered = useUI((s) => s.setHovered);

  // Keep the comment being edited (or arrived at from search) in view.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editing) return;
    listRef.current
      ?.querySelector(`[data-comment="${CSS.escape(editing)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [editing]);

  return (
    <div className={className} ref={listRef}>
      <div className="ann-comments-head">{annotations.length ? plural(annotations.length, "region") : "Regions"}</div>
      {!annotations.length && (
        <div className="ann-comments-empty">
          {hasImage
            ? "Drag on the image to mark a region. Each region gets a numbered comment."
            : "Add an image, then drag on it to mark regions."}
        </div>
      )}
      {annotations.map((a, i) => (
        <div
          key={a.id}
          data-comment={a.id}
          className={`ann-comment${hovered === a.id ? " is-active" : ""}`}
          onMouseEnter={() => setHovered(a.id, "comment")}
          onMouseLeave={() => setHovered(null)}
        >
          <span className="ann-badge">{numberOf(a, i)}</span>
          <div className="ann-comment-main">
            {editing === a.id ? (
              <CommentEditor initial={a.comment} onCommit={(c) => onComment(a.id, c)} onDone={() => onEdit(null)} />
            ) : (
              <div className={`ann-comment-text${a.comment ? "" : " is-empty"}`} onClick={() => onEdit(a.id)}>
                {a.comment || "Add a comment…"}
              </div>
            )}
            <div className="ann-comment-actions">
              {actions?.(a)}
              <button type="button" className="ann-del" title="Delete region" onClick={() => onDelete(a.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CommentEditor({
  initial,
  onCommit,
  onDone,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  // The editor can close without a blur (e.g. drawing a new region), so the
  // latest text is also committed when it unmounts.
  const latest = useRef({ value: initial, done: false, onCommit });
  latest.current.value = value;
  latest.current.onCommit = onCommit;

  const commit = () => {
    const l = latest.current;
    if (l.done) return;
    l.done = true;
    const v = l.value.trim();
    if (v !== initial) l.onCommit(v);
  };

  const autosize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    latest.current.done = false;
    const el = ref.current;
    if (el) {
      autosize(el);
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    return commit;
  }, []);

  return (
    <textarea
      ref={ref}
      className="ann-comment-input"
      rows={2}
      value={value}
      placeholder="Comment on this region…"
      onChange={(e) => {
        setValue(e.target.value);
        autosize(e.target);
      }}
      onBlur={() => {
        commit();
        onDone();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if ((e.key === "Enter" && !e.shiftKey) || e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}
