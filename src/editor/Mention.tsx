import { createReactInlineContentSpec, type DefaultReactSuggestionItem } from "@blocknote/react";
import { FileX, SquareDashed } from "lucide-react";
import { useNavigate } from "react-router";
import type { LinkTarget } from "../../shared/api";
import type { MentionProps } from "../../shared/content";
import { api, useTree } from "../api";
import { KIND_ICON } from "../kinds";
import { findMaterial } from "../tree";
import type { StudyEditor } from "./schema";

export const mentionHref = (p: Pick<MentionProps, "targetId" | "annotationId" | "blockId">) => {
  if (!p.annotationId) return `/m/${p.targetId}`;
  const q = new URLSearchParams(p.blockId ? { block: p.blockId, ann: p.annotationId } : { ann: p.annotationId });
  return `/m/${p.targetId}?${q}`;
};

/** A link to another material (or one region of an image), typed with "@". */
export const Mention = createReactInlineContentSpec(
  {
    type: "mention",
    propSchema: {
      targetId: { default: "" },
      annotationId: { default: "" },
      blockId: { default: "" },
      label: { default: "" },
    },
    content: "none",
  } as const,
  { render: ({ inlineContent }) => <MentionChip {...inlineContent.props} /> },
);

export function MentionChip(p: MentionProps) {
  const { data: tree } = useTree();
  const navigate = useNavigate();
  const { material, folder, course } = findMaterial(tree, p.targetId);
  const missing = !!tree && !material;
  const region = !!p.annotationId;
  const title = material?.title || p.label || "Untitled";
  const Icon = missing ? FileX : region ? SquareDashed : KIND_ICON[material?.kind ?? "doc"];
  const href = mentionHref(p);
  const where = [course?.name, folder?.title, region ? material?.title : null].filter(Boolean).join(" / ");

  return (
    <a
      className={`mention${missing ? " is-missing" : ""}${region ? " is-region" : ""}`}
      href={href}
      contentEditable={false}
      title={missing ? "This material was deleted or moved to the trash" : where}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        if (!missing) navigate(href);
      }}
    >
      <Icon size={13} strokeWidth={2.2} />
      <span className="mention-label">{region ? p.label || "Region" : title}</span>
      {region && material && <span className="mention-in">{material.title}</span>}
    </a>
  );
}

const excerpt = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Items for the "@" menu: materials, then (when searching) commented regions. */
export async function getMentionItems(editor: StudyEditor, query: string): Promise<DefaultReactSuggestionItem[]> {
  let targets: LinkTarget[] = [];
  try {
    targets = await api.linkTargets(query);
  } catch {
    return [];
  }
  return targets.map((t) => {
    const Icon = KIND_ICON[t.materialKind];
    return {
      title: t.kind === "region" ? excerpt(t.title) : t.title,
      subtext: t.path,
      group: t.kind === "region" ? "Regions" : "Pages",
      icon: t.kind === "region" ? <span className="region-menu-num">{t.n}</span> : <Icon size={16} />,
      onItemClick: () => {
        const props: MentionProps = {
          targetId: t.materialId,
          annotationId: t.annotationId ?? "",
          blockId: t.blockId ?? "",
          label: excerpt(t.title, 80),
        };
        editor.insertInlineContent([{ type: "mention", props }, " "]);
      },
    };
  });
}
