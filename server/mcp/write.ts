// Tools that change courses, structure, pages and notebooks. Every content
// change stores the previous content as a version first, so History can undo it.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MaterialSummary } from "../../shared/api";
import type { LooseBlock } from "../../shared/content";
import { asNotebook, emptyNotebook, newCell, type NotebookCell } from "../../shared/pages";
import * as repo from "../repo";
import { UserError } from "../repo";
import { blocksField, changed, contentIn, markdownField, needCourse, needMaterial, summary, tool, treeChanged } from "./common";

const course = (c: { id: string; name: string; code: string }) => ({ id: c.id, name: c.name, code: c.code });

/** Saves new content as an agent edit: always versioned, and open tabs reload. */
function saveContent(id: string, content: unknown): MaterialSummary {
  const m = repo.updateMaterial(id, { content }, { snapshot: "force" });
  if (!m) throw new UserError(`No material with id "${id}".`);
  changed(m);
  return m;
}

/** Where a block sits in a page (nested ones too). */
function locate(blocks: LooseBlock[], id: string): { list: LooseBlock[]; index: number } | null {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].id === id) return { list: blocks, index: i };
    const inner = blocks[i].children?.length ? locate(blocks[i].children!, id) : null;
    if (inner) return inner;
  }
  return null;
}

const pageOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("replace_block"),
    id: z.string().describe("Block to replace (with its nested blocks)."),
    markdown: markdownField.optional(),
    blocks: blocksField.optional(),
  }),
  z.object({ op: z.literal("insert_after"), id: z.string(), markdown: markdownField.optional(), blocks: blocksField.optional() }),
  z.object({ op: z.literal("insert_before"), id: z.string(), markdown: markdownField.optional(), blocks: blocksField.optional() }),
  z.object({ op: z.literal("delete_block"), id: z.string() }),
  z.object({ op: z.literal("replace_all"), markdown: markdownField.optional(), blocks: blocksField.optional() }),
]);

const notebookOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_cell"),
    after: z.string().optional().describe('Cell id to insert after; "start" for the top; omit to add at the end.'),
    type: z.enum(["code", "markdown"]),
    source: z.string(),
  }),
  z.object({ op: z.literal("replace_cell"), id: z.string(), source: z.string() }),
  z.object({ op: z.literal("delete_cell"), id: z.string() }),
]);

/** The midpoint between the neighbours, as the app does when you drag. */
function positionBeside(refId: string, side: "before" | "after", movingId: string) {
  const ref = needMaterial(refId);
  if (ref.id === movingId) throw new UserError("A material can't be placed next to itself.");
  const sibs = (ref.courseId ? needCourse(ref.courseId).materials : repo.getTree().library)
    .filter((m) => m.parentId === ref.parentId && m.id !== movingId)
    .sort((a, b) => a.position - b.position);
  const i = sibs.findIndex((m) => m.id === ref.id);
  const other = sibs[side === "before" ? i - 1 : i + 1];
  const position = other ? (other.position + ref.position) / 2 : ref.position + (side === "before" ? -1 : 1);
  return { courseId: ref.courseId, parentId: ref.parentId, position };
}

