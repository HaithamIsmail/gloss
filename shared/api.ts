import type { OutlineItem } from "./content";
import type { MaterialKind } from "./pages";

export type MaterialSummary = {
  id: string;
  courseId: string;
  /** The folder this material sits in (slides imported from a file), if any. */
  parentId: string | null;
  kind: MaterialKind;
  title: string;
  position: number;
  outline: OutlineItem[];
  regions: number;
  updatedAt: number;
};

export type Course = {
  id: string;
  name: string;
  code: string;
  position: number;
  materials: MaterialSummary[];
};

export type Tree = { courses: Course[] };

/** content: LooseBlock[] for "doc", ImagePageContent for "image", NotebookContent for "notebook". */
export type Material = MaterialSummary & { content: unknown };

/** An Excalidraw scene as stored: elements, a little app state and the image files it uses. */
export type DrawingScene = {
  elements: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

export type DrawingSummary = {
  id: string;
  title: string;
  courseId: string | null;
  hasPreview: boolean;
  createdAt: number;
  updatedAt: number;
};

export type Drawing = DrawingSummary & { scene: DrawingScene };

export type SearchKind = "Course" | "Material" | "Section" | "Subsection" | "Text" | "Code" | "Comment" | "Drawing";

export type SearchResult = {
  kind: SearchKind;
  label: string;
  title: string;
  path: string;
  courseId?: string;
  materialId?: string;
  blockId?: string;
  annotationId?: string;
  drawingId?: string;
};

export type UploadResult = { url: string; name: string };

// ── Trash, history, links, backups ───────────────────────────────────────

export type TrashKind = "course" | "material" | "drawing";

export type TrashItem = {
  id: string;
  kind: TrashKind;
  /** The course, material or drawing that was deleted. */
  itemId: string;
  materialKind?: MaterialKind;
  title: string;
  /** Where it was: course name, or "Canvas". */
  where: string;
  /** Pages inside it (a course or folder), 0 otherwise. */
  contains: number;
  deletedAt: number;
};

export type VersionSummary = { id: string; createdAt: number; title: string; size: number };

export type Version = VersionSummary & { materialId: string; kind: MaterialKind; content: unknown };

export type Backlink = {
  materialId: string;
  title: string;
  kind: MaterialKind;
  courseName: string;
  /** How many links that page has to this one (or to its regions). */
  count: number;
};

export type LinkTarget = {
  kind: "material" | "region";
  materialId: string;
  materialKind: MaterialKind;
  annotationId?: string;
  blockId?: string;
  /** Region number on its page. */
  n?: number;
  title: string;
  path: string;
};

export type BackupInfo = { name: string; size: number; createdAt: number };

// ── Themes ───────────────────────────────────────────────────────────────

export type ThemeInfo = {
  /** "builtin/washi" or "user/my-theme". */
  id: string;
  name: string;
  author: string;
  description: string;
  scheme: "light" | "dark";
  source: "builtin" | "user";
  /** The theme's stylesheet (changes when the file changes). */
  href: string;
  updatedAt: number;
};

export type ThemeList = { current: string; themes: ThemeInfo[]; folder: string };
