// Adds an HTML page (and the files it uses) to a course as an artifact. The
// files are uploaded as they are; the server picks the entry page and reads
// the title from it.
import type { NavigateFunction } from "react-router";
import { api, keys, queryClient } from "../api";
import { useUI } from "../store";
import { toast } from "../toast";

/** The path a picked file keeps inside the artifact (folder pickers give a relative path). */
export const relPathOf = (f: File) => {
  const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
  return rel ? rel.split("/").slice(1).join("/") || f.name : f.name;
};

export function pickArtifactFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".html,.htm,.css,.js,.mjs,.json,.svg,.png,.jpg,.jpeg,.gif,.webp,.woff,.woff2,.md,.txt,.csv,text/html";
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

/** Asks for an .html file (plus any files it uses) and adds it to a course or folder. */
export async function startArtifactImport(courseId: string, navigate: NavigateFunction, parentId: string | null = null, picked?: File[]) {
  const files = picked ?? (await pickArtifactFiles());
  if (!files.length) return;
  if (!files.some((f) => /\.html?$/i.test(f.name) || f.type === "text/html")) {
    toast("Pick the artifact's .html page (with any files it uses).");
    return;
  }
  try {
    const m = await api.importArtifact(
      courseId,
      files.map((f) => ({ file: f, path: relPathOf(f) })),
      { parentId },
    );
    queryClient.setQueryData(keys.material(m.id), m);
    await queryClient.invalidateQueries({ queryKey: keys.tree });
    useUI.getState().setExpanded(courseId, true);
    if (parentId) useUI.getState().setExpanded(parentId, true);
    navigate(`/m/${m.id}`);
  } catch (err) {
    toast((err as Error).message || "The artifact could not be added.");
  }
}
