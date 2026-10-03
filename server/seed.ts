import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Annotation, LooseBlock } from "../shared/content";
import { ANNOTATED_IMAGE, MATH_BLOCK } from "../shared/content";
import { newCell } from "../shared/pages";
import { UPLOAD_DIR } from "./db";
import { createCourse, createMaterial, isEmpty } from "./repo";

// A schematic heart, drawn for the demo material so the annotation features
// have something to point at on first launch.
const HEART_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="1600" height="1200">
  <defs>
    <pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="9" stroke="#201e1d" stroke-width="1.2" opacity=".22"/>
    </pattern>
  </defs>
  <rect width="800" height="600" fill="#faf9f8"/>
  <g fill="none" stroke="#201e1d" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    <path d="M196 20 V118 M244 20 V118" />
    <path d="M78 600 V250 Q78 222 106 222 H112 M126 600 V262" />
    <path d="M560 262 V120 Q560 40 470 40 Q392 40 392 96 M612 262 V130 Q612 0 470 0" />
    <path d="M300 306 V180 Q300 120 360 120 H410 M346 306 V196 Q346 166 376 166 H410" />
    <path d="M700 110 H760 M700 160 H760 M436 120 H404 M436 170 H404" />
  </g>
  <g stroke="#201e1d" stroke-width="3" stroke-linejoin="round">
    <rect x="100" y="112" width="232" height="148" rx="44" fill="url(#hatch)"/>
    <rect x="436" y="76" width="264" height="136" rx="44" fill="url(#hatch)"/>
    <path d="M132 316 Q132 304 146 304 H364 Q378 304 378 318 V430 Q378 500 300 500 H180 Q132 500 132 452 Z" fill="#efeceb"/>
    <path d="M404 268 Q404 256 418 256 H672 Q688 256 688 272 V380 Q688 470 560 520 Q470 540 430 488 Q404 452 404 400 Z" fill="#e2dfde"/>
  </g>
  <g fill="#201e1d" opacity=".5">
    <circle cx="300" cy="306" r="6"/><circle cx="560" cy="262" r="6"/>
  </g>
  <text x="24" y="580" font-family="ui-monospace, Menlo, monospace" font-size="15" fill="#605d5d">fig. 3.1 — schematic, anterior view</text>
