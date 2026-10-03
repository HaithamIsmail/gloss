import { createStyleSpec } from "@blocknote/core";

/**
 * Text mark linking a passage to an image region. The value is the region's
 * annotation id. BlockNote renders it with data-style-type="annotation" and
 * data-value="<id>", which the page-level CSS (AnnotationCSS) uses to number
 * and highlight passages.
 */
export const annotationStyle = createStyleSpec(
  { type: "annotation", propSchema: "string" },
  {
    render: () => {
      const span = document.createElement("span");
      span.className = "ann-link";
      return { dom: span, contentDOM: span };
    },
  },
);
