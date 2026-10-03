import { filterSuggestionItems } from "@blocknote/core/extensions";
import { BlockNoteView, type Theme } from "@blocknote/mantine";
import {
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from "@blocknote/react";
import { useCallback, useEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";
import type { Material } from "../../shared/api";
import type { LooseBlock } from "../../shared/content";
import { api, keys, patchTreeMaterial, queryClient } from "../api";
import { registerFlusher } from "../flush";
import { useUI } from "../store";
import { analyzeDoc } from "./analyze";
import { LinkRegionButton } from "./LinkRegionButton";
import { MathButton } from "./MathButton";
import { getMentionItems } from "./Mention";
import { schema } from "./schema";
import { getSlashItems } from "./slashMenu";

const SAVE_DELAY = 700;

// Stands in for formulas and links when reading the text before the cursor.
const ATOM = String.fromCharCode(0xfffc);
// An opening $ not glued to a word (so "$5 and $10" stays text), no spaces just inside.
const INLINE_MATH = /(^|[^\\\w$])\$([^$\s](?:[^$]*[^$\s])?)$/;

const ink = "#201e1d";
const ground = "#f3f2f2";

const theme: Theme = {
  colors: {
    editor: { text: ink, background: "transparent" },
    menu: { text: ink, background: ground },
    tooltip: { text: ground, background: ink },
    hovered: { text: ink, background: "#ffe0d9" },
    selected: { text: ground, background: "#ec3013" },
    disabled: { text: "#9b9797", background: "#eae7e7" },
    shadow: "rgba(45, 43, 43, 0.22)",
    border: ink,
    sideMenu: "#7d7979",
  },
  borderRadius: 0,
  fontFamily: '"Archivo Variable", "Archivo", system-ui, sans-serif',
};

export function MaterialEditor({ material }: { material: Material }) {
  const setDoc = useUI((s) => s.setDoc);
  const setSave = useUI((s) => s.setSave);
  const setHovered = useUI((s) => s.setHovered);
  const prefs = useUI((s) => s.prefs);

  const editor = useCreateBlockNote(
    {
      schema,
      initialContent:
        Array.isArray(material.content) && material.content.length ? (material.content as never) : undefined,
      uploadFile: async (file: File) => (await api.upload(file)).url,
      tables: { headers: true, splitCells: true, cellBackgroundColor: true, cellTextColor: true },
      placeholders: { default: "Type '/' for blocks", emptyDocument: "Start writing, or type '/' for blocks" },
    },
    [material.id],
  );

  if (import.meta.env.DEV) (window as unknown as { __editor: unknown }).__editor = editor;

  // ── Derived info (index, region numbers, link counts) ────────────────────
  const raf = useRef(0);
  const analyze = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const prev = useUI.getState().doc;
      const next = analyzeDoc(editor, material.id);
      const keep = <K extends keyof typeof next>(k: K) =>
        prev.materialId === next.materialId && JSON.stringify(prev[k]) === JSON.stringify(next[k]) ? prev[k] : next[k];
      const doc = {
        materialId: next.materialId,
        outline: keep("outline"),
        regions: keep("regions"),
        numbers: keep("numbers"),
        linkCounts: keep("linkCounts"),
      };
      if (Object.keys(doc).some((k) => doc[k as keyof typeof doc] !== prev[k as keyof typeof prev])) setDoc(doc);
    });
  }, [editor, material.id, setDoc]);

  useEffect(() => {
    analyze();
    return () => cancelAnimationFrame(raf.current);
  }, [analyze]);

  // ── Autosave ─────────────────────────────────────────────────────────────
  const timer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    const content = editor.document as unknown as LooseBlock[];
    queryClient.setQueryData<Material>(keys.material(material.id), (m) => m && { ...m, content });
    setSave("saving");
    try {
      const summary = await api.updateMaterial(material.id, { content });
      patchTreeMaterial(summary);
      if (!dirty.current) setSave("saved");
    } catch (err) {
      console.error(err);
      dirty.current = true;
      setSave("error");
    }
  }, [editor, material.id, setSave]);

  const onChange = useCallback(() => {
    dirty.current = true;
    setSave("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY);
    analyze();
  }, [analyze, flush, setSave]);

  useEffect(() => registerFlusher(flush), [flush]);

  useEffect(() => {
    // Best-effort save when the tab closes with unsaved edits.
    const onUnload = () => {
      if (!dirty.current) return;
      void fetch(`/api/materials/${material.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editor.document }),
        keepalive: true,
      });
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      void flush();
    };
  }, [editor, flush, material.id]);

  // ── Passage hover + linking ──────────────────────────────────────────────
  const onMouseOver = (e: MouseEvent) => {
    const target = e.target as Element;
    if (target.closest(".ann-block")) return; // the image block reports its own hovers
    const link = target.closest(".ann-link");
    const id = link?.getAttribute("data-value") ?? null;
    if (id && useUI.getState().doc.numbers[id]) setHovered(id, "text");
    else if (useUI.getState().hoverSource === "text") setHovered(null);
  };

  const onMouseLeave = () => {
    if (useUI.getState().hoverSource === "text") setHovered(null);
  };

  const onMouseUp = (e: MouseEvent) => {
    const linking = useUI.getState().linking;
    if (!linking || (e.target as Element).closest(".ann-block")) return;
    // Let the editor settle the selection first.
    window.setTimeout(() => {
      if (!editor.getSelectedText().trim()) return;
      editor.addStyles({ annotation: linking });
      setHovered(linking, "comment");
    }, 0);
  };

  // Typing $…$ turns the text between the dollars into a formula, and $$ on an
  // empty line starts a formula block.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "$" || e.ctrlKey || e.metaKey || e.altKey) return;
    const { selection } = editor.prosemirrorState;
    if (!selection.empty) return;
    const $from = selection.$from;
    if (!$from.parent.isTextblock || $from.parent.type.spec.code) return;
    const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 300), $from.parentOffset, undefined, ATOM);
    if (before === "$" && $from.parent.textContent === "$") {
      e.preventDefault();
      const block = editor.getTextCursorPosition().block;
      editor.updateBlock(block, { type: "mathBlock", props: { latex: "" }, content: undefined } as never);
      return;
    }
    const m = INLINE_MATH.exec(before);
    if (!m || m[2].includes(ATOM)) return;
    e.preventDefault();
    const latex = m[2];
    const from = $from.pos - latex.length - 1;
    editor.transact((tr) => {
      const node = tr.doc.type.schema.nodes.math?.create({ latex });
      if (node) tr.replaceWith(from, $from.pos, node);
    });
  };

  return (
    <div
      className="material-doc"
      onKeyDown={onKeyDown}
      data-numbering={prefs.numbering ? "on" : "off"}
      data-highlight={prefs.highlight}
      onMouseOver={onMouseOver}
      onMouseLeave={onMouseLeave}
      onMouseUp={onMouseUp}
    >
      <BlockNoteView
        editor={editor}
        theme={theme}
        onChange={onChange}
        slashMenu={false}
        formattingToolbar={false}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) => filterSuggestionItems(getSlashItems(editor), query)}
        />
        <SuggestionMenuController triggerCharacter="@" getItems={(query) => getMentionItems(editor, query)} />
        <FormattingToolbarController
          formattingToolbar={() => (
            <FormattingToolbar>
              {getFormattingToolbarItems()}
              <MathButton key="math" />
              <LinkRegionButton key="linkRegion" />
            </FormattingToolbar>
          )}
        />
      </BlockNoteView>
    </div>
  );
}
