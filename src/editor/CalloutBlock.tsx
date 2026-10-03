import { defaultProps } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";

const TONES = ["note", "tip", "warning", "exam"] as const;
type Tone = (typeof TONES)[number];

/** A boxed note. Click the label to cycle its tone. */
export const CalloutBlock = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      textAlignment: defaultProps.textAlignment,
      tone: { default: "note" as Tone, values: TONES },
    },
    content: "inline",
  },
  {
    render: ({ block, editor, contentRef }) => {
      const tone = block.props.tone;
      const next = TONES[(TONES.indexOf(tone) + 1) % TONES.length];
      return (
        <div className="callout" data-tone={tone}>
          <button
            type="button"
            className="callout-tone"
            contentEditable={false}
            title="Change callout type"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.updateBlock(block, { props: { tone: next } })}
          >
            {tone}
          </button>
          <div className="callout-body" ref={contentRef} />
        </div>
      );
    },
  },
);
