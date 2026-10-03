import type { SearchResult } from "../shared/api";
import {
  ANNOTATED_IMAGE,
  buildOutline,
  contentText,
  isSectionHeading,
  parseAnnotations,
  walkBlocks,
  type LooseBlock,
} from "../shared/content";
import { asFolder, asImagePage, asNotebook, markdownHeadings, notebookOutline, headingId } from "../shared/pages";
import { allDrawingText, allMaterialsWithContent, getTree } from "./repo";

const LIMIT = 40;

/** A short excerpt of `text` centred on the first match of `q`. */
function snippet(text: string, q: string, width = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const i = flat.toLowerCase().indexOf(q);
  if (i < 0 || flat.length <= width) return flat.slice(0, width);
  const start = Math.max(0, i - Math.floor(width / 3));
  const end = Math.min(flat.length, start + width);
  return (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "");
}

export function search(raw: string): SearchResult[] {
  const q = raw.trim().toLowerCase();
  const out: SearchResult[] = [];
  const hit = (s: string) => s.toLowerCase().includes(q);

  // Empty query: list courses and materials, a quick jump list.
  if (!q) {
    for (const c of getTree().courses) {
      out.push({ kind: "Course", label: "Course", title: c.name, path: c.code || "—", courseId: c.id });
      for (const m of c.materials) {
        out.push({ kind: "Material", label: "Material", title: m.title, path: c.name, courseId: c.id, materialId: m.id });
      }
    }
    for (const d of allDrawingText().slice(0, 8)) {
      out.push({ kind: "Drawing", label: "Drawing", title: d.title, path: d.courseName ?? "Canvas", drawingId: d.id });
    }
    return out.slice(0, LIMIT);
  }

  for (const c of getTree().courses) {
    if (hit(c.name) || hit(c.code)) {
      out.push({ kind: "Course", label: "Course", title: c.name, path: c.code || "—", courseId: c.id });
    }
  }

  for (const m of allMaterialsWithContent()) {
    // Slides imported from a file sit in a folder: show it in the path.
    const where = m.folderTitle ? `${m.courseName} / ${m.folderTitle}` : m.courseName;
    const path = `${where} / ${m.title}`;
    const base = { courseId: m.courseId, materialId: m.id };
    if (hit(m.title)) {
      const label = m.kind !== "folder" ? "Material" : asFolder(m.content).source ? "Slides" : "Folder";
      out.push({ kind: "Material", label, title: m.title, path: where, ...base });
    }
    if (m.kind === "folder") continue;

    if (m.kind === "image") {
      const page = asImagePage(m.content);
      page.annotations.forEach((a, i) => {
        if (a.comment && hit(a.comment)) {
          out.push({ kind: "Comment", label: `Region ${i + 1}`, title: snippet(a.comment, q), path, ...base, annotationId: a.id });
        }
      });
      if (page.text && hit(page.text) && !hit(m.title)) {
        out.push({ kind: "Text", label: "Slide text", title: snippet(page.text, q), path, ...base });
      }
      continue;
    }

    if (m.kind === "notebook") {
      const nb = asNotebook(m.content);
      const nums = new Map(notebookOutline(nb).map((o) => [o.id, o.num]));
      for (const cell of nb.cells) {
        if (!cell.source || !hit(cell.source)) continue;
        if (cell.cell_type === "code") {
          out.push({ kind: "Code", label: "Code", title: snippet(cell.source, q), path, ...base, blockId: cell.id });
          continue;
        }
        const headings = markdownHeadings(cell.source);
        const k = headings.findIndex((h) => hit(h.text));
        if (k >= 0) {
          const h = headings[k];
          const id = headingId(cell.id, k);
          out.push({
            kind: h.level === 1 ? "Section" : "Subsection",
            label: `${h.level === 1 ? "Section" : "Subsection"} ${nums.get(id) ?? ""}`.trim(),
            title: h.text,
            path,
            ...base,
            blockId: id,
          });
        } else {
          out.push({ kind: "Text", label: "Text", title: snippet(cell.source, q), path, ...base, blockId: cell.id });
        }
      }
      continue;
    }

    const blocks = (Array.isArray(m.content) ? m.content : []) as LooseBlock[];
    const nums = new Map(buildOutline(blocks).map((o) => [o.id, o.num]));
    let region = 0;
    walkBlocks(blocks, (b) => {
      if (b.type === ANNOTATED_IMAGE) {
        for (const a of parseAnnotations(b.props?.annotations)) {
          region++;
          if (a.comment && hit(a.comment)) {
            out.push({
              kind: "Comment",
              label: `Region ${region}`,
              title: snippet(a.comment, q),
              path,
              ...base,
              blockId: b.id,
              annotationId: a.id,
            });
          }
        }
        return;
      }
      const text = contentText(b.content);
      if (!text || !hit(text)) return;
      const level = isSectionHeading(b);
      if (level) {
        out.push({
          kind: level === 1 ? "Section" : "Subsection",
          label: `${level === 1 ? "Section" : "Subsection"} ${nums.get(b.id) ?? ""}`.trim(),
          title: text,
          path,
          ...base,
          blockId: b.id,
        });
      } else {
        out.push({ kind: "Text", label: "Text", title: snippet(text, q), path, ...base, blockId: b.id });
      }
    });
    if (out.length > LIMIT * 2) break;
  }

  for (const d of allDrawingText()) {
    const inTitle = hit(d.title);
    if (!inTitle && !hit(d.text)) continue;
    out.push({
      kind: "Drawing",
      label: "Drawing",
      title: inTitle ? d.title : d.title + " — " + snippet(d.text, q, 60),
      path: d.courseName ?? "Canvas",
      drawingId: d.id,
    });
  }

  const rank: Record<SearchResult["kind"], number> = {
    Course: 0,
    Material: 1,
    Section: 2,
    Subsection: 3,
    Comment: 4,
    Drawing: 5,
    Text: 6,
    Code: 7,
  };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, LIMIT);
}
