import type { BlockNoteEditor } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { Columns2, ImageUp, Link2, LoaderCircle, Rows2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { ANNOTATED_IMAGE, parseAnnotations, type Annotation } from "../../shared/content";
import { plural, RegionComments } from "../annotate/RegionComments";
import { RegionStage } from "../annotate/RegionStage";
import { useUI } from "../store";
import { flash, passageElements, removeAnnotationLinks } from "./links";

type Layout = "side" | "below";

type ImageBlock = {
  id: string;
  props: { url: string; name: string; annotations: string; layout: Layout };
};

export const AnnotatedImageBlock = createReactBlockSpec(
  {
    type: ANNOTATED_IMAGE,
    propSchema: {
      url: { default: "" },
      name: { default: "" },
      annotations: { default: "[]" },
      layout: { default: "side" as Layout, values: ["side", "below"] as const },
    },
    content: "none",
  },
  {
    meta: { fileBlockAccept: ["image/*"], selectable: false },
    render: ({ block, editor }) => <AnnotatedImage block={block as ImageBlock} editor={editor} />,
  },
);

function AnnotatedImage({ block, editor }: { block: ImageBlock; editor: BlockNoteEditor<any, any, any> }) {
  const { url, name, layout } = block.props;
  const anns = useMemo(() => parseAnnotations(block.props.annotations), [block.props.annotations]);
  const [editing, setEditing] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileOver, setFileOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const setHovered = useUI((s) => s.setHovered);
  const linking = useUI((s) => s.linking);
  const setLinking = useUI((s) => s.setLinking);
  const numbers = useUI((s) => s.doc.numbers);
  const linkCounts = useUI((s) => s.doc.linkCounts);
  const numberOf = (a: Annotation, i: number) => numbers[a.id] ?? i + 1;

  /** Annotations as currently stored on the block (never a stale render). */
  const current = useCallback(
    () => parseAnnotations(editor.getBlock(block.id)?.props.annotations ?? "[]"),
    [editor, block.id],
  );
  const save = useCallback(
    (next: Annotation[]) => editor.updateBlock(block.id, { props: { annotations: JSON.stringify(next) } }),
    [editor, block.id],
  );

  const deleteAnn = (id: string) => {
    editor.transact(() => {
      save(current().filter((a) => a.id !== id));
      removeAnnotationLinks(editor, [id]);
    });
    if (linking === id) setLinking(null);
    setEditing(null);
    setHovered(null);
  };

  // Leaving linking mode when this block disappears (e.g. deleted from the side menu).
  useEffect(
    () => () => {
      const { linking: l, setLinking: set } = useUI.getState();
      if (l && anns.some((a) => a.id === l)) set(null);
    },
    [],
  );

  const upload = async (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/") || !editor.uploadFile) return;
    setUploading(true);
    try {
      const res = await editor.uploadFile(file, block.id);
      const nextUrl = typeof res === "string" ? res : (res.props?.url as string);
      if (editor.getBlock(block.id)) editor.updateBlock(block.id, { props: { url: nextUrl, name: file.name } });
    } catch (err) {
      console.error(err);
      alert("Upload failed. Is the server running?");
    } finally {
      setUploading(false);
    }
  };

  const fileDrag = {
    onDragOver: (e: ReactDragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      setFileOver(true);
    },
    onDragLeave: () => setFileOver(false),
    onDrop: (e: ReactDragEvent) => {
      setFileOver(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      void upload(file);
    },
  };

  // Cycles through a region's linked passages on repeated clicks.
  const jumpIndex = useRef<Record<string, number>>({});
  const jumpToPassage = (id: string) => {
    const els = passageElements(id);
    if (!els.length) return;
    const i = (jumpIndex.current[id] ?? -1) + 1;
    jumpIndex.current[id] = i % els.length;
    const el = els[i % els.length];
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    flash(el);
  };

  const showUploading = uploading || (!url && !!name);

  return (
    <div
      className="ann-block"
      data-layout={layout}
      contentEditable={false}
      suppressContentEditableWarning
      onMouseLeave={() => {
        if (useUI.getState().hoverSource !== "search") setHovered(null);
      }}
    >
      <div className="block-head">
        <span className="block-head-title">Annotated image</span>
        <span className="block-head-hint">{url ? "Drag on the image to mark a region" : "Upload or drop an image"}</span>
        <div className="block-head-actions">
          <button
            type="button"
            className="block-icon-btn"
            title={layout === "side" ? "Put comments below the image" : "Put comments beside the image"}
            onClick={() => editor.updateBlock(block.id, { props: { layout: layout === "side" ? "below" : "side" } })}
          >
            {layout === "side" ? <Rows2 size={15} /> : <Columns2 size={15} />}
          </button>
          <button type="button" className="block-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <ImageUp size={14} strokeWidth={2.2} />
            <span>{url ? "Replace image" : "Upload image"}</span>
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      <div className="ann-body">
        <div className={`ann-stage-wrap${fileOver ? " is-file-over" : ""}`} {...fileDrag}>
          {url ? (
            <RegionStage
              url={url}
              name={name}
              annotations={anns}
              current={current}
              onCommit={save}
              numberOf={numberOf}
              editing={editing}
              onEdit={setEditing}
            />
          ) : (
            <button type="button" className="block-empty" onClick={() => fileRef.current?.click()}>
              <span>
                {showUploading ? (
                  <>
                    <LoaderCircle size={14} className="spin" /> Uploading {name || "image"}…
                  </>
                ) : (
                  "Drop an image here, paste one, or click to upload"
                )}
              </span>
            </button>
          )}
        </div>

        <RegionComments
          annotations={anns}
          numberOf={numberOf}
          editing={editing}
          onEdit={setEditing}
          hasImage={!!url}
          onComment={(id, comment) => save(current().map((a) => (a.id === id ? { ...a, comment } : a)))}
          onDelete={deleteAnn}
          actions={(a) => {
            const isLinking = linking === a.id;
            const links = linkCounts[a.id] ?? 0;
            return (
              <>
                <button
                  type="button"
                  className={`ann-link-btn${isLinking ? " is-on" : ""}`}
                  onClick={() => {
                    setLinking(isLinking ? null : a.id);
                    setHovered(a.id, "comment");
                  }}
                >
                  <Link2 size={13} strokeWidth={2.4} />
                  <span>{isLinking ? "Linking… done" : "Link text"}</span>
                </button>
                {links > 0 && (
                  <button
                    type="button"
                    className="ann-passages"
                    title="Jump to linked passages"
                    onClick={() => jumpToPassage(a.id)}
                  >
                    {plural(links, "passage")}
                  </button>
                )}
              </>
            );
          }}
        />
      </div>
    </div>
  );
}
