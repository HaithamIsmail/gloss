import {
  BlockNoteSchema,
  createHeadingBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";
import { AnnotatedImageBlock } from "./AnnotatedImageBlock";
import { annotationStyle } from "./annotationStyle";
import { CalloutBlock } from "./CalloutBlock";
import { DrawingBlock } from "./DrawingBlock";
import { MathBlock, MathInline } from "./MathBlocks";
import { Mention } from "./Mention";

// The stock image block is replaced by the annotated one, which also receives
// pasted and dropped image files (via its fileBlockAccept).
const { image: _image, ...blocks } = defaultBlockSpecs;

export const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...blocks,
    heading: createHeadingBlockSpec({ levels: [1, 2, 3] }),
    annotatedImage: AnnotatedImageBlock(),
    callout: CalloutBlock(),
    drawing: DrawingBlock(),
    mathBlock: MathBlock(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    math: MathInline,
    mention: Mention,
  },
  // Listed first so the link mark wraps other marks and a passage renders as
  // one element (one number) even when part of it is bold or italic.
  styleSpecs: { annotation: annotationStyle, ...defaultStyleSpecs },
});

export type StudyEditor = typeof schema.BlockNoteEditor;
