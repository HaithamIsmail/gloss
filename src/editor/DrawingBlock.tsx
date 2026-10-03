import type { BlockNoteEditor } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { PenLine, SquareArrowOutUpRight } from "lucide-react";
import { Link } from "react-router";
import type { Tree } from "../../shared/api";
import { DRAWING } from "../../shared/content";
import { keys, queryClient, useDrawings } from "../api";
import { useUI } from "../store";

type AnyEditor = BlockNoteEditor<any, any, any>;

/**
 * Opens the drawing editor for a drawing block. A new block (no drawing yet)
 * is removed again if the drawing is cancelled, so nothing lands on the page.
 */
export function openDrawingForBlock(editor: AnyEditor, blockId: string) {
  const drawingId = (editor.getBlock(blockId)?.props.drawingId as string) || null;
  const materialId = useUI.getState().doc.materialId;
  const courseId =
    queryClient.getQueryData<Tree>(keys.tree)?.courses.find((c) => c.materials.some((m) => m.id === materialId))
      ?.id ?? null;

  useUI.getState().openDrawing({
    drawingId,
    courseId,
    submitLabel: drawingId ? "Save drawing" : "Insert into page",
    onSaved: (d) => {
      if (editor.getBlock(blockId) && !drawingId) editor.updateBlock(blockId, { props: { drawingId: d.id } });
    },
    onCancel: () => {
      const block = editor.getBlock(blockId);
      if (block && !block.props.drawingId) editor.removeBlocks([blockId]);
    },
  });
}

export const DrawingBlock = createReactBlockSpec(
  {
    type: DRAWING,
    propSchema: { drawingId: { default: "" } },
    content: "none",
  },
  {
    meta: { selectable: false },
    render: ({ block, editor }) => <DrawingView blockId={block.id} drawingId={block.props.drawingId} editor={editor} />,
  },
);

function DrawingView({ blockId, drawingId, editor }: { blockId: string; drawingId: string; editor: AnyEditor }) {
  const { data: drawings, isLoading } = useDrawings();
  const meta = drawings?.find((d) => d.id === drawingId);
  const missing = !!drawingId && !isLoading && !meta;
  const edit = () => openDrawingForBlock(editor, blockId);

  return (
    <div className="drawing-block" contentEditable={false} suppressContentEditableWarning>
      <div className="block-head">
        <span className="block-head-title">Drawing</span>
        <span className="block-head-hint">{meta?.title ?? (drawingId ? "" : "Not drawn yet")}</span>
        <div className="block-head-actions">
          {meta && (
            <Link className="block-icon-btn" to={`/canvas/${meta.id}`} title="Open in Canvas">
              <SquareArrowOutUpRight size={15} />
            </Link>
          )}
          {!missing && (
            <button type="button" className="block-btn" onClick={edit}>
              <PenLine size={14} strokeWidth={2.2} />
              <span>{drawingId ? "Edit drawing" : "Draw"}</span>
            </button>
          )}
        </div>
      </div>
      <div className="drawing-block-body">
        {missing ? (
          <div className="drawing-missing">This drawing was deleted from the Canvas.</div>
        ) : meta?.hasPreview ? (
          <img
            src={`/api/drawings/${meta.id}/preview.svg?v=${meta.updatedAt}`}
            alt={meta.title}
            draggable={false}
            onClick={edit}
            title="Click to edit"
          />
        ) : (
          <button type="button" className="block-empty" onClick={edit}>
            <span>{drawingId && isLoading ? "Loading…" : "Empty drawing — click to draw"}</span>
          </button>
        )}
      </div>
    </div>
  );
}
