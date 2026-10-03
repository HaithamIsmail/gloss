import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "study.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS courses (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    code        TEXT NOT NULL DEFAULT '',
    position    REAL NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS materials (
    id          TEXT PRIMARY KEY,
    course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '[]',
    outline     TEXT NOT NULL DEFAULT '[]',
    regions     INTEGER NOT NULL DEFAULT 0,
    position    REAL NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS materials_course ON materials(course_id, position);

  -- Excalidraw scenes. Usable on their own (Canvas) and embedded in materials.
  CREATE TABLE IF NOT EXISTS drawings (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    course_id   TEXT REFERENCES courses(id) ON DELETE SET NULL,
    scene       TEXT NOT NULL DEFAULT '{"elements":[]}',
    preview     TEXT,
    text        TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
`);

db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function setSetting(key: string, value: unknown) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
    key,
    JSON.stringify(value),
  );
}

// Migration: materials gained a kind (doc, image, notebook).
const materialCols = db.prepare(`PRAGMA table_info(materials)`).all() as { name: string }[];
if (!materialCols.some((c) => c.name === "kind")) {
  db.exec(`ALTER TABLE materials ADD COLUMN kind TEXT NOT NULL DEFAULT 'doc'`);
}
// Migration: materials can sit in a folder (slides imported from a file).
if (!materialCols.some((c) => c.name === "parent_id")) {
  db.exec(`ALTER TABLE materials ADD COLUMN parent_id TEXT REFERENCES materials(id) ON DELETE CASCADE`);
}

// Migration: deleting moves things to the trash. Rows deleted together share a trash_id.
for (const table of ["courses", "materials", "drawings"]) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "deleted_at")) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN deleted_at INTEGER; ALTER TABLE ${table} ADD COLUMN trash_id TEXT;`);
  }
}

db.exec(`
  -- One row per thing the user deleted (a course, a material or a drawing).
  CREATE TABLE IF NOT EXISTS trash (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    item_id     TEXT NOT NULL,
    title       TEXT NOT NULL,
    location    TEXT NOT NULL DEFAULT '',
    contains    INTEGER NOT NULL DEFAULT 0,
    deleted_at  INTEGER NOT NULL
  );

  -- Earlier states of a material's content (taken while you edit).
  CREATE TABLE IF NOT EXISTS material_versions (
    id          TEXT PRIMARY KEY,
    material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS material_versions_material ON material_versions(material_id, created_at);

  -- "@" links from a page to a material (or to one of its regions).
  CREATE TABLE IF NOT EXISTS links (
    source_id     TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    target_id     TEXT NOT NULL,
    annotation_id TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (source_id, target_id, annotation_id)
  );
  CREATE INDEX IF NOT EXISTS links_target ON links(target_id);
`);

let txDepth = 0;

/** Runs `fn` inside a transaction, rolling back if it throws. Nested calls join the outer one. */
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  db.exec("BEGIN");
  txDepth++;
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    txDepth--;
  }
}
