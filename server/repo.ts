import { nanoid } from "nanoid";
import type {
  Backlink,
  BookListItem,
  BookPatch,
  Course,
  Drawing,
  DrawingScene,
  DrawingSummary,
  LinkTarget,
  Material,
  MaterialSummary,
  TrashItem,
  TrashKind,
  Tree,
  Version,
  VersionSummary,
} from "../shared/api";
import {
  ANNOTATED_IMAGE,
  contentText,
  extractMentions,
  parseAnnotations,
  sceneText,
  walkBlocks,
  type LooseBlock,
} from "../shared/content";
import {
  asBook,
  asBookHighlight,
  asBookLoc,
  asBookMeta,
  asImagePage,
  defaultContentFor,
  type BookContent,
  type FolderSource,
  type ImagePageContent,
  isMaterialKind,
  normalizeContent,
  outlineFor,
  regionsFor,
  type MaterialKind,
} from "../shared/pages";
import { db, tx } from "./db";

/** A failed request with a message for the user (sent with this HTTP status). */
export class UserError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type CourseRow = { id: string; name: string; code: string; position: number };
type MaterialRow = {
  id: string;
  /** NULL for a book that lives in the library only. */
  course_id: string | null;
  parent_id: string | null;
  kind: string;
  title: string;
  content?: string;
  outline: string;
  regions: number;
  position: number;
  updated_at: number;
};

const SUMMARY_COLS = "id, course_id, parent_id, kind, title, outline, regions, position, updated_at";
const m_ = (cols: string) => cols.split(", ").map((c) => `m.${c}`).join(", ");

function toSummary(r: MaterialRow): MaterialSummary {
  return {
    id: r.id,
    courseId: r.course_id ?? null,
    parentId: r.parent_id ?? null,
    kind: isMaterialKind(r.kind) ? r.kind : "doc",
    title: r.title,
    position: r.position,
    outline: JSON.parse(r.outline),
    regions: r.regions,
    updatedAt: r.updated_at,
  };
}

const kindOf = (r: { kind: string }): MaterialKind => (isMaterialKind(r.kind) ? r.kind : "doc");

function nextCoursePosition(): number {
  const row = db.prepare(`SELECT MAX(position) AS p FROM courses`).get() as { p: number | null };
  return (row.p ?? 0) + 1;
}

/** End position inside a course's top level, or inside a folder. */
function nextMaterialPosition(courseId: string | null, parentId: string | null): number {
  const row = db
    .prepare(`SELECT MAX(position) AS p FROM materials WHERE course_id IS ? AND parent_id IS ? AND deleted_at IS NULL`)
    .get(courseId, parentId) as { p: number | null };
  return (row.p ?? 0) + 1;
}

// ── Courses ──────────────────────────────────────────────────────────────

export function getTree(): Tree {
  const courses = db
    .prepare(`SELECT id, name, code, position FROM courses WHERE deleted_at IS NULL ORDER BY position`)
    .all() as CourseRow[];
  const materials = db
    .prepare(`SELECT ${SUMMARY_COLS} FROM materials WHERE deleted_at IS NULL ORDER BY position`)
    .all() as MaterialRow[];
  const byCourse = new Map<string, MaterialSummary[]>();
  const library: MaterialSummary[] = [];
  for (const m of materials) {
    if (!m.course_id) {
      library.push(toSummary(m));
      continue;
    }
    const list = byCourse.get(m.course_id) ?? [];
    list.push(toSummary(m));
    byCourse.set(m.course_id, list);
  }
  return { courses: courses.map((c) => ({ ...c, materials: byCourse.get(c.id) ?? [] })), library };
}

