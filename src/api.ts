import { QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import type {
  BackupInfo,
  Backlink,
  Course,
  Drawing,
  DrawingScene,
  DrawingSummary,
  LinkTarget,
  Material,
  MaterialSummary,
  SearchResult,
  TrashItem,
  TrashKind,
  Tree,
  UploadResult,
  Version,
  VersionSummary,
} from "../shared/api";
import type { LooseBlock } from "../shared/content";
import type { PythonEnv } from "../shared/kernel";
import type { FolderSource, MaterialKind } from "../shared/pages";
import { toast } from "./toast";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Trashed = { trashId: string };

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    let error: string | undefined;
    try {
      error = JSON.parse(msg)?.error;
    } catch {
      // not JSON
    }
    throw new ApiError(error ?? `${method} ${url} failed (${res.status}) ${msg}`, res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  tree: () => request<Tree>("GET", "/api/tree"),
  createCourse: (input: { name?: string; code?: string } = {}) => request<Course>("POST", "/api/courses", input),
  updateCourse: (id: string, patch: { name?: string; code?: string; position?: number }) =>
    request<Course>("PATCH", `/api/courses/${id}`, patch),
  deleteCourse: (id: string) => request<Trashed>("DELETE", `/api/courses/${id}`),
  createMaterial: (courseId: string, input: NewMaterial = {}) =>
    request<Material>("POST", `/api/courses/${courseId}/materials`, input),
  material: (id: string) => request<Material>("GET", `/api/materials/${id}`),
  updateMaterial: (
    id: string,
    patch: { title?: string; content?: unknown; position?: number; courseId?: string; parentId?: string | null },
  ) => request<MaterialSummary>("PATCH", `/api/materials/${id}`, patch),
  deleteMaterial: (id: string) => request<Trashed>("DELETE", `/api/materials/${id}`),
  versions: (materialId: string) => request<VersionSummary[]>("GET", `/api/materials/${materialId}/versions`),
  version: (id: string) => request<Version>("GET", `/api/versions/${id}`),
  restoreVersion: (materialId: string, versionId: string) =>
    request<Material>("POST", `/api/materials/${materialId}/versions/${versionId}/restore`),
  backlinks: (materialId: string) => request<Backlink[]>("GET", `/api/materials/${materialId}/backlinks`),
  linkTargets: (q: string) => request<LinkTarget[]>("GET", `/api/link-targets?q=${encodeURIComponent(q)}`),
  trash: () => request<TrashItem[]>("GET", "/api/trash"),
  restoreTrash: (id: string) => request<{ kind: TrashKind; itemId: string }>("POST", `/api/trash/${id}/restore`),
  purgeTrash: (id: string) => request<void>("DELETE", `/api/trash/${id}`),
  emptyTrash: () => request<void>("DELETE", "/api/trash"),
  backups: () => request<BackupInfo[]>("GET", "/api/backups"),
  backupNow: () => request<BackupInfo>("POST", "/api/backups"),
  appendToMaterial: (id: string, blocks: LooseBlock[]) =>
    request<MaterialSummary>("POST", `/api/materials/${id}/append`, { blocks }),
  drawings: () => request<DrawingSummary[]>("GET", "/api/drawings"),
  drawing: (id: string) => request<Drawing>("GET", `/api/drawings/${id}`),
  createDrawing: (input: DrawingInput) => request<DrawingSummary>("POST", "/api/drawings", input),
  updateDrawing: (id: string, patch: DrawingInput) => request<DrawingSummary>("PATCH", `/api/drawings/${id}`, patch),
  deleteDrawing: (id: string) => request<Trashed>("DELETE", `/api/drawings/${id}`),
  envs: (refresh = false) => request<PythonEnv[]>("GET", `/api/envs${refresh ? "?refresh=1" : ""}`),
  addEnv: (path: string) => request<PythonEnv>("POST", "/api/envs", { path }),
  installIpykernel: (python: string) =>
    request<{ ok: boolean; log: string }>("POST", "/api/envs/install-ipykernel", { python }),
  slideConverter: () => request<{ slides: "powerpoint" | "libreoffice" | null }>("GET", "/api/convert/available"),
  /** Uploads a presentation; the server converts it to PDF. */
  convertSlides: async (file: File): Promise<{ url: string; name: string; pdfUrl: string }> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/convert/slides", { method: "POST", body: form });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Conversion failed (${res.status})`);
    return res.json();
  },
  createSlideFolder: (
    courseId: string,
    body: { title: string; source: FolderSource; pages: { title: string; url: string; name: string; text?: string }[] },
  ) => request<Material>("POST", `/api/courses/${courseId}/slides`, body),
  search: (q: string) => request<SearchResult[]>("GET", `/api/search?q=${encodeURIComponent(q)}`),
  upload: async (file: File): Promise<UploadResult> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/uploads", { method: "POST", body: form });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    return res.json();
  },
};

