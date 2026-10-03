import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import { TextSelection } from "prosemirror-state";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MATH_BLOCK } from "../../shared/content";
import { mathHtml } from "../math";

// ── Inline formula ($x^2$) ───────────────────────────────────────────────

/** A formula inside a line of text. Click it to edit its LaTeX. */
export const MathInline = createReactInlineContentSpec(
  { type: "math", propSchema: { latex: { default: "" } }, content: "none" } as const,
  {
    render: ({ inlineContent, updateInlineContent, editor, getPos }) => {
      // Puts the cursor right after the formula (or removes an empty one).
      const leave = (remove: boolean) => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        editor.focus();
        editor.transact((tr) => {
          if (remove) tr.delete(pos, pos + 1);
          tr.setSelection(TextSelection.near(tr.doc.resolve(remove ? pos : pos + 1)));
        });
      };
      return (
        <InlineMath
          latex={inlineContent.props.latex}
          editable={editor.isEditable}
          onDone={(latex) => {
            if (!latex.trim()) return leave(true);
            if (latex !== inlineContent.props.latex) updateInlineContent({ type: "math", props: { latex } });
            window.setTimeout(() => leave(false), 0);
          }}
        />
      );
    },
  },
);

function InlineMath({ latex, editable, onDone }: { latex: string; editable: boolean; onDone: (latex: string) => void }) {
  const [editing, setEditing] = useState(() => editable && !latex);
  const anchor = useRef<HTMLSpanElement>(null);

  return (
    <>
      <span
        ref={anchor}
        className={`math-inline${latex ? "" : " is-empty"}${editing ? " is-editing" : ""}`}
        title={editable ? "Click to edit the formula" : latex}
        onClick={() => editable && setEditing(true)}
        dangerouslySetInnerHTML={{ __html: latex ? mathHtml(latex) : "ƒ(x)" }}
      />
      {editing && (
        <MathPopover
          anchor={anchor}
          initial={latex}
          onClose={(value) => {
            setEditing(false);
            onDone(value);
          }}
        />
      )}
    </>
  );
}

/** The LaTeX field under an inline formula, with a live preview. */
function MathPopover({
  anchor,
  initial,
  onClose,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  initial: string;
  onClose: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const latest = useRef(value);
  latest.current = value;

  const close = (v: string) => {
    if (done.current) return;
    done.current = true;
    onClose(v);
  };

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (r) setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 368)), top: r.bottom + 6 });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node)) close(latest.current);
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, []);

  if (!pos) return null;
  return createPortal(
    <div ref={pop} className="math-pop" style={pos}>
      <input
        autoFocus
        className="math-pop-input"
        value={value}
        spellCheck={false}
        placeholder="LaTeX, e.g. \frac{a}{b}"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            close(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            close(initial);
          }
        }}
      />
      <div
        className="math-pop-preview"
        dangerouslySetInnerHTML={{ __html: value.trim() ? mathHtml(value) : '<span class="muted">Preview</span>' }}
      />
      <div className="math-pop-hint">Enter to finish · Esc to cancel</div>
    </div>,
    document.body,
  );
}

// ── Display formula (its own block) ──────────────────────────────────────

export const MathBlock = createReactBlockSpec(
  { type: MATH_BLOCK, propSchema: { latex: { default: "" } }, content: "none" } as const,
  {
    meta: { selectable: false },
    render: ({ block, editor }) => (
      <MathBlockView
        latex={block.props.latex}
        editable={editor.isEditable}
        onCommit={(latex) => editor.updateBlock(block, { props: { latex } })}
      />
    ),
  },
);

function MathBlockView({
  latex,
  editable,
  onCommit,
}: {
  latex: string;
  editable: boolean;
  onCommit: (latex: string) => void;
}) {
  const [editing, setEditing] = useState(() => editable && !latex);
  const [draft, setDraft] = useState(latex);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  // Undo/redo can change the formula from outside.
  useEffect(() => {
    if (!editing) setDraft(latex);
  }, [latex, editing]);

  // Leaving the page while typing still keeps the formula.
  useEffect(() => {
    if (!editing) return;
    return () => {
      if (draftRef.current !== latex) commitRef.current(draftRef.current);
    };
  }, [editing]);

  const finish = () => {
    setEditing(false);
    if (draft !== latex) onCommit(draft);
  };

  const shown = editing ? draft : latex;
  return (
    <div className={`math-block${editing ? " is-editing" : ""}`} contentEditable={false}>
      <div
        className={`math-display${shown.trim() ? "" : " is-empty"}`}
        onClick={() => editable && setEditing(true)}
        title={editable && !editing ? "Click to edit the formula" : undefined}
        dangerouslySetInnerHTML={{
          __html: shown.trim() ? mathHtml(shown, true) : "Click to write a formula in LaTeX",
        }}
      />
      {editing && (
        <div className="math-source">
          <textarea
            autoFocus
            value={draft}
            spellCheck={false}
            rows={Math.min(8, Math.max(2, draft.split("\n").length))}
            placeholder={"E = mc^2\n\\int_0^1 x\\,dx"}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={finish}
            onKeyDown={(e) => {
              if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
                e.preventDefault();
                finish();
              }
            }}
          />
          <span className="math-source-hint">LaTeX · Ctrl+Enter or click away to finish</span>
        </div>
      )}
    </div>
  );
}