export function getCourse(id: string): Course | null {
  const row = db
    .prepare(`SELECT id, name, code, position FROM courses WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as CourseRow | undefined;
  if (!row) return null;
  const materials = db
    .prepare(`SELECT ${SUMMARY_COLS} FROM materials WHERE course_id = ? AND deleted_at IS NULL ORDER BY position`)
    .all(id) as MaterialRow[];
  return { ...row, materials: materials.map(toSummary) };
}

export function createCourse(input: { name?: string; code?: string }): Course {
  const id = nanoid(10);
  const now = Date.now();
  db.prepare(
    `INSERT INTO courses (id, name, code, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.name ?? "Untitled course", input.code ?? "", nextCoursePosition(), now, now);
  return getCourse(id)!;
}

export function updateCourse(
  id: string,
  patch: { name?: string; code?: string; position?: number },
): Course | null {
  const cur = getCourse(id);
  if (!cur) return null;
  db.prepare(`UPDATE courses SET name = ?, code = ?, position = ?, updated_at = ? WHERE id = ?`).run(
    patch.name ?? cur.name,
    patch.code ?? cur.code,
    patch.position ?? cur.position,
    Date.now(),
    id,
  );
  return getCourse(id);
}

// ── Materials ────────────────────────────────────────────────────────────

function materialRow(id: string, withContent = false): MaterialRow | undefined {
  return db
    .prepare(`SELECT ${SUMMARY_COLS}${withContent ? ", content" : ""} FROM materials WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as MaterialRow | undefined;
}

export function getMaterial(id: string): Material | null {
  const row = materialRow(id, true);
  if (!row) return null;
  return { ...toSummary(row), content: JSON.parse(row.content ?? "[]") };
}

const DEFAULT_TITLES: Record<MaterialKind, string> = {
  doc: "Untitled material",
  image: "Untitled image",
  notebook: "Untitled notebook",
  folder: "Untitled folder",
  book: "Untitled book",
};

/** A folder that can hold `kind` in `courseId` (folders don't nest). */
function checkParent(parentId: string | null, courseId: string | null, kind: MaterialKind, selfId?: string) {
  if (!parentId) return;
  if (!courseId) throw new UserError("A book outside a course can't be in a folder.");
  const parent = materialRow(parentId);
  if (!parent || kindOf(parent) !== "folder") throw new UserError("That folder doesn't exist.");
  if (parent.course_id !== courseId) throw new UserError("That folder is in another course.");
  if (parentId === selfId) throw new UserError("A folder can't go inside itself.");
  if (kind === "folder") throw new UserError("Folders can't go inside other folders.");
}

/** Creates a material in a course, or (books only) in the library with no course (`courseId` null). */
export function createMaterial(
  courseId: string | null,
  input: { title?: string; kind?: MaterialKind; content?: unknown; parentId?: string | null },
): Material | null {
  if (courseId && !getCourse(courseId)) return null;
  const id = nanoid(10);
  const now = Date.now();
  const kind: MaterialKind = isMaterialKind(input.kind) ? input.kind : "doc";
  if (!courseId && kind !== "book") throw new UserError("Only books can live outside a course.");
  const parentId = input.parentId ?? null;
  checkParent(parentId, courseId, kind);
  const content = normalizeContent(kind, input.content ?? defaultContentFor(kind, () => nanoid(10)));
  db.prepare(
    `INSERT INTO materials (id, course_id, parent_id, kind, title, content, outline, regions, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    courseId,
    parentId,
    kind,
    input.title ?? DEFAULT_TITLES[kind],
    JSON.stringify(content),
    JSON.stringify(outlineFor(kind, content)),
    regionsFor(kind, content),
    nextMaterialPosition(courseId, parentId),
    now,
    now,
  );
  if (kind === "doc") setLinks(id, content);
  return getMaterial(id);
}

// While you edit, an earlier state is kept every 10 minutes (up to 100 per material).
const VERSION_GAP_MS = 10 * 60_000;
const MAX_VERSIONS = 100;

function snapshot(materialId: string, title: string, contentJson: string, at = Date.now()) {
  db.prepare(`INSERT INTO material_versions (id, material_id, title, content, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    nanoid(12),
    materialId,
    title,
    contentJson,
    at,
  );
  db.prepare(
    `DELETE FROM material_versions WHERE material_id = ? AND id NOT IN
       (SELECT id FROM material_versions WHERE material_id = ? ORDER BY created_at DESC LIMIT ?)`,
  ).run(materialId, materialId, MAX_VERSIONS);
}

function lastSnapshotAt(materialId: string): number | null {
  const row = db
    .prepare(`SELECT MAX(created_at) AS t FROM material_versions WHERE material_id = ?`)
    .get(materialId) as { t: number | null };
  return row.t;
}

export function updateMaterial(
  id: string,
  patch: {
    title?: string;
    content?: unknown;
    position?: number;
    /** A course, or null to put a book in the library only. */
    courseId?: string | null;
    parentId?: string | null;
  },
  opts: { snapshot?: "auto" | "skip" } = {},
): MaterialSummary | null {
  return tx(() => {
    const row = materialRow(id, true);
    if (!row) return null;
    const now = Date.now();
    const kind = kindOf(row);

    if (patch.content !== undefined) {
      const content = normalizeContent(kind, patch.content);
      const json = JSON.stringify(content);
      if (json !== row.content) {
        const last = lastSnapshotAt(id);
        if (opts.snapshot !== "skip" && row.content && (!last || now - last >= VERSION_GAP_MS)) {
          snapshot(id, row.title, row.content, now);
        }
        db.prepare(`UPDATE materials SET content = ?, outline = ?, regions = ?, updated_at = ? WHERE id = ?`).run(
          json,
          JSON.stringify(outlineFor(kind, content)),
          regionsFor(kind, content),
          now,
          id,
        );
        if (kind === "doc") setLinks(id, content);
      }
    }

    if (patch.title !== undefined) {
      db.prepare(`UPDATE materials SET title = ?, updated_at = ? WHERE id = ?`).run(patch.title, now, id);
    }

    // Moving: to another course, into or out of a folder, or to a new position.
    if (patch.courseId !== undefined || patch.parentId !== undefined || patch.position !== undefined) {
      const courseId = patch.courseId !== undefined ? patch.courseId : row.course_id;
      const movedCourse = courseId !== row.course_id;
      if (movedCourse && courseId && !getCourse(courseId)) throw new UserError("That course doesn't exist.");
      if (!courseId && kind !== "book") throw new UserError("Only books can live outside a course.");
      const parentId = patch.parentId !== undefined ? patch.parentId : movedCourse ? null : row.parent_id;
      checkParent(parentId, courseId, kind, id);
      const movedContainer = movedCourse || parentId !== row.parent_id;
      const position = patch.position ?? (movedContainer ? nextMaterialPosition(courseId, parentId) : row.position);
      db.prepare(`UPDATE materials SET course_id = ?, parent_id = ?, position = ?, updated_at = ? WHERE id = ?`).run(
        courseId,
        parentId,
        position,
        now,
        id,
      );
      // A folder takes its pages along to the new course.
      if (kind === "folder" && movedCourse) {
        db.prepare(`UPDATE materials SET course_id = ? WHERE parent_id = ?`).run(courseId, id);
      }
    }

    return toSummary(materialRow(id) as MaterialRow);
  });
}

/** Every material with its content, for search. */
export function allMaterialsWithContent(): (Material & { courseName: string; courseCode: string; folderTitle: string | null })[] {
  const rows = db
    .prepare(
      `SELECT ${m_(SUMMARY_COLS)}, m.content, c.name AS course_name, c.code AS course_code, f.title AS folder_title
       FROM materials m LEFT JOIN courses c ON c.id = m.course_id
       LEFT JOIN materials f ON f.id = m.parent_id
       WHERE m.deleted_at IS NULL AND (m.course_id IS NULL OR c.deleted_at IS NULL)
       ORDER BY c.position, m.position`,
    )
    .all() as (MaterialRow & { course_name: string | null; course_code: string | null; folder_title: string | null })[];
  return rows.map((r) => ({
    ...toSummary(r),
    content: JSON.parse(r.content ?? "[]"),
    courseName: r.course_name ?? "",
    courseCode: r.course_code ?? "",
    folderTitle: r.folder_title,
  }));
}

/** Where a material is, for paths: its course (or "Library" for a book with none), then its folder. */
export function whereOf(m: { courseName: string; folderTitle?: string | null }): string {
  const course = m.courseName || "Library";
  return m.folderTitle ? `${course} / ${m.folderTitle}` : course;
}

export type SlidePageInput = { title: string; url: string; name: string; text?: string };

/**
 * A folder holding one annotated image page per page or slide of an imported
 * file, created in one go.
 */
export function createSlideFolder(
  courseId: string,
  input: { title: string; source: FolderSource; pages: SlidePageInput[] },
): Material | null {
  if (!getCourse(courseId)) return null;
  const now = Date.now();
  const folderId = nanoid(10);
  const insert = db.prepare(
    `INSERT INTO materials (id, course_id, parent_id, kind, title, content, outline, regions, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', 0, ?, ?, ?)`,
  );
  tx(() => {
    insert.run(
      folderId,
      courseId,
      null,
      "folder",
      input.title || "Imported slides",
      JSON.stringify(normalizeContent("folder", { source: input.source })),
      nextMaterialPosition(courseId, null),
      now,
      now,
    );
    input.pages.forEach((p, i) => {
      const content: ImagePageContent = { url: p.url, name: p.name, annotations: [], ...(p.text ? { text: p.text } : {}) };
      insert.run(nanoid(10), courseId, folderId, "image", p.title, JSON.stringify(content), i + 1, now, now);
    });
  });
  return getMaterial(folderId);
}

/**
 * Applies a partial update to a book (status, progress, metadata, one
 * highlight) on top of what is stored, so tabs don't overwrite each other.
 * Turning pages doesn't take version snapshots; highlights and notes do.
 */
export function patchBook(id: string, patch: BookPatch): Material | null {
  return tx(() => {
    const m = getMaterial(id);
    if (!m || m.kind !== "book") return null;
    const book: BookContent = asBook(m.content);
    let important = false;
    if (patch.status === "unread" || patch.status === "reading" || patch.status === "done") book.status = patch.status;
    if (patch.progress && typeof patch.progress === "object") {
      const p = patch.progress;
      book.progress = {
        loc: asBookLoc(p.loc),
        fraction: typeof p.fraction === "number" ? Math.min(1, Math.max(0, p.fraction)) : book.progress.fraction,
        ...(p.label ? { label: String(p.label) } : {}),
        updatedAt: Date.now(),
      };
      if (book.status === "unread") book.status = "reading";
    }
    if (patch.meta && typeof patch.meta === "object") {
      book.meta = asBookMeta({ ...book.meta, ...patch.meta });
      important = true;
    }
    if (patch.coverUrl !== undefined) book.coverUrl = typeof patch.coverUrl === "string" && patch.coverUrl ? patch.coverUrl : null;
    if (patch.addHighlight) {
      const h = asBookHighlight(patch.addHighlight);
      if (!h) throw new UserError("That highlight has no location.");
      book.highlights = [...book.highlights.filter((x) => x.id !== h.id), h];
      important = true;
    }
    if (patch.updateHighlight?.id) {
      const { id: hid, note } = patch.updateHighlight;
      book.highlights = book.highlights.map((h) => (h.id === hid ? { ...h, note: String(note ?? "") } : h));
      important = true;
    }
    if (patch.removeHighlight) {
      book.highlights = book.highlights.filter((h) => h.id !== patch.removeHighlight);
      important = true;
    }
    updateMaterial(id, { content: book }, { snapshot: important ? "auto" : "skip" });
    return getMaterial(id);
  });
}

/** Every book, newest reading first, for the library page. */
export function listBooks(): BookListItem[] {
  const rows = db
    .prepare(
      `SELECT ${m_(SUMMARY_COLS)}, m.content, c.name AS course_name, c.code AS course_code
       FROM materials m LEFT JOIN courses c ON c.id = m.course_id
       WHERE m.kind = 'book' AND m.deleted_at IS NULL AND (m.course_id IS NULL OR c.deleted_at IS NULL)
       ORDER BY m.updated_at DESC`,
    )
    .all() as (MaterialRow & { course_name: string | null; course_code: string | null })[];
  return rows.map((r) => ({
    ...toSummary(r),
    courseName: r.course_name ?? "",
    courseCode: r.course_code ?? "",
    book: asBook(JSON.parse(r.content ?? "{}")),
  }));
}

export function isEmpty(): boolean {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM courses`).get() as { n: number };
  return row.n === 0;
}

/** Adds blocks to the end of a page (used to place a Canvas drawing on it). */
export function appendBlocks(materialId: string, blocks: LooseBlock[]): MaterialSummary | null {
  const m = getMaterial(materialId);
  if (!m || m.kind !== "doc" || !Array.isArray(m.content)) return null;
  return updateMaterial(materialId, { content: [...(m.content as LooseBlock[]), ...blocks] });
}

// ── Version history ──────────────────────────────────────────────────────

export function listVersions(materialId: string): VersionSummary[] {
  return (
    db
      .prepare(
        `SELECT id, title, created_at, LENGTH(content) AS size FROM material_versions
         WHERE material_id = ? ORDER BY created_at DESC`,
      )
      .all(materialId) as { id: string; title: string; created_at: number; size: number }[]
  ).map((v) => ({ id: v.id, title: v.title, createdAt: v.created_at, size: v.size }));
}

export function getVersion(versionId: string): Version | null {
  const v = db
    .prepare(
      `SELECT v.id, v.material_id, v.title, v.content, v.created_at, m.kind
       FROM material_versions v JOIN materials m ON m.id = v.material_id WHERE v.id = ?`,
    )
    .get(versionId) as
    | { id: string; material_id: string; title: string; content: string; created_at: number; kind: string }
    | undefined;
  if (!v) return null;
  return {
    id: v.id,
    materialId: v.material_id,
    title: v.title,
    createdAt: v.created_at,
    size: v.content.length,
    kind: kindOf(v),
    content: JSON.parse(v.content),
  };
}

/** Puts an earlier version back. The current state is kept as a version first. */
export function restoreVersion(materialId: string, versionId: string): Material | null {
  const v = getVersion(versionId);
  const row = materialRow(materialId, true);
  if (!v || !row || v.materialId !== materialId) return null;
  tx(() => {
    snapshot(materialId, row.title, row.content ?? "[]");
    updateMaterial(materialId, { content: v.content }, { snapshot: "skip" });
  });
  return getMaterial(materialId);
}

// ── Links between pages ──────────────────────────────────────────────────

function setLinks(sourceId: string, content: unknown) {
  db.prepare(`DELETE FROM links WHERE source_id = ?`).run(sourceId);
  if (!Array.isArray(content)) return;
  const insert = db.prepare(`INSERT OR IGNORE INTO links (source_id, target_id, annotation_id) VALUES (?, ?, ?)`);
  for (const l of extractMentions(content as LooseBlock[])) insert.run(sourceId, l.targetId, l.annotationId);
}

/** Fills the links table from existing pages the first time it is used. */
export function indexLinksIfEmpty() {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM links`).get() as { n: number }).n;
  if (n > 0) return;
  const rows = db.prepare(`SELECT id, content FROM materials WHERE kind = 'doc'`).all() as { id: string; content: string }[];
  tx(() => rows.forEach((r) => setLinks(r.id, JSON.parse(r.content))));
}

export function backlinks(materialId: string): Backlink[] {
  return (
    db
      .prepare(
        `SELECT l.source_id, COUNT(*) AS n, m.title, m.kind, c.name AS course_name
         FROM links l
         JOIN materials m ON m.id = l.source_id AND m.deleted_at IS NULL
         LEFT JOIN courses c ON c.id = m.course_id
         WHERE l.target_id = ? AND l.source_id != ? AND (m.course_id IS NULL OR c.deleted_at IS NULL)
         GROUP BY l.source_id ORDER BY m.title`,
      )
      .all(materialId, materialId) as { source_id: string; n: number; title: string; kind: string; course_name: string | null }[]
  ).map((r) => ({ materialId: r.source_id, title: r.title, kind: kindOf(r), courseName: r.course_name ?? "", count: r.n }));
}

/** What "@" can link to: materials, regions that have a comment, and book highlights. */
export function linkTargets(query: string): LinkTarget[] {
  const q = query.trim().toLowerCase();
  const hit = (s: string) => !q || s.toLowerCase().includes(q);
  const materials: LinkTarget[] = [];
  const regions: LinkTarget[] = [];
  const highlights: LinkTarget[] = [];
  const pages: LinkTarget[] = [];
  // "geron 50", "geron p. 50", "page 50": a page of a PDF book.
  const pageQuery = /^(.*?)\s*(?:\b(?:p|pg|page)\.?\s*)?(\d{1,5})$/i.exec(q);
  const pageOf = pageQuery ? Number(pageQuery[2]) : 0;
  const bookHit = (s: string) => !pageQuery?.[1] || s.toLowerCase().includes(pageQuery[1]);
  const all = allMaterialsWithContent().sort((a, b) => b.updatedAt - a.updatedAt);
  for (const m of all) {
    const where = whereOf(m);
    if (hit(m.title)) {
      materials.push({ kind: "material", materialId: m.id, materialKind: m.kind, title: m.title || "Untitled", path: where });
    }
    if (!q) continue; // regions only when searching
    if (pageOf && m.kind === "book") {
      const b = asBook(m.content);
      if (b.file.format === "pdf" && (!b.length || pageOf <= b.length) && (bookHit(m.title) || bookHit(b.meta.authors))) {
        pages.push({
          kind: "page",
          materialId: m.id,
          materialKind: m.kind,
          annotationId: `page:${pageOf}`,
          page: pageOf,
          title: `Page ${pageOf}`,
          path: `${where} / ${m.title}`,
        });
      }
    }
    const addRegion = (a: { id: string; comment: string }, n: number, blockId?: string) => {
      if (!a.comment || !hit(a.comment)) return;
      regions.push({
        kind: "region",
        materialId: m.id,
        materialKind: m.kind,
        annotationId: a.id,
        blockId,
        n,
        title: a.comment.length > 70 ? `${a.comment.slice(0, 67)}…` : a.comment,
        path: `${where} / ${m.title}`,
      });
    };
    if (m.kind === "image") asImagePage(m.content).annotations.forEach((a, i) => addRegion(a, i + 1));
    if (m.kind === "doc" && Array.isArray(m.content)) {
      let n = 0;
      walkBlocks(m.content as LooseBlock[], (b) => {
        if (b.type === ANNOTATED_IMAGE) parseAnnotations(b.props?.annotations).forEach((a) => addRegion(a, ++n, b.id));
      });
    }
    if (m.kind === "book") {
      asBook(m.content).highlights.forEach((h, i) => {
        const text = h.quote || h.note;
        if (!text || !(hit(h.quote) || hit(h.note))) return;
        highlights.push({
          kind: "highlight",
          materialId: m.id,
          materialKind: m.kind,
          annotationId: h.id,
          n: i + 1,
          title: text.length > 70 ? `${text.slice(0, 67)}…` : text,
          path: `${where} / ${m.title}`,
        });
      });
    }
  }
  return [...materials.slice(0, 12), ...pages.slice(0, 12), ...regions.slice(0, 12), ...highlights.slice(0, 12)];
}

// ── Trash ────────────────────────────────────────────────────────────────

const TRASH_DAYS = 30;

function addToTrash(kind: TrashKind, itemId: string, title: string, location: string, contains: number) {
  const id = nanoid(10);
  db.prepare(
    `INSERT INTO trash (id, kind, item_id, title, location, contains, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, kind, itemId, title, location, contains, Date.now());
  return id;
}

export function trashCourse(id: string): string | null {
  const course = getCourse(id);
  if (!course) return null;
  return tx(() => {
    const trashId = addToTrash("course", id, course.name || "Untitled course", "", course.materials.filter((m) => !m.parentId).length);
    const now = Date.now();
    db.prepare(`UPDATE courses SET deleted_at = ?, trash_id = ? WHERE id = ?`).run(now, trashId, id);
    db.prepare(`UPDATE materials SET deleted_at = ?, trash_id = ? WHERE course_id = ? AND deleted_at IS NULL`).run(now, trashId, id);
    return trashId;
  });
}

export function trashMaterial(id: string): string | null {
  const row = materialRow(id);
  if (!row) return null;
  const course = row.course_id ? getCourse(row.course_id) : null;
  const folder = row.parent_id ? materialRow(row.parent_id) : undefined;
  const pages = (db.prepare(`SELECT COUNT(*) AS n FROM materials WHERE parent_id = ? AND deleted_at IS NULL`).get(id) as { n: number }).n;
  return tx(() => {
    const where = [row.course_id ? course?.name : "Library", folder?.title].filter(Boolean).join(" / ");
    const trashId = addToTrash("material", id, row.title || "Untitled", where, pages);
    db.prepare(
      `UPDATE materials SET deleted_at = ?, trash_id = ? WHERE (id = ? OR parent_id = ?) AND deleted_at IS NULL`,
    ).run(Date.now(), trashId, id, id);
    return trashId;
  });
}

export function trashDrawing(id: string): string | null {
  const d = getDrawingSummary(id);
  if (!d) return null;
  return tx(() => {
    const course = d.courseId ? getCourse(d.courseId) : null;
    const trashId = addToTrash("drawing", id, d.title || "Untitled drawing", course?.name ?? "Canvas", 0);
    db.prepare(`UPDATE drawings SET deleted_at = ?, trash_id = ? WHERE id = ?`).run(Date.now(), trashId, id);
    return trashId;
  });
}

export function listTrash(): TrashItem[] {
  const rows = db.prepare(`SELECT * FROM trash ORDER BY deleted_at DESC`).all() as {
    id: string;
    kind: TrashKind;
    item_id: string;
    title: string;
    location: string;
    contains: number;
    deleted_at: number;
  }[];
  const kinds = new Map(
    (db.prepare(`SELECT id, kind FROM materials WHERE deleted_at IS NOT NULL`).all() as { id: string; kind: string }[]).map((r) => [
      r.id,
      kindOf(r),
    ]),
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    itemId: r.item_id,
    materialKind: r.kind === "material" ? kinds.get(r.item_id) : undefined,
    title: r.title,
    where: r.location,
    contains: r.contains,
    deletedAt: r.deleted_at,
  }));
}

/** Brings back everything deleted in one go. Returns the restored item's id. */
export function restoreTrash(trashId: string): { kind: TrashKind; itemId: string } | null {
  const t = db.prepare(`SELECT kind, item_id FROM trash WHERE id = ?`).get(trashId) as
    | { kind: TrashKind; item_id: string }
    | undefined;
  if (!t) return null;
  if (t.kind === "material") {
    const m = db.prepare(`SELECT course_id, parent_id FROM materials WHERE id = ?`).get(t.item_id) as
      | { course_id: string | null; parent_id: string | null }
      | undefined;
    const course =
      m?.course_id ?
        (db.prepare(`SELECT name, deleted_at FROM courses WHERE id = ?`).get(m.course_id) as { name: string; deleted_at: number | null } | undefined)
      : undefined;
    if (course?.deleted_at) {
      throw new UserError(`This was in “${course.name}”, which is in the trash too. Restore the course first.`, 409);
    }
  }
  tx(() => {
    for (const table of ["courses", "materials", "drawings"]) {
      db.prepare(`UPDATE ${table} SET deleted_at = NULL, trash_id = NULL WHERE trash_id = ?`).run(trashId);
    }
    // A page whose folder was deleted later comes back at the top of its course.
    if (t.kind === "material") {
      db.prepare(
        `UPDATE materials SET parent_id = NULL WHERE id = ? AND parent_id IN (SELECT id FROM materials WHERE deleted_at IS NOT NULL)`,
      ).run(t.item_id);
    }
    db.prepare(`DELETE FROM trash WHERE id = ?`).run(trashId);
  });
  return { kind: t.kind, itemId: t.item_id };
}

/** Deletes for good. */
export function purgeTrash(trashId: string): boolean {
  const exists = db.prepare(`SELECT 1 FROM trash WHERE id = ?`).get(trashId);
  if (!exists) return false;
  tx(() => {
    db.prepare(`DELETE FROM materials WHERE trash_id = ?`).run(trashId);
    db.prepare(`DELETE FROM courses WHERE trash_id = ?`).run(trashId);
    db.prepare(`DELETE FROM drawings WHERE trash_id = ?`).run(trashId);
    db.prepare(`DELETE FROM trash WHERE id = ?`).run(trashId);
    // Entries whose items went with something else (e.g. a page inside a purged course).
    db.exec(`
      DELETE FROM trash WHERE kind = 'material' AND item_id NOT IN (SELECT id FROM materials);
      DELETE FROM trash WHERE kind = 'course' AND item_id NOT IN (SELECT id FROM courses);
      DELETE FROM trash WHERE kind = 'drawing' AND item_id NOT IN (SELECT id FROM drawings);
    `);
  });
  return true;
}

export function emptyTrash() {
  for (const { id } of db.prepare(`SELECT id FROM trash`).all() as { id: string }[]) purgeTrash(id);
}

/** Trash older than 30 days is deleted for good. */
export function purgeExpiredTrash() {
  const cutoff = Date.now() - TRASH_DAYS * 24 * 60 * 60 * 1000;
  const old = db.prepare(`SELECT id FROM trash WHERE deleted_at < ?`).all(cutoff) as { id: string }[];
  old.forEach((t) => purgeTrash(t.id));
  return old.length;
}

// ── Drawings ─────────────────────────────────────────────────────────────

type DrawingRow = {
  id: string;
  title: string;
  course_id: string | null;
  has_preview: number;
  created_at: number;
  updated_at: number;
  scene?: string;
};

const DRAWING_COLS = "id, title, course_id, preview IS NOT NULL AS has_preview, created_at, updated_at";

function toDrawingSummary(r: DrawingRow): DrawingSummary {
  return {
    id: r.id,
    title: r.title,
    courseId: r.course_id,
    hasPreview: !!r.has_preview,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listDrawings(): DrawingSummary[] {
  return (
    db.prepare(`SELECT ${DRAWING_COLS} FROM drawings WHERE deleted_at IS NULL ORDER BY updated_at DESC`).all() as DrawingRow[]
  ).map(toDrawingSummary);
}

export function getDrawingSummary(id: string): DrawingSummary | null {
  const row = db.prepare(`SELECT ${DRAWING_COLS} FROM drawings WHERE id = ? AND deleted_at IS NULL`).get(id) as
    | DrawingRow
    | undefined;
  return row ? toDrawingSummary(row) : null;
}

export function getDrawing(id: string): Drawing | null {
  const row = db.prepare(`SELECT ${DRAWING_COLS}, scene FROM drawings WHERE id = ? AND deleted_at IS NULL`).get(id) as
    | DrawingRow
    | undefined;
  return row ? { ...toDrawingSummary(row), scene: JSON.parse(row.scene ?? '{"elements":[]}') } : null;
}

export function getDrawingPreview(id: string): { svg: string; updatedAt: number } | null {
  const row = db.prepare(`SELECT preview, updated_at FROM drawings WHERE id = ? AND deleted_at IS NULL`).get(id) as
    | { preview: string | null; updated_at: number }
    | undefined;
  return row?.preview ? { svg: row.preview, updatedAt: row.updated_at } : null;
}

type DrawingInput = {
  title?: string;
  courseId?: string | null;
  scene?: DrawingScene;
  preview?: string | null;
};

const validCourse = (id: string | null | undefined) => (id && getCourse(id) ? id : null);

export function createDrawing(input: DrawingInput): DrawingSummary {
  const id = nanoid(10);
  const now = Date.now();
  const scene = input.scene ?? { elements: [] };
  db.prepare(
    `INSERT INTO drawings (id, title, course_id, scene, preview, text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title ?? "Untitled drawing",
    validCourse(input.courseId),
    JSON.stringify(scene),
    input.preview ?? null,
    sceneText(scene),
    now,
    now,
  );
  return getDrawingSummary(id)!;
}

export function updateDrawing(id: string, patch: DrawingInput): DrawingSummary | null {
  const cur = getDrawing(id);
  if (!cur) return null;
  const scene = patch.scene ?? cur.scene;
  const preview = patch.preview !== undefined ? patch.preview : (getDrawingPreview(id)?.svg ?? null);
  db.prepare(
    `UPDATE drawings SET title = ?, course_id = ?, scene = ?, preview = ?, text = ?, updated_at = ? WHERE id = ?`,
  ).run(
    patch.title ?? cur.title,
    patch.courseId !== undefined ? validCourse(patch.courseId) : cur.courseId,
    JSON.stringify(scene),
    preview,
    sceneText(scene),
    Date.now(),
    id,
  );
  return getDrawingSummary(id);
}

/** Drawing titles and the text written in them, for search. */
export function allDrawingText(): { id: string; title: string; text: string; courseName: string | null }[] {
  return db
    .prepare(
      `SELECT d.id, d.title, d.text, c.name AS courseName
       FROM drawings d LEFT JOIN courses c ON c.id = d.course_id
       WHERE d.deleted_at IS NULL
       ORDER BY d.updated_at DESC`,
    )
    .all() as { id: string; title: string; text: string; courseName: string | null }[];
}

/** Plain text of a page, for previews of earlier versions. */
export const docText = (blocks: LooseBlock[]) => {
  const lines: string[] = [];
  walkBlocks(blocks, (b) => {
    const t = contentText(b.content);
    if (t) lines.push(t);
  });
  return lines.join("\n");
};
