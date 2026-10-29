import { createReactInlineContentSpec, type DefaultReactSuggestionItem } from "@blocknote/react";
import { FileText, FileX, Highlighter, SquareDashed } from "lucide-react";
import { useNavigate } from "react-router";
import type { LinkTarget } from "../../shared/api";
import { mentionPage, type MentionProps } from "../../shared/content";
import { api, useTree } from "../api";
import { KIND_ICON } from "../kinds";
import { findMaterial } from "../tree";
import type { StudyEditor } from "./schema";

export const mentionHref = (p: Pick<MentionProps, "targetId" | "annotationId" | "blockId">) => {
  if (!p.annotationId) return `/m/${p.targetId}`;
  const page = mentionPage(p.annotationId);
  if (page) return `/m/${p.targetId}?page=${page}`;
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
  const book = material?.kind === "book";
  const page = mentionPage(p.annotationId);
  const region = !!p.annotationId; // a region, a highlight or a page: shown as "label in Title"
  const title = material?.title || p.label || "Untitled";
  const Icon = missing ? FileX : page ? FileText : region ? (book ? Highlighter : SquareDashed) : KIND_ICON[material?.kind ?? "doc"];
  const href = mentionHref(p);
  const where = [course?.name ?? (material && !material.courseId ? "Library" : null), folder?.title, region ? material?.title : null]
    .filter(Boolean)
    .join(" / ");
  const hint = missing
    ? "This material was deleted or moved to the trash"
    : book
      ? `${where} · opens in a new tab${page ? ` at page ${page}` : region ? " at this highlight" : ""}`
      : where;

  return (
    <a
      className={`mention${missing ? " is-missing" : ""}${region ? " is-region" : ""}${book ? " is-book" : ""}`}
      href={href}
      target={book ? "_blank" : undefined}
      rel={book ? "noreferrer" : undefined}
      contentEditable={false}
      title={hint}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
        if (missing) return e.preventDefault();
        // Books open in their own tab, so the notes stay where they are.
        if (book) return;
        e.preventDefault();
        navigate(href);
      }}
    >
      <Icon size={13} strokeWidth={2.2} />
      <span className="mention-label">{page ? `p. ${page}` : region ? p.label || (book ? "Highlight" : "Region") : title}</span>
      {region && material && <span className="mention-in">{material.title}</span>}
    </a>
  );
}

const excerpt = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const GROUP: Record<LinkTarget["kind"], string> = {
  material: "Pages",
  page: "Book pages",
  region: "Regions",
  highlight: "Book highlights",
};

/** Items for the "@" menu: materials, then (when searching) book pages, commented regions and highlights. */
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
      title: t.kind === "material" ? t.title : excerpt(t.title),
      subtext: t.path,
      group: GROUP[t.kind],
      icon:
        t.kind === "material" ? <Icon size={16} />
        : t.kind === "page" ? <FileText size={16} />
        : <span className="region-menu-num">{t.n}</span>,
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
