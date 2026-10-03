import { Link2 } from "lucide-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import type { Material } from "../../../shared/api";
import { useTree } from "../../api";
import { AnnotationCSS } from "../../components/AnnotationCSS";
import { Backlinks } from "../../components/Backlinks";
import { IndexPanel } from "../../components/IndexPanel";
import { RegionPeek } from "../../components/RegionPeek";
import { scrollToBlock } from "../../editor/links";
import { MaterialEditor } from "../../editor/MaterialEditor";
import { useUI } from "../../store";
import { TitleInput } from "./shared";

/** A block-editor page: sections, text, annotated images, drawings. */
export default function DocView({ material }: { material: Material }) {
  const { data: tree } = useTree();
  const course = tree?.courses.find((c) => c.id === material.courseId);
  const showIndex = useUI((s) => s.prefs.showIndex);
  const linking = useUI((s) => s.linking);
  const linkingN = useUI((s) => (s.linking ? s.doc.numbers[s.linking] : undefined));
  const setLinking = useUI((s) => s.setLinking);
  const [params, setParams] = useSearchParams();

  // Arriving from search: scroll to the block and briefly light up the region.
  const blockParam = params.get("block");
  const annParam = params.get("ann");
  useEffect(() => {
    if (!blockParam) return;
    const t = window.setTimeout(() => {
      const box = annParam && document.querySelector(`.ann-box[data-ann="${CSS.escape(annParam)}"]`);
      if (box) box.scrollIntoView({ behavior: "smooth", block: "center" });
      else scrollToBlock(blockParam, { flash: !annParam, block: "center" });
      if (annParam) {
        const { setHovered } = useUI.getState();
        setHovered(annParam, "search");
        window.setTimeout(() => {
          if (useUI.getState().hoverSource === "search") setHovered(null);
        }, 2400);
      }
      setParams({}, { replace: true });
    }, 150);
    return () => window.clearTimeout(t);
  }, [blockParam, annParam, setParams]);

  return (
    <div className={`material-page${showIndex ? " has-index" : ""}`}>
      <div className="material-col">
        {linking && (
          <div className="linking-banner">
            <Link2 size={16} />
            <span className="grow">
              Select a passage anywhere on this page to link it to region {linkingN ?? ""}.
            </span>
            <button type="button" className="btn-primary small" onClick={() => setLinking(null)}>
              Done
            </button>
          </div>
        )}
        <div className="kicker">{[course?.code, course?.name].filter(Boolean).join(" · ")}</div>
        <TitleInput
          material={material}
          onEnter={() => document.querySelector<HTMLElement>(".material-doc .bn-editor")?.focus()}
        />
        <MaterialEditor material={material} />
        <Backlinks materialId={material.id} />
      </div>
      {showIndex && <IndexPanel material={material} />}
      <AnnotationCSS />
      <RegionPeek />
    </div>
  );
}
