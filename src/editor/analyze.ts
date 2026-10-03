import {
  ANNOTATED_IMAGE,
  buildOutline,
  parseAnnotations,
  walkBlocks,
  type LooseBlock,
} from "../../shared/content";
import type { DocInfo, RegionInfo } from "../store";
import { countLinks } from "./links";
import type { StudyEditor } from "./schema";

/** Index, region numbering and link counts for the document in the editor. */
export function analyzeDoc(editor: StudyEditor, materialId: string): DocInfo {
  const blocks = editor.document as unknown as LooseBlock[];
  const regions: RegionInfo[] = [];
  const numbers: Record<string, number> = {};
  walkBlocks(blocks, (b) => {
    if (b.type !== ANNOTATED_IMAGE) return;
    for (const a of parseAnnotations(b.props?.annotations)) {
      const n = regions.length + 1;
      numbers[a.id] = n;
      regions.push({ ...a, n, blockId: b.id, url: String(b.props?.url ?? "") });
    }
  });
  return {
    materialId,
    outline: buildOutline(blocks),
    regions,
    numbers,
    linkCounts: countLinks(editor),
  };
}
