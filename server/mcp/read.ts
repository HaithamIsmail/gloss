// Read-only tools: the tree, search, one material in a form agents can use, links, history.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Material, MaterialSummary } from "../../shared/api";
import type { LooseBlock } from "../../shared/content";
import {
  asArtifact,
  asBook,
  asFolder,
  asImagePage,
  asNotebook,
  BOOK_STATUS_LABEL,
  bookProgressLabel,
  type NotebookOutput,
} from "../../shared/pages";
import { blocksToMarkdown } from "../export";
import * as repo from "../repo";
import { search } from "../search";
import { needCourse, needMaterial, tool } from "./common";

const item = (m: MaterialSummary) => ({
  id: m.id,
  kind: m.kind,
  title: m.title,
  parentId: m.parentId,
  ...(m.outline.length ? { outline: m.outline.map((o) => `${o.num} ${o.text}`) } : {}),
});

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const joinText = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join("") : (v ?? ""));
const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}… (${s.length} characters)` : s);

/** A line or two per output: text clipped, images and HTML named only. */
function outputSummary(o: NotebookOutput): string {
  if (o.output_type === "stream") return `${o.name}: ${clip(joinText(o.text).replace(ANSI, "").trimEnd())}`;
  if (o.output_type === "error") return `error: ${o.ename}: ${clip(o.evalue)}`;
  const kinds = Object.keys(o.data);
  const plain = o.data["text/plain"];
  const rich = kinds.filter((k) => k !== "text/plain").join(", ");
  return [plain ? clip(joinText(plain).replace(ANSI, "")) : "", rich ? `[${rich}]` : ""].filter(Boolean).join(" ");
}

/** A material in the form agents read: Markdown for pages, cells for notebooks, details for the rest. */
export function describeMaterial(m: Material, format: "markdown" | "blocks" = "markdown") {
  const base = { id: m.id, kind: m.kind, title: m.title, courseId: m.courseId, parentId: m.parentId, updatedAt: m.updatedAt };
  switch (m.kind) {
    case "doc": {
      const blocks = Array.isArray(m.content) ? (m.content as LooseBlock[]) : [];
      return format === "blocks" ? { ...base, blocks } : { ...base, markdown: blocksToMarkdown(blocks, { ids: true }) };
    }
    case "notebook": {
      const nb = asNotebook(m.content);
      return {
        ...base,
        cells: nb.cells.map((c) => ({
          id: c.id,
          type: c.cell_type,
          source: c.source,
          ...(c.cell_type === "code" && c.outputs.length ? { outputs: c.outputs.map(outputSummary) } : {}),
        })),
      };
    }
    case "image": {
      const p = asImagePage(m.content);
      return {
        ...base,
        url: p.url,
        name: p.name,
        ...(p.text ? { slideText: p.text } : {}),
        annotations: p.annotations.map((a, i) => ({ n: i + 1, id: a.id, comment: a.comment, x: a.x, y: a.y, w: a.w, h: a.h })),
      };
    }
    case "book": {
      const b = asBook(m.content);
      return {
        ...base,
        file: { name: b.file.name, format: b.file.format, url: b.file.url },
        meta: b.meta,
        length: b.length,
        status: BOOK_STATUS_LABEL[b.status],
        progress: bookProgressLabel(b),
        highlights: b.highlights.map((h) => ({
          id: h.id,
          where: h.loc.kind === "pdf" ? `p. ${h.loc.page}` : `${Math.round(h.at * 100)}%`,
          quote: h.quote,
          note: h.note,
        })),
      };
    }
    case "artifact": {
      const a = asArtifact(m.content);
      return { ...base, description: a.description, entry: a.entry, ...(a.source ? { source: a.source } : {}), files: a.files };
    }
    case "folder": {
      const kids = m.courseId ? needCourse(m.courseId).materials.filter((x) => x.parentId === m.id) : [];
      const src = asFolder(m.content).source;
      return { ...base, ...(src ? { source: src } : {}), children: kids.map(item) };
    }
  }
}

export function registerReadTools(server: McpServer) {
  tool(
    server,
    "get_tree",
    {
      title: "Get the course tree",
      description:
        "Lists every course with its materials (id, kind, title, parentId for pages in a folder, numbered outline headings) and the library's books. Give courseId to see one course.",
      input: { courseId: z.string().optional().describe("Only this course.") },
      readOnly: true,
    },
    ({ courseId }) => {
      const tree = repo.getTree();
      const courses = tree.courses
        .filter((c) => !courseId || c.id === courseId)
        .map((c) => ({ id: c.id, name: c.name, code: c.code, materials: c.materials.map(item) }));
      if (courseId && !courses.length) needCourse(courseId);
      return courseId ? { courses } : { courses, library: tree.library.map(item) };
    },
  );

  tool(
    server,
    "search",
    {
      title: "Search",
      description:
        "Searches course names, titles, headings, page text, code, region comments, book highlights and drawings. Returns up to 40 hits with the material id and, for a passage, its block or region id.",
      input: { query: z.string().describe("Words to look for.") },
      readOnly: true,
    },
    ({ query }) => search(query),
  );

  tool(
    server,
    "get_material",
    {
      title: "Read a material",
      description:
        "Returns one material. A page comes as Markdown with `<!-- id: … -->` before each block (use those ids with edit_page), or as BlockNote JSON with format 'blocks'. A notebook gives its cells (id, type, source, output summary); an image page its URL and regions; a book its details and highlights; an artifact its files; a folder its pages.",
      input: {
        id: z.string().describe("Material id."),
        format: z.enum(["markdown", "blocks"]).optional().describe("For pages: 'markdown' (default) or 'blocks'."),
      },
      readOnly: true,
    },
    ({ id, format }) => describeMaterial(needMaterial(id), format),
  );

  tool(
    server,
    "get_backlinks",
    {
      title: "Pages linking here",
      description: "Lists the pages that link to this material (or its regions) with @ mentions: id, title, kind, course and link count.",
      input: { id: z.string().describe("Material id.") },
      readOnly: true,
    },
    ({ id }) => (needMaterial(id), repo.backlinks(id)),
  );

  tool(
    server,
    "list_versions",
    {
      title: "List earlier versions",
      description: "Lists the stored earlier versions of a material (id, title, time, size), newest first, for restore_version.",
      input: { id: z.string().describe("Material id.") },
      readOnly: true,
    },
    ({ id }) => {
      needMaterial(id);
      return repo.listVersions(id).map((v) => ({ ...v, at: new Date(v.createdAt).toISOString() }));
    },
  );

  tool(
    server,
    "list_books",
    {
      title: "List books",
      description: "Lists every book in the library: id, title, authors, status, where you are, course, and highlight count.",
      input: {},
      readOnly: true,
    },
    () =>
      repo.listBooks().map((b) => ({
        id: b.id,
        title: b.title,
        authors: b.book.meta.authors,
        status: BOOK_STATUS_LABEL[b.book.status],
        progress: bookProgressLabel(b.book),
        course: b.courseName || null,
        highlights: b.book.highlights.length,
      })),
  );

  tool(
    server,
    "list_trash",
    {
      title: "List the trash",
      description: "Lists what is in the trash (kept 30 days): trash id, kind, title, where it was, and when it was deleted.",
      input: {},
      readOnly: true,
    },
    () => repo.listTrash().map((t) => ({ ...t, deletedAt: new Date(t.deletedAt).toISOString() })),
  );
}
