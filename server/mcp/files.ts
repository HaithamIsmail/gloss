// Tools for artifacts, books, uploads, and the safety net (trash, versions).
import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { nanoid } from "nanoid";
import { z } from "zod";
import { BOOK_STATUS_LABEL, bookProgressLabel, asBook } from "../../shared/pages";
import * as artifacts from "../artifacts";
import { UPLOAD_DIR } from "../db";
import * as repo from "../repo";
import { UserError } from "../repo";
import { changed, needCourse, needMaterial, summary, tool, treeChanged } from "./common";

const MAX_UPLOAD = 15 * 1024 * 1024;

const artifactOut = (m: { id: string; title: string; content: unknown; updatedAt: number }) => {
  const c = m.content as { entry: string; files: { path: string; size: number }[] };
  return { id: m.id, title: m.title, entry: c.entry, files: c.files.map((f) => ({ path: f.path, size: f.size })), updatedAt: m.updatedAt };
};

export function registerFileTools(server: McpServer) {
  // ── Artifacts ──────────────────────────────────────────────────────────
  tool(
    server,
    "create_artifact",
    {
      title: "Create an artifact",
      description:
        "Creates an artifact: an HTML page (index.html) with optional extra text files (CSS, JS, JSON…), shown in a sandboxed frame that can't reach the app. Returns its id and file list.",
      input: {
        courseId: z.string(),
        title: z.string().optional().describe("Defaults to the page's <title>."),
        description: z.string().optional().describe("A sentence shown under the title."),
        html: z.string().min(1).describe("The entry page's HTML."),
        files: z.array(z.object({ path: z.string(), text: z.string() })).optional().describe('Other text files by relative path, e.g. "app.js".'),
        parentId: z.string().optional(),
      },
    },
    ({ courseId, title, description, html, files, parentId }) => {
      needCourse(courseId);
      const m = artifacts.createArtifact(courseId, { title, description, html, files, parentId: parentId ?? null, source: "MCP" })!;
      treeChanged();
      return artifactOut(m);
    },
  );

  tool(
    server,
    "read_artifact_file",
    {
      title: "Read an artifact file",
      description: "Returns one text file of an artifact (path, text, size).",
      input: { id: z.string(), path: z.string().default("index.html") },
      readOnly: true,
    },
    ({ id, path: p }) => {
      needMaterial(id, "artifact");
      const f = artifacts.readText(id, p);
      if (!f) throw new UserError(`The artifact has no file "${p}".`);
      return { path: f.path, size: f.size, text: f.text };
    },
  );

  tool(
    server,
    "write_artifact_file",
    {
      title: "Write an artifact file",
      description:
        "Adds or replaces one text file of an artifact; the previous index.html is kept in the artifact's history. An open frame reloads on its own. Returns the file list.",
      input: { id: z.string(), path: z.string(), text: z.string() },
    },
    ({ id, path: p, text }) => {
      needMaterial(id, "artifact");
      const m = artifacts.writeFile(id, p, text)!;
      changed(m);
      return artifactOut(m);
    },
  );

  tool(
    server,
    "delete_artifact_file",
    {
      title: "Delete an artifact file",
      description: "Removes one file from an artifact (not the entry page). Returns the file list.",
      input: { id: z.string(), path: z.string() },
      destructive: true,
    },
    ({ id, path: p }) => {
      needMaterial(id, "artifact");
      if (!artifacts.readFile(id, p)) throw new UserError(`The artifact has no file "${p}".`);
      const m = artifacts.deleteFile(id, p)!;
      changed(m);
      return artifactOut(m);
    },
  );

  // ── Books ──────────────────────────────────────────────────────────────
  tool(
    server,
    "update_book",
    {
      title: "Update a book",
      description: "Changes a book's reading status, its details (authors, year, publisher, description, tags), or the note on one highlight. Returns the book's status and details.",
      input: {
        id: z.string(),
        status: z.enum(["unread", "reading", "done"]).optional(),
        meta: z
          .object({
            authors: z.string().optional(),
            year: z.string().optional(),
            publisher: z.string().optional(),
            description: z.string().optional(),
            tags: z.array(z.string()).optional(),
          })
          .optional(),
        highlightNote: z.object({ id: z.string(), note: z.string() }).optional().describe("A highlight id (from get_material) and its new note."),
      },
    },
    ({ id, status, meta, highlightNote }) => {
      const before = asBook(needMaterial(id, "book").content);
      if (highlightNote && !before.highlights.some((h) => h.id === highlightNote.id)) {
        throw new UserError(`The book has no highlight with id "${highlightNote.id}".`);
      }
      const m = repo.patchBook(id, { status, meta, updateHighlight: highlightNote })!;
      treeChanged();
      const b = asBook(m.content);
      return { id: m.id, title: m.title, status: BOOK_STATUS_LABEL[b.status], progress: bookProgressLabel(b), meta: b.meta };
    },
  );

  // ── Uploads ────────────────────────────────────────────────────────────
  tool(
    server,
    "upload_file",
    {
      title: "Upload a file",
      description: "Stores a file (an image for a page, say; at most 15 MB) and returns its /uploads/… URL, which you can use in Markdown: ![name](url).",
      input: { name: z.string().min(1).describe('File name with extension, e.g. "diagram.png".'), base64: z.string().min(1) },
    },
    ({ name, base64 }) => {
      if (base64.length > Math.ceil((MAX_UPLOAD * 4) / 3) + 4) throw new UserError("A file can be at most 15 MB here.");
      const data = Buffer.from(base64.replace(/^data:[^,]*,/, ""), "base64");
      if (!data.length) throw new UserError("That isn't base64 data.");
      if (data.length > MAX_UPLOAD) throw new UserError("A file can be at most 15 MB here.");
      // Same naming as POST /api/uploads.
      const ext = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "");
      const file = `${nanoid(14)}${ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, file), data);
      return { url: `/uploads/${file}`, name, size: data.length };
    },
  );

  // ── Safety net ─────────────────────────────────────────────────────────
  tool(
    server,
    "delete_material",
    {
      title: "Move a material to the trash",
      description: "Moves a material (a folder with its pages) to the trash, where it stays 30 days and can be restored with restore_from_trash. Returns the trash id.",
      input: { id: z.string() },
      destructive: true,
    },
    ({ id }) => {
      const m = needMaterial(id);
      const trashId = repo.trashMaterial(id)!;
      treeChanged();
      return { trashId, title: m.title };
    },
  );

  tool(
    server,
    "delete_course",
    {
      title: "Move a course to the trash",
      description: "Moves a course and all its materials to the trash (30 days, reversible with restore_from_trash). Returns the trash id.",
      input: { id: z.string() },
      destructive: true,
    },
    ({ id }) => {
      const c = needCourse(id);
      const trashId = repo.trashCourse(id)!;
      treeChanged();
      return { trashId, name: c.name };
    },
  );

  tool(
    server,
    "restore_from_trash",
    {
      title: "Restore from the trash",
      description: "Brings back everything deleted together under one trash id (from list_trash or a delete). Returns the restored item's kind and id.",
      input: { trashId: z.string() },
    },
    ({ trashId }) => {
      const r = repo.restoreTrash(trashId);
      if (!r) throw new UserError(`No trash entry with id "${trashId}". Use list_trash.`);
      treeChanged();
      return r;
    },
  );

  tool(
    server,
    "restore_version",
    {
      title: "Restore an earlier version",
      description: "Puts back an earlier version of a material (from list_versions); the current content is kept as a version first. Returns the summary.",
      input: { id: z.string(), versionId: z.string() },
    },
    ({ id, versionId }) => {
      needMaterial(id);
      const m = repo.restoreVersion(id, versionId);
      if (!m) throw new UserError(`No version "${versionId}" of this material. Use list_versions.`);
      changed(m);
      return summary(m);
    },
  );
}