export type NewMaterial = { title?: string; kind?: MaterialKind; content?: unknown; parentId?: string | null };

export type DrawingInput = {
  title?: string;
  courseId?: string | null;
  scene?: DrawingScene;
  preview?: string | null;
};

export const keys = {
  tree: ["tree"] as const,
  material: (id: string) => ["material", id] as const,
  drawings: ["drawings"] as const,
  envs: ["envs"] as const,
  drawing: (id: string) => ["drawing", id] as const,
  trash: ["trash"] as const,
  versions: (id: string) => ["versions", id] as const,
  backlinks: (id: string) => ["backlinks", id] as const,
  backups: ["backups"] as const,
};

export function useTree() {
  return useQuery({ queryKey: keys.tree, queryFn: api.tree });
}

export function useMaterial(id: string | undefined) {
  return useQuery({
    queryKey: keys.material(id ?? ""),
    queryFn: () => api.material(id!),
    enabled: !!id,
    staleTime: Infinity,
  });
}

/** Writes a fresh material summary into the cached tree (after a save or rename). */
export function patchTreeMaterial(summary: MaterialSummary) {
  queryClient.setQueryData<Tree>(keys.tree, (tree) =>
    tree && {
      courses: tree.courses.map((c) => ({
        ...c,
        materials:
          c.id === summary.courseId
            ? c.materials.map((m) => (m.id === summary.id ? summary : m))
            : c.materials.filter((m) => m.id !== summary.id),
      })),
    },
  );
}

export function patchTreeCourse(id: string, patch: Partial<Course>) {
  queryClient.setQueryData<Tree>(keys.tree, (tree) =>
    tree && { courses: tree.courses.map((c) => (c.id === id ? { ...c, ...patch } : c)) },
  );
}

const invalidateTree = () => queryClient.invalidateQueries({ queryKey: keys.tree });

export function useCreateCourse() {
  return useMutation({ mutationFn: api.createCourse, onSuccess: invalidateTree });
}

const titleInTree = (id: string) => {
  for (const c of queryClient.getQueryData<Tree>(keys.tree)?.courses ?? []) {
    if (c.id === id) return c.name || "Untitled course";
    const m = c.materials.find((x) => x.id === id);
    if (m) return m.title || "Untitled";
  }
  return "Untitled";
};

/** Brings something back from the trash and refreshes everything that may show it. */
export async function restoreFromTrash(trashId: string, title?: string) {
  try {
    await api.restoreTrash(trashId);
    toast(title ? `Restored “${title}”` : "Restored");
  } catch (err) {
    toast((err as Error).message || "Could not restore that.");
  }
  void queryClient.invalidateQueries({ queryKey: keys.tree });
  void queryClient.invalidateQueries({ queryKey: keys.trash });
  void queryClient.invalidateQueries({ queryKey: keys.drawings });
}

/** "Moved … to the trash · Undo". */
export function announceTrashed(title: string, { trashId }: Trashed) {
  void queryClient.invalidateQueries({ queryKey: keys.trash });
  toast(`Moved “${title}” to the trash`, { label: "Undo", run: () => restoreFromTrash(trashId, title) });
}

