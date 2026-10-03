import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { DrawingSummary } from "../shared/api";
import type { Annotation, OutlineItem } from "../shared/content";

/** A region as it appears in the open material, numbered in document order. */
export type RegionInfo = Annotation & { n: number; blockId: string; url: string };

export type DocInfo = {
  materialId: string | null;
  outline: OutlineItem[];
  regions: RegionInfo[];
  /** annotation id -> number shown on its box, badge and linked passages */
  numbers: Record<string, number>;
  /** annotation id -> number of linked text passages */
  linkCounts: Record<string, number>;
};

export type Prefs = {
  numbering: boolean;
  highlight: "marker" | "underline";
  showIndex: boolean;
};

export type HoverSource = "text" | "image" | "comment" | "search";

export type SaveState = "idle" | "saving" | "saved" | "error";

/** A drawing opened full screen on top of a page (see DrawingModal). */
export type DrawingSession = {
  /** null: a new drawing, created on submit. */
  drawingId: string | null;
  courseId: string | null;
  submitLabel: string;
  onSaved: (drawing: DrawingSummary) => void;
  onCancel?: () => void;
};

/** A PDF or slide deck being imported (see slides/SlideImport.tsx). */
export type SlideImportState = {
  fileName: string;
  message: string;
  done?: number;
  total?: number;
  error?: string;
  cancel: () => void;
};

type UIState = {
  slideImport: SlideImportState | null;
  setSlideImport: (s: SlideImportState | null) => void;

  hovered: string | null;
  hoverSource: HoverSource | null;
  setHovered: (id: string | null, source?: HoverSource) => void;

  /** Annotation currently being linked to text passages. */
  linking: string | null;
  setLinking: (id: string | null) => void;

  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;

  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;

  expanded: Record<string, boolean>;
  setExpanded: (courseId: string, open: boolean) => void;

  prefs: Prefs;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;

  doc: DocInfo;
  setDoc: (doc: DocInfo) => void;

  save: SaveState;
  setSave: (s: SaveState) => void;

  drawingSession: DrawingSession | null;
  openDrawing: (session: DrawingSession) => void;
  closeDrawing: () => void;

  /** Material whose version history is open. */
  historyFor: string | null;
  setHistoryFor: (id: string | null) => void;

  /** Material being moved with the "Move to" dialog. */
  moving: string | null;
  setMoving: (id: string | null) => void;

  /** Bumped to re-open the current material from its saved state (after restoring a version). */
  revision: number;
  reloadMaterial: () => void;
};

const emptyDoc: DocInfo = { materialId: null, outline: [], regions: [], numbers: {}, linkCounts: {} };

export const useUI = create<UIState>()(
  persist(
    (set, get) => ({
      slideImport: null,
      setSlideImport: (slideImport) => set({ slideImport }),
      hovered: null,
      hoverSource: null,
      setHovered: (id, source) => {
        const s = get();
        if (s.hovered === id && (id === null || s.hoverSource === source)) return;
        set({ hovered: id, hoverSource: id ? (source ?? null) : null });
      },

      linking: null,
      setLinking: (id) => set({ linking: id }),

      searchOpen: false,
      setSearchOpen: (open) => set({ searchOpen: open }),

      sidebarOpen: typeof window === "undefined" || window.innerWidth > 760,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),

      expanded: {},
      setExpanded: (courseId, open) => set((s) => ({ expanded: { ...s.expanded, [courseId]: open } })),

      prefs: { numbering: true, highlight: "marker", showIndex: true },
      setPref: (key, value) => set((s) => ({ prefs: { ...s.prefs, [key]: value } })),

      doc: emptyDoc,
      setDoc: (doc) => set({ doc }),

      save: "idle",
      setSave: (save) => set({ save }),

      drawingSession: null,
      openDrawing: (drawingSession) => set({ drawingSession }),
      closeDrawing: () => set({ drawingSession: null }),

      historyFor: null,
      setHistoryFor: (historyFor) => set({ historyFor }),

      moving: null,
      setMoving: (moving) => set({ moving }),

      revision: 0,
      reloadMaterial: () => set((s) => ({ revision: s.revision + 1 })),
    }),
    {
      name: "study-ws-ui",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ expanded: s.expanded, prefs: s.prefs, sidebarOpen: s.sidebarOpen }),
    },
  ),
);

export const resetDoc = () =>
  useUI.setState({ doc: emptyDoc, hovered: null, hoverSource: null, linking: null, save: "idle" });
