import { useBlockNoteEditor, useComponentsContext, useEditorState } from "@blocknote/react";
import { ImagePlus } from "lucide-react";
import { ANNOTATED_IMAGE } from "../../shared/content";
import { schema } from "./schema";

/** Image toolbar button: turns a plain image block into an annotated one. */
export function AnnotateButton() {
  const editor = useBlockNoteEditor(schema);
  const Components = useComponentsContext()!;
  const block = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const blocks = e?.getSelection()?.blocks ?? [e?.getTextCursorPosition().block];
      const b = blocks.length === 1 ? blocks[0] : undefined;
      return b?.type === "image" && b.props.url ? { id: b.id, url: b.props.url, name: b.props.name } : null;
    },
  });

  if (!block) return null;

  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      mainTooltip="Annotate: mark regions and comment on them"
      label="Annotate"
      icon={<ImagePlus size={16} />}
      onClick={() => {
        editor.updateBlock(block.id, {
          type: ANNOTATED_IMAGE,
          props: { url: block.url, name: block.name || "image", annotations: "[]", layout: "side" },
        });
      }}
    />
  );
}
