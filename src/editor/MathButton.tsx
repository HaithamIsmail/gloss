import { useBlockNoteEditor, useComponentsContext } from "@blocknote/react";
import { Sigma } from "lucide-react";
import { schema } from "./schema";

/** Formatting-toolbar button: turns the selected text into an inline formula. */
export function MathButton() {
  const editor = useBlockNoteEditor(schema);
  const Components = useComponentsContext()!;
  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      mainTooltip="Formula (LaTeX)"
      label="Formula"
      icon={<Sigma size={16} />}
      onClick={() => {
        const latex = editor.getSelectedText().trim();
        editor.focus();
        editor.insertInlineContent([{ type: "math", props: { latex } }]);
      }}
    />
  );
}
