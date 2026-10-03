import fs from "node:fs";
import path from "node:path";
import type { BackupInfo } from "../shared/api";
import { DATA_DIR, db, getSetting, setSetting } from "./db";

export const BACKUP_DIR = path.join(DATA_DIR, "backups");
const KEEP = 20;
const NAME = /^gloss-[\w-]+\.db$/;

const pad = (n: number) => String(n).padStart(2, "0");
function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

/** Changes whenever anything is added, edited or deleted. */
function fingerprint(): string {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) || ':' || IFNULL(MAX(updated_at), 0) || ':' || IFNULL(MAX(deleted_at), 0) FROM courses) AS c,
         (SELECT COUNT(*) || ':' || IFNULL(MAX(updated_at), 0) || ':' || IFNULL(MAX(deleted_at), 0) FROM materials) AS m,
         (SELECT COUNT(*) || ':' || IFNULL(MAX(updated_at), 0) || ':' || IFNULL(MAX(deleted_at), 0) FROM drawings) AS d,
         (SELECT COUNT(*) FROM trash) AS t`,
    )
    .get() as Record<string, string | number>;
  return Object.values(row).join("|");
}

/** Copies the database to data/backups (a consistent snapshot, even while in use). */
export function writeSnapshot(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
}

export function backupNow(): BackupInfo {
  let name = `gloss-${stamp()}.db`;
  for (let i = 2; fs.existsSync(path.join(BACKUP_DIR, name)); i++) name = `gloss-${stamp()}-${i}.db`;
  const file = path.join(BACKUP_DIR, name);
  writeSnapshot(file);
  setSetting("backup.fingerprint", fingerprint());
  prune();
  const st = fs.statSync(file);
  return { name, size: st.size, createdAt: st.mtimeMs };
}

/**
 * Run when the app starts. Skipped when nothing changed since the last backup,
 * so restarts don't push useful backups out.
 */
export function backupOnStart(): BackupInfo | null {
  const empty = (db.prepare(`SELECT COUNT(*) AS n FROM courses`).get() as { n: number }).n === 0;
  if (empty) return null;
  if (getSetting("backup.fingerprint", "") === fingerprint() && listBackups().length) return null;
  return backupNow();
}

export function listBackups(): BackupInfo[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((n) => NAME.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, size: st.size, createdAt: st.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function prune() {
  for (const b of listBackups().slice(KEEP)) fs.rmSync(path.join(BACKUP_DIR, b.name), { force: true });
}

/** Absolute path of a backup, or null for anything that isn't one. */
export function backupFile(name: string): string | null {
  if (!NAME.test(name)) return null;
  const file = path.join(BACKUP_DIR, name);
  return fs.existsSync(file) ? file : null;
}
