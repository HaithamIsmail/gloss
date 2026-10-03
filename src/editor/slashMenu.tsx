import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { getDefaultReactSlashMenuItems, type DefaultReactSuggestionItem } from "@blocknote/react";
import { ImagePlus, MessageSquareText, PenTool, Radical, Sigma } from "lucide-react";
import { openDrawingForBlock } from "./DrawingBlock";
import type { StudyEditor } from "./schema";

// Sections and subsections are H1/H2: they are numbered and listed in the index.
const RENAME: Record<string, { title: string; subtext: string; aliases: string[] }> = {
  heading: { title: "Section", subtext: "Heading 1 · numbered, listed in the index", aliases: ["h1", "section", "#"] },
  heading_2: { title: "Subsection", subtext: "Heading 2 · numbered, listed in the index", aliases: ["h2", "subsection", "##"] },
  heading_3: { title: "Heading", subtext: "Heading 3 · small, not in the index", aliases: ["h3", "###"] },
};

/** Inserts `item` right after the last item of its group (or at the end). */
function insertIntoGroup(items: DefaultReactSuggestionItem[], item: DefaultReactSuggestionItem, first = false) {
  const indices = items.map((it, i) => (it.group === item.group ? i : -1)).filter((i) => i >= 0);
  if (!indices.length) items.push(item);
  else items.splice(first ? indices[0] : indices[indices.length - 1] + 1, 0, item);
}

export function getSlashItems(editor: StudyEditor): DefaultReactSuggestionItem[] {
  const items = getDefaultReactSlashMenuItems(editor).map((it) => {
    const key = (it as { key?: string }).key ?? "";
    const r = RENAME[key];
    return r ? { ...it, title: r.title, subtext: r.subtext, aliases: [...(it.aliases ?? []), ...r.aliases] } : it;
  });

  insertIntoGroup(
    items,
    {
      title: "Annotated image",
      subtext: "Upload an image, mark regions, comment on them",
      aliases: ["image", "img", "picture", "photo", "diagram", "figure", "annotate", "region"],
      group: "Media",
      icon: <ImagePlus size={18} />,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, { type: "annotatedImage" });
      },
    },
    true,
  );
  insertIntoGroup(items, {
    title: "Drawing",
    subtext: "Sketch or diagram on a canvas, then insert it",
    aliases: ["drawing", "draw", "sketch", "canvas", "excalidraw", "whiteboard", "diagram", "mindmap"],
    group: "Media",
    icon: <PenTool size={18} />,
    onItemClick: () => {
      const block = insertOrUpdateBlockForSlashMenu(editor, { type: "drawing" });
      openDrawingForBlock(editor, block.id);
    },
  });
  insertIntoGroup(items, {
    title: "Callout",
    subtext: "A boxed note, tip, warning or exam hint",
    aliases: ["callout", "note", "tip", "warning", "box", "exam"],
    group: "Basic blocks",
    icon: <MessageSquareText size={18} />,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, { type: "callout" });
    },
  });
  insertIntoGroup(items, {
    title: "Formula",
    subtext: "Display math in LaTeX, centred on its own line",
    aliases: ["math", "formula", "equation", "latex", "tex", "katex", "$$"],
    group: "Basic blocks",
    icon: <Sigma size={18} />,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, { type: "mathBlock" });
    },
  });
  insertIntoGroup(items, {
    title: "Inline formula",
    subtext: "Math inside a line of text (or select text and press Σ)",
    aliases: ["inline math", "math", "formula", "equation", "latex", "$"],
    group: "Basic blocks",
    icon: <Radical size={18} />,
    onItemClick: () => {
      editor.insertInlineContent([{ type: "math", props: { latex: "" } }]);
    },
  });
  return items;
}