export function useDeleteCourse() {
  return useMutation({
    mutationFn: api.deleteCourse,
    onMutate: (id) => ({ title: titleInTree(id) }),
    onSuccess: (res, _id, ctx) => {
      announceTrashed(ctx.title, res);
      return invalidateTree();
    },
  });
}

export function useCreateMaterial() {
  return useMutation({
    mutationFn: ({ courseId, ...input }: NewMaterial & { courseId: string }) => api.createMaterial(courseId, input),
    onSuccess: (m) => {
      queryClient.setQueryData(keys.material(m.id), m);
      return invalidateTree();
    },
  });
}

export function useDeleteMaterial() {
  return useMutation({
    mutationFn: api.deleteMaterial,
    onMutate: (id) => ({ title: titleInTree(id) }),
    onSuccess: (res, id, ctx) => {
      queryClient.removeQueries({ queryKey: keys.material(id) });
      announceTrashed(ctx.title, res);
      return invalidateTree();
    },
  });
}

export type MoveTo = { id: string; courseId?: string; parentId?: string | null; position?: number };

/** Reorders a material, or moves it to another course or folder (a folder takes its pages along). */
export function useMoveMaterial() {
  return useMutation({
    mutationFn: ({ id, ...patch }: MoveTo) => api.updateMaterial(id, patch),
    onMutate: ({ id, courseId, parentId, position }) => {
      queryClient.setQueryData<Tree>(keys.tree, (tree) => {
        if (!tree) return tree;
        const moving = tree.courses.flatMap((c) => c.materials).filter((m) => m.id === id || m.parentId === id);
        const self = moving.find((m) => m.id === id);
        if (!self) return tree;
        const to = courseId ?? self.courseId;
        const moved = moving.map((m) =>
          m.id === id
            ? {
                ...m,
                courseId: to,
                parentId: parentId !== undefined ? parentId : to !== self.courseId ? null : m.parentId,
                position: position ?? m.position,
              }
            : { ...m, courseId: to },
        );
        const ids = new Set(moved.map((m) => m.id));
        return {
          courses: tree.courses.map((c) => ({
            ...c,
            materials: [...c.materials.filter((m) => !ids.has(m.id)), ...moved.filter((m) => m.courseId === c.id)].sort(
              (a, b) => a.position - b.position,
            ),
          })),
        };
      });
    },
    onError: (err) => toast((err as Error).message || "Could not move that."),
    onSettled: invalidateTree,
  });
}

// ── Drawings ─────────────────────────────────────────────────────────────

export function useDrawings() {
  return useQuery({ queryKey: keys.drawings, queryFn: api.drawings, staleTime: 30_000 });
}

export function useDrawing(id: string | null | undefined) {
  return useQuery({
    queryKey: keys.drawing(id ?? ""),
    queryFn: () => api.drawing(id!),
    enabled: !!id,
    staleTime: Infinity,
  });
}

/** Records a saved drawing in the cached list (and its scene, when given). */
export function rememberDrawing(summary: DrawingSummary, scene?: DrawingScene) {
  queryClient.setQueryData<DrawingSummary[]>(keys.drawings, (list) =>
    list ? [summary, ...list.filter((d) => d.id !== summary.id)] : [summary],
  );
  if (scene) queryClient.setQueryData<Drawing>(keys.drawing(summary.id), { ...summary, scene });
}

export function forgetDrawing(id: string) {
  queryClient.setQueryData<DrawingSummary[]>(keys.drawings, (list) => list?.filter((d) => d.id !== id));
  queryClient.removeQueries({ queryKey: keys.drawing(id) });
}

// ── Python environments ──────────────────────────────────────────────────

export function useEnvs(enabled = true) {
  return useQuery({ queryKey: keys.envs, queryFn: () => api.envs(), enabled, staleTime: 5 * 60_000 });
}
