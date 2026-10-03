import { useMemo } from "react";
import { useUI } from "../store";

const sel = (id: string) => `.material-doc .ann-link[data-value="${CSS.escape(id)}"]`;

/**
 * Linked passages are plain marked-up spans inside the editor; this stylesheet
 * numbers them (superscript after each passage) and lights up the passages of
 * the hovered region. Marks pointing at deleted regions stay unstyled.
 * Colours come from the --ann-* variables in editor.css.
 */
export function AnnotationCSS() {
  const numbers = useUI((s) => s.doc.numbers);
  const hovered = useUI((s) => s.hovered);

  const base = useMemo(() => {
    const ids = Object.keys(numbers);
    if (!ids.length) return "";
    return [
      `${ids.map(sel).join(",\n")} {
        background: var(--ann-bg);
        box-shadow: inset 0 -2px 0 var(--ann-rule);
        cursor: pointer;
      }`,
      ...ids.map((id) => `${sel(id)}::after { content: "${numbers[id]}"; }`),
    ].join("\n");
  }, [numbers]);

  const active =
    hovered && numbers[hovered]
      ? `${sel(hovered)}, ${sel(hovered)}::after {
          background: var(--ann-bg-active);
          box-shadow: inset 0 -2px 0 var(--color-accent);
        }`
      : "";

  return (
    <style>
      {base}
      {"\n"}
      {active}
    </style>
  );
}
