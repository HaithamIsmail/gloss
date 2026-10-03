import { useCallback, useEffect, useRef, useState } from "react";
import type { Material, Tree } from "../../../shared/api";
import { api, keys, patchTreeMaterial, queryClient } from "../../api";
import { registerFlusher } from "../../flush";
import { useUI } from "../../store";

const FRESH_TITLE = /^Untitled (material|image|notebook|folder)$/;

/** The material's title, saved as you type (and flushed if you leave quickly). */
export function TitleInput({
  material,
  className = "input-title material-title-input",
  onEnter,
}: {
  material: Material;
  className?: string;
  onEnter?: () => void;
}) {
  const [title, setTitle] = useState(material.title);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const save = () => {
    window.clearTimeout(timer.current);
    if (pending.current === null) return;
    const title = pending.current;
    pending.current = null;
    return api.updateMaterial(material.id, { title });
  };

  useEffect(() => {
    // A fresh material: put the cursor in its title, ready to type over it.
    if (FRESH_TITLE.test(material.title)) ref.current?.select();
    const unregister = registerFlusher(save);
    return () => {
      unregister();
      void save();
    };
  }, []);

  const onChange = (value: string) => {
    setTitle(value);
    const summary = queryClient
      .getQueryData<Tree>(keys.tree)
      ?.courses.flatMap((c) => c.materials)
      .find((m) => m.id === material.id);
    if (summary) patchTreeMaterial({ ...summary, title: value });
    queryClient.setQueryData<Material>(keys.material(material.id), (m) => m && { ...m, title: value });
    pending.current = value;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, 400);
  };

  return (
    <input
      ref={ref}
      className={className}
      value={title}
      placeholder="Untitled"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (onEnter && (e.key === "Enter" || e.key === "ArrowDown")) {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

/**
 * Debounced autosave of a material's content, for pages that keep their own
 * state (image and notebook pages; the block editor has its own).
 */
export function useContentSaver(materialId: string, delay = 700) {
  const setSave = useUI((s) => s.setSave);
  const pending = useRef<unknown>(undefined);
  const timer = useRef<number | undefined>(undefined);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (pending.current === undefined) return;
    const content = pending.current;
    pending.current = undefined;
    queryClient.setQueryData<Material>(keys.material(materialId), (m) => m && { ...m, content });
    setSave("saving");
    try {
      const summary = await api.updateMaterial(materialId, { content });
      patchTreeMaterial(summary);
      if (pending.current === undefined) setSave("saved");
    } catch (err) {
      console.error(err);
      if (pending.current === undefined) pending.current = content;
      setSave("error");
    }
  }, [materialId, setSave]);

  const save = useCallback(
    (content: unknown) => {
      pending.current = content;
      setSave("saving");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), delay);
    },
    [delay, flush, setSave],
  );

  useEffect(() => registerFlusher(flush), [flush]);

  useEffect(() => {
    // Best-effort save when the tab closes with unsaved edits.
    const onUnload = () => {
      if (pending.current === undefined) return;
      void fetch(`/api/materials/${materialId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: pending.current }),
        keepalive: true,
      });
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      void flush();
    };
  }, [flush, materialId]);

  return { save, flush };
}

/** True when the keyboard is inside a text field (so page shortcuts stay out of the way). */
export function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el?.closest?.("input, textarea, select, [contenteditable='true'], .cm-editor");
}
