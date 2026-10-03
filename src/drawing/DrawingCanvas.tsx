import "@excalidraw/excalidraw/index.css";

import { Excalidraw, exportToSvg, getSceneVersion } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, NonDeleted } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import { useImperativeHandle, useMemo, useRef, type Ref } from "react";
import type { DrawingScene } from "../../shared/api";

// Fonts are served by our own server (see server/index.ts), not a CDN.
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";

export type DrawingSnapshot = {
  scene: DrawingScene;
  /** SVG markup of the drawing, or null when it is empty. */
  preview: string | null;
};

export type DrawingCanvasHandle = {
  /** The scene as it is now, plus a rendered preview. Still usable after unmount. */
  snapshot: () => Promise<DrawingSnapshot>;
};

type Latest = {
  elements: readonly ExcalidrawElement[];
  appState: AppState | null;
  files: BinaryFiles;
};

const live = (elements: readonly ExcalidrawElement[]) =>
  elements.filter((e) => !e.isDeleted) as NonDeleted<ExcalidrawElement>[];

async function snapshotOf({ elements, appState, files }: Latest): Promise<DrawingSnapshot> {
  const els = live(elements);
  const used = new Set(els.map((e) => (e as { fileId?: string | null }).fileId).filter(Boolean));
  const usedFiles = Object.fromEntries(Object.entries(files).filter(([id]) => used.has(id))) as BinaryFiles;
  const viewBackgroundColor = appState?.viewBackgroundColor ?? "#ffffff";
  const scene: DrawingScene = { elements: els, appState: { viewBackgroundColor }, files: usedFiles };
  if (!els.length) return { scene, preview: null };

  const svg = await exportToSvg({
    elements: els,
    appState: { exportBackground: true, viewBackgroundColor, exportWithDarkMode: false },
    files: usedFiles,
    exportPadding: 16,
  });
  if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return { scene, preview: svg.outerHTML };
}

/**
 * Excalidraw, loaded from a stored scene. Reports edits through `onEdit`
 * (with the number of shapes) and hands back snapshots through `handleRef`.
 */
export default function DrawingCanvas({
  scene,
  name,
  onEdit,
  handleRef,
}: {
  scene: DrawingScene | null;
  name?: string;
  onEdit?: (shapeCount: number) => void;
  handleRef?: Ref<DrawingCanvasHandle>;
}) {
  const latest = useRef<Latest>({ elements: [], appState: null, files: {} });
  const version = useRef<string | null>(null);

  // Excalidraw reads initialData once, on mount.
  const initialData = useMemo(
    () => ({
      elements: (scene?.elements ?? []) as ExcalidrawElement[],
      appState: { viewBackgroundColor: "#ffffff", ...(scene?.appState ?? {}) },
      files: (scene?.files ?? {}) as BinaryFiles,
      scrollToContent: true,
    }),
    [],
  );

  useImperativeHandle(handleRef, () => {
    const state = latest;
    return { snapshot: () => snapshotOf(state.current) };
  }, []);

  return (
    <div className="drawing-canvas">
      <Excalidraw
        initialData={initialData}
        name={name}
        theme="light"
        autoFocus
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: null, export: false },
        }}
        onChange={(elements, appState, files) => {
          latest.current = { elements, appState, files };
          const v = `${getSceneVersion(elements)}|${appState.viewBackgroundColor}`;
          if (version.current === null) {
            version.current = v; // the initial render of the stored scene
            return;
          }
          if (v !== version.current) {
            version.current = v;
            onEdit?.(live(elements).length);
          }
        }}
      />
    </div>
  );
}
