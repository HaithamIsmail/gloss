import { useBlockNoteEditor, useComponentsContext, useEditorState, usePortalElement } from "@blocknote/react";
import { Link2 } from "lucide-react";
import { useUI } from "../store";
import { schema } from "./schema";

const excerpt = (s: string, n = 42) => (s.length > n ? `${s.slice(0, n - 1)}…` : s || "No comment yet");

/** Formatting-toolbar menu: link the selected text to an image region. */
export function LinkRegionButton() {
  const editor = useBlockNoteEditor(schema);
  const Components = useComponentsContext()!;
  const portal = usePortalElement();
  const regions = useUI((s) => s.doc.regions);
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => (e?.getActiveStyles() as { annotation?: string } | undefined)?.annotation,
  });

  if (!regions.length) return null;

  return (
    <Components.Generic.Menu.Root portalElement={portal} position="bottom-start">
      <Components.Generic.Menu.Trigger>
        <Components.FormattingToolbar.Button
          className="bn-button"
          mainTooltip="Link to an image region"
          label="Link to region"
          icon={<Link2 size={16} />}
          isSelected={!!active}
        />
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown className="bn-menu-dropdown region-menu">
        <Components.Generic.Menu.Label>Link selection to region</Components.Generic.Menu.Label>
        {regions.map((r) => (
          <Components.Generic.Menu.Item
            key={r.id}
            checked={active === r.id}
            onClick={() => {
              editor.focus();
              editor.addStyles({ annotation: r.id });
            }}
          >
            <span className="region-menu-num">{r.n}</span> {excerpt(r.comment)}
          </Components.Generic.Menu.Item>
        ))}
        {active && (
          <>
            <Components.Generic.Menu.Divider />
            <Components.Generic.Menu.Item
              onClick={() => {
                editor.focus();
                editor.removeStyles({ annotation: active });
              }}
            >
              Remove link
            </Components.Generic.Menu.Item>
          </>
        )}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}