export function registerWriteTools(server: McpServer) {
  // ── Courses and structure ──────────────────────────────────────────────
  tool(
    server,
    "create_course",
    {
      title: "Create a course",
      description: "Creates an empty course at the end of the list. Returns its id, name and code.",
      input: { name: z.string().min(1), code: z.string().optional().describe('Short code, e.g. "MATH 221".') },
    },
    ({ name, code }) => {
      const c = repo.createCourse({ name, code: code ?? "" });
      treeChanged();
      return course(c);
    },
  );

  tool(
    server,
    "update_course",
    {
      title: "Rename a course",
      description: "Changes a course's name and/or code. Returns the course.",
      input: { id: z.string(), name: z.string().min(1).optional(), code: z.string().optional() },
    },
    ({ id, name, code }) => {
      needCourse(id);
      const c = repo.updateCourse(id, { name, code })!;
      treeChanged();
      return course(c);
    },
  );

  tool(
    server,
    "create_folder",
    {
      title: "Create a folder",
      description: "Creates a folder at the top level of a course (folders don't nest). Returns its summary.",
      input: { courseId: z.string(), title: z.string().min(1) },
    },
    ({ courseId, title }) => {
      needCourse(courseId);
      const m = repo.createMaterial(courseId, { kind: "folder", title })!;
      treeChanged();
      return summary(m);
    },
  );

  tool(
    server,
    "move_material",
    {
      title: "Move a material",
      description:
        "Moves a material to another course, into or out of a folder (parentId; null for the top level), or next to another material (before/after, which also picks its course and folder). Returns the new summary.",
      input: {
        id: z.string(),
        courseId: z.string().nullable().optional().describe("Target course (null puts a book in the library only)."),
        parentId: z.string().nullable().optional().describe("Target folder, or null for the course's top level."),
        before: z.string().optional().describe("Place just before this material."),
        after: z.string().optional().describe("Place just after this material."),
      },
    },
    ({ id, courseId, parentId, before, after }) => {
      needMaterial(id);
      if (before && after) throw new UserError("Give before or after, not both.");
      const ref = before ?? after;
      const patch = ref ? positionBeside(ref, before ? "before" : "after", id) : { courseId, parentId };
      if (courseId !== undefined && ref && courseId !== patch.courseId) {
        throw new UserError("That material is in another course than the one given.");
      }
      if (patch.courseId === undefined && patch.parentId === undefined) throw new UserError("Say where: courseId, parentId, before or after.");
      const m = repo.updateMaterial(id, patch)!;
      treeChanged();
      return summary(m);
    },
  );

  tool(
    server,
    "rename_material",
    {
      title: "Rename a material",
      description: "Changes a material's title. Returns its summary.",
      input: { id: z.string(), title: z.string().min(1) },
    },
    ({ id, title }) => {
      needMaterial(id);
      const m = repo.updateMaterial(id, { title })!;
      treeChanged();
      return summary(m);
    },
  );

  // ── Pages ──────────────────────────────────────────────────────────────
  tool(
    server,
    "create_page",
    {
      title: "Create a page",
      description: "Creates a page in a course (optionally inside a folder) from Markdown, or from raw blocks. Returns its summary with the numbered outline.",
      input: {
        courseId: z.string(),
        title: z.string().min(1),
        markdown: markdownField.optional(),
        blocks: blocksField.optional(),
        parentId: z.string().optional().describe("A folder in that course."),
      },
    },
    ({ courseId, title, markdown, blocks, parentId }) => {
      needCourse(courseId);
      const content = markdown === undefined && !blocks ? [] : contentIn({ markdown, blocks });
      const m = repo.createMaterial(courseId, { kind: "doc", title, content, parentId: parentId ?? null })!;
      treeChanged();
      return summary(m);
    },
  );

  tool(
    server,
    "append_to_page",
    {
      title: "Add to the end of a page",
      description: "Adds Markdown (or raw blocks) to the end of a page. Returns the page summary and the new block ids.",
      input: { id: z.string(), markdown: markdownField.optional(), blocks: blocksField.optional() },
    },
    ({ id, markdown, blocks }) => {
      const m = needMaterial(id, "doc");
      const added = contentIn({ markdown, blocks });
      const s = saveContent(id, [...(m.content as LooseBlock[]), ...added]);
      return { ...summary(s), added: added.map((b) => b.id) };
    },
  );

  tool(
    server,
    "edit_page",
    {
      title: "Edit a page",
      description:
        "Applies operations to a page in order, all or nothing: replace_block, insert_after, insert_before, delete_block (by block id from get_material, nested blocks included) and replace_all. Blocks you don't touch stay exactly as they are. Returns the page summary and the ids each operation produced.",
      input: { id: z.string(), operations: z.array(pageOp).min(1) },
    },
    ({ id, operations }) => {
      const m = needMaterial(id, "doc");
      let blocks = structuredClone(Array.isArray(m.content) ? (m.content as LooseBlock[]) : []);
      const results: { op: string; ids: string[] }[] = [];
      operations.forEach((op, n) => {
        const where = `Operation ${n + 1} (${op.op})`;
        if (op.op === "replace_all") {
          blocks = contentIn(op, { reusable: blocks }, `${where}: markdown or blocks`);
          return void results.push({ op: op.op, ids: blocks.map((b) => b.id) });
        }
        const at = locate(blocks, op.id);
        if (!at) throw new UserError(`${where}: no block with id "${op.id}" on this page. Nothing was changed.`);
        if (op.op === "delete_block") {
          at.list.splice(at.index, 1);
          return void results.push({ op: op.op, ids: [] });
        }
        const old = at.list[at.index];
        const made = contentIn(op, op.op === "replace_block" ? { reusable: [old] } : {}, `${where}: markdown or blocks`);
        if (op.op === "replace_block") at.list.splice(at.index, 1, ...made);
        else at.list.splice(op.op === "insert_after" ? at.index + 1 : at.index, 0, ...made);
        results.push({ op: op.op, ids: made.map((b) => b.id) });
      });
      const ids = new Set<string>();
      const dup = (bs: LooseBlock[]): string | null => {
        for (const b of bs) {
          if (ids.has(b.id)) return b.id;
          ids.add(b.id);
          const d = dup(b.children ?? []);
          if (d) return d;
        }
        return null;
      };
      const d = dup(blocks);
      if (d) throw new UserError(`Block id "${d}" would appear twice on the page. Leave ids out of new blocks. Nothing was changed.`);
      return { ...summary(saveContent(id, blocks)), results };
    },
  );

  // ── Notebooks ──────────────────────────────────────────────────────────
  tool(
    server,
    "create_notebook",
    {
      title: "Create a notebook",
      description: "Creates a Python notebook with the given cells (no outputs; run them in the app). Returns its summary and cell ids.",
      input: {
        courseId: z.string(),
        title: z.string().min(1),
        cells: z.array(z.object({ type: z.enum(["code", "markdown"]), source: z.string() })),
        parentId: z.string().optional(),
      },
    },
    ({ courseId, title, cells, parentId }) => {
      needCourse(courseId);
      const content = { ...emptyNotebook(), cells: cells.map((c) => newCell(c.type, c.source)) };
      const m = repo.createMaterial(courseId, { kind: "notebook", title, content, parentId: parentId ?? null })!;
      treeChanged();
      return { ...summary(m), cells: asNotebook(m.content).cells.map((c) => c.id) };
    },
  );

  tool(
    server,
    "edit_notebook",
    {
      title: "Edit a notebook",
      description:
        "Applies cell operations in order, all or nothing: add_cell, replace_cell (a code cell's outputs are cleared) and delete_cell. Code is never run over MCP. Returns the notebook's cells (id, type).",
      input: { id: z.string(), operations: z.array(notebookOp).min(1) },
    },
    ({ id, operations }) => {
      const nb = asNotebook(needMaterial(id, "notebook").content);
      const cells: NotebookCell[] = nb.cells;
      const find = (cid: string, where: string) => {
        const i = cells.findIndex((c) => c.id === cid);
        if (i < 0) throw new UserError(`${where}: no cell with id "${cid}". Nothing was changed.`);
        return i;
      };
      const added: string[] = [];
      operations.forEach((op, n) => {
        const where = `Operation ${n + 1} (${op.op})`;
        if (op.op === "add_cell") {
          const cell = newCell(op.type, op.source);
          const at = op.after === undefined ? cells.length : op.after === "start" ? 0 : find(op.after, where) + 1;
          cells.splice(at, 0, cell);
          added.push(cell.id);
        } else if (op.op === "replace_cell") {
          const c = cells[find(op.id, where)];
          c.source = op.source;
          if (c.cell_type === "code") Object.assign(c, { outputs: [], execution_count: null });
        } else {
          cells.splice(find(op.id, where), 1);
        }
      });
      const s = saveContent(id, { ...nb, cells });
      return { ...summary(s), added, cells: cells.map((c) => ({ id: c.id, type: c.cell_type })) };
    },
  );
}