</svg>`;

type Span = string | [string, string] | { type: string; props: Record<string, string> };

/** Inline content where `[text, annotationId]` pairs become linked passages. */
function inline(...spans: Span[]) {
  return spans.map((s) =>
    typeof s === "string"
      ? { type: "text", text: s, styles: {} }
      : Array.isArray(s)
        ? { type: "text", text: s[0], styles: { annotation: s[1] } }
        : s,
  );
}

const math = (latex: string) => ({ type: "math", props: { latex } });
/** An "@" link to a material, or to one region of an image on it. */
const mention = (targetId: string, label: string, annotationId = "", blockId = "") => ({
  type: "mention",
  props: { targetId, annotationId, blockId, label },
});

const block = (type: string, content: unknown = "", props: Record<string, unknown> = {}): LooseBlock => ({
  id: nanoid(10),
  type,
  props,
  content,
  children: [],
});
const h1 = (t: string) => block("heading", t, { level: 1 });
const h2 = (t: string) => block("heading", t, { level: 2 });
const p = (...spans: Span[]) => block("paragraph", inline(...spans));

export function seedIfEmpty() {
  if (!isEmpty() || process.env.SEED === "0") return;

  const heartFile = "seed-heart.svg";
  fs.writeFileSync(path.join(UPLOAD_DIR, heartFile), HEART_SVG);

  const ra = nanoid(10);
  const la = nanoid(10);
  const rv = nanoid(10);
  const lv = nanoid(10);
  const annotations: Annotation[] = [
    { id: ra, x: 11.5, y: 17.5, w: 31, h: 27, comment: "Right atrium. Thin-walled; the SVC enters from above and the IVC from below." },
    { id: la, x: 53.5, y: 11.5, w: 34, h: 25, comment: "Left atrium. Four pulmonary veins drain into its posterior wall." },
    { id: rv, x: 15.5, y: 49.5, w: 32, h: 35, comment: "Right ventricle. Crescent-shaped in cross-section." },
    { id: lv, x: 49.5, y: 41.5, w: 37, h: 47, comment: "Left ventricle. Wall roughly three times thicker than the right." },
  ];

  const diagram = block(ANNOTATED_IMAGE, undefined, {
    url: `/uploads/${heartFile}`,
    name: "heart.svg",
    annotations: JSON.stringify(annotations),
  });

  const anatomy = createCourse({ name: "Human Anatomy", code: "ANAT 201" });
  const heart = createMaterial(anatomy.id, {
    title: "Unit 3 · The Heart",
    content: [
      h1("Overview"),
      p("The heart is a four-chambered muscular pump. Two atria receive blood and two ventricles push it out, keeping the pulmonary and systemic circuits separate."),
      h2("Position in the thorax"),
      p("It sits in the middle mediastinum between the lungs, with about two thirds of its mass left of the midline."),
      block("callout", inline("Exam tip: be able to name every vessel that enters or leaves each chamber.")),
      h1("Chambers"),
      h2("Atria"),
      p("The ", ["right atrium", ra], " receives deoxygenated blood from the superior and inferior venae cavae. The ", ["left atrium", la], " receives oxygenated blood returning from the lungs through the ", ["pulmonary veins", la], "."),
      h2("Ventricles"),
      p("The ", ["right ventricle", rv], " pumps blood to the lungs through the pulmonary trunk. The ", ["left ventricle", lv], " has the ", ["thickest wall", lv], " because it drives blood through the entire systemic circulation via the aorta."),
      h2("Labelled diagram"),
      diagram,
      h2("Cardiac output"),
      p("The volume pumped per minute is the heart rate times the stroke volume, ", math(String.raw`CO = HR \times SV`), ":"),
      block(MATH_BLOCK, undefined, {
        latex: String.raw`CO = HR \times SV \approx 70 \times 70\,\text{mL} \approx 5\,\text{L/min}`,
      }),
      h1("Conduction system"),
      p("The sinoatrial node sets the rhythm. The impulse spreads across the atria, pauses at the atrioventricular node, then travels down the bundle of His into the Purkinje fibres."),
      block("bulletListItem", inline("SA node: pacemaker, 60–100 bpm")),
      block("bulletListItem", inline("AV node: delays the impulse so the ventricles can fill")),
      block("checkListItem", inline("Review the ECG waveform before the lab"), { checked: false }),
      block("checkListItem", inline("Redraw the diagram from memory"), { checked: true }),
    ],
  });
  createMaterial(anatomy.id, {
    title: "Unit 4 · Blood vessels",
    content: [
      h1("Arteries"),
      p("Arteries carry blood away from the heart under high pressure. The aorta leaves the ", mention(heart!.id, "Left ventricle. Wall roughly three times thicker than the right.", lv, diagram.id), "; see ", mention(heart!.id, "Unit 3 · The Heart"), "."),
      h1("Veins"),
      p(),
    ],
  });

  const linalg = createCourse({ name: "Linear Algebra", code: "MATH 221" });
  createMaterial(linalg.id, {
    title: "Eigenvalues and eigenvectors",
    content: [
      h1("Definition"),
      p("A nonzero vector ", math("v"), " is an eigenvector of ", math("A"), " if ", math(String.raw`Av = \lambda v`), " for some scalar ", math(String.raw`\lambda`), "."),
      h2("Characteristic polynomial"),
      p("The eigenvalues are the roots of"),
      block(MATH_BLOCK, undefined, { latex: String.raw`\det(A - \lambda I) = 0` }),
    ],
  });
  createMaterial(linalg.id, {
    title: "Eigenvalues in Python",
    kind: "notebook",
    content: {
      cells: [
        newCell("markdown", "# Computing eigenvalues\n\nNumPy finds them with `np.linalg.eig`. Run a cell with **Shift+Enter**."),
        newCell(
          "code",
          ["import numpy as np", "", "A = np.array([[2, 1],", "              [1, 2]])", "values, vectors = np.linalg.eig(A)", "values"].join("\n"),
        ),
        newCell("markdown", String.raw`## Check` + "\n\n" + String.raw`Every pair satisfies $Av = \lambda v$:`),
        newCell("code", "np.allclose(A @ vectors, vectors * values)"),
      ],
      metadata: {
        kernelspec: { name: "python3", display_name: "Python 3 (Pyodide)", language: "python" },
        language_info: { name: "python" },
      },
    },
  });

  createCourse({ name: "Organic Chemistry", code: "CHEM 230" });
}
