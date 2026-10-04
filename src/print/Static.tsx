// Read-only renderings of materials, for printing (Save as PDF) and for
// previewing earlier versions. They work straight from the stored JSON.
import "../styles/notebook.css";

import { Fragment, type ReactNode } from "react";
import type { Material } from "../../shared/api";
import {
  ANNOTATED_IMAGE,
  buildOutline,
  DRAWING,
  MATH_BLOCK,
  parseAnnotations,
  walkBlocks,
  type Annotation,
  type LooseBlock,
  type MentionProps,
} from "../../shared/content";
import { asImagePage, asNotebook } from "../../shared/pages";
import { CommentText } from "../annotate/CommentText";
import { mathHtml } from "../math";
import { Outputs } from "../notebook/Outputs";
import { renderMarkdown } from "../notebook/render";

export function StaticContent({ material, content }: { material: Pick<Material, "kind" | "title">; content: unknown }) {
  if (material.kind === "image") return <StaticImagePage content={content} />;
  if (material.kind === "notebook") return <StaticNotebook content={content} />;
  if (material.kind === "folder") return null;
  return <StaticDoc blocks={Array.isArray(content) ? (content as LooseBlock[]) : []} />;
}

// ── Regions on an image ──────────────────────────────────────────────────

export function StaticRegions({
  url,
  name,
  annotations,
  startAt = 1,
}: {
  url: string;
  name?: string;
  annotations: Annotation[];
  startAt?: number;
}) {
  if (!url) return <p className="muted">No image.</p>;
  return (
    <figure className="static-figure">
      <div className="static-figure-img">
        <img src={url} alt={name ?? ""} />
        {annotations.map((a, i) => (
          <span
            key={a.id}
            className="static-box"
            style={{ left: `${a.x}%`, top: `${a.y}%`, width: `${a.w}%`, height: `${a.h}%` }}
          >
            <span className="static-badge tabular">{startAt + i}</span>
          </span>
        ))}
      </div>
      {annotations.length > 0 && (
        <ol className="static-comments" start={startAt}>
          {annotations.map((a) => (
            <li key={a.id}>{a.comment ? <CommentText text={a.comment} /> : <em className="muted">No comment</em>}</li>
          ))}
        </ol>
      )}
    </figure>
  );
}

function StaticImagePage({ content }: { content: unknown }) {
  const page = asImagePage(content);
  return <StaticRegions url={page.url} name={page.name} annotations={page.annotations} />;
}

// ── Notebooks ────────────────────────────────────────────────────────────

function StaticNotebook({ content }: { content: unknown }) {
  const nb = asNotebook(content);
  return (
    <div className="static-notebook">
      {nb.cells.map((cell) =>
        cell.cell_type === "code" ? (
          <div key={cell.id} className="static-cell">
            <pre className="static-code">
              <span className="static-prompt">[{cell.execution_count ?? " "}]</span>
              {cell.source}
            </pre>
            <Outputs outputs={cell.outputs} />
          </div>
        ) : cell.cell_type === "raw" ? (
          <pre key={cell.id} className="static-code">
            {cell.source}
          </pre>
        ) : (
          <div
            key={cell.id}
            className="nb-markdown"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(cell.source, cell.attachments) }}
          />
        ),
      )}
    </div>
  );
}

// ── Pages (BlockNote JSON) ───────────────────────────────────────────────

type Ctx = { headingNums: Map<string, string>; regionNums: Map<string, number> };

export function StaticDoc({ blocks }: { blocks: LooseBlock[] }) {
  const headingNums = new Map(buildOutline(blocks).map((o) => [o.id, o.num]));
  const regionNums = new Map<string, number>();
  let n = 0;
  walkBlocks(blocks, (b) => {
    if (b.type === ANNOTATED_IMAGE) parseAnnotations(b.props?.annotations).forEach((a) => regionNums.set(a.id, ++n));
  });
  return <div className="static-doc">{renderBlocks(blocks, { headingNums, regionNums })}</div>;
}

const LIST: Record<string, "ul" | "ol"> = {
  bulletListItem: "ul",
  numberedListItem: "ol",
  checkListItem: "ul",
  toggleListItem: "ul",
};

function renderBlocks(blocks: LooseBlock[], ctx: Ctx): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < blocks.length; ) {
    const tag = LIST[blocks[i].type];
    if (!tag) {
      out.push(<StaticBlock key={blocks[i].id ?? i} block={blocks[i]} ctx={ctx} />);
      i++;
      continue;
    }
    // One list per run of the same kind of item (bullets, numbers, checkboxes).
    const run: LooseBlock[] = [];
    const type = blocks[i].type;
    while (i < blocks.length && blocks[i].type === type) run.push(blocks[i++]);
    const List = tag;
    out.push(
      <List key={run[0].id} className={run[0].type === "checkListItem" ? "static-checks" : undefined}>
        {run.map((b) => (
          <li key={b.id} className={b.type === "checkListItem" ? (b.props?.checked ? "is-checked" : "") : undefined}>
            {b.type === "checkListItem" && <span className="static-check">{b.props?.checked ? "☑" : "☐"}</span>}
            <Inline content={b.content} ctx={ctx} />
            {!!b.children?.length && renderBlocks(b.children, ctx)}
          </li>
        ))}
      </List>,
    );
  }
  return out;
}

function StaticBlock({ block: b, ctx }: { block: LooseBlock; ctx: Ctx }) {
  const p = (b.props ?? {}) as Record<string, unknown>;
  const kids = b.children?.length ? <div className="static-children">{renderBlocks(b.children, ctx)}</div> : null;
  const inline = <Inline content={b.content} ctx={ctx} />;
  let el: ReactNode;
  switch (b.type) {
    case "heading": {
      const level = Number(p.level ?? 1);
      const num = ctx.headingNums.get(b.id);
      const H = (level === 1 ? "h2" : level === 2 ? "h3" : "h4") as "h2";
      el = (
        <H className={`static-h${level}`}>
          {num && <span className="static-num tabular">{num}</span>}
          {inline}
        </H>
      );
      break;
    }
    case "quote":
      el = <blockquote>{inline}</blockquote>;
      break;
    case "codeBlock":
      el = <pre className="static-code">{(b.content as { text?: string }[] | undefined)?.map((t) => t.text ?? "").join("")}</pre>;
      break;
    case "divider":
      el = <hr />;
      break;
    case "callout":
      el = (
        <div className="callout static-callout" data-tone={String(p.tone ?? "note")}>
          <span className="callout-tone">{String(p.tone ?? "note")}</span>
          <div className="callout-body">{inline}</div>
        </div>
      );
      break;
    case MATH_BLOCK:
      el = <div className="static-math" dangerouslySetInnerHTML={{ __html: mathHtml(String(p.latex ?? ""), true) }} />;
      break;
    case "table":
      el = <StaticTable content={b.content} ctx={ctx} />;
      break;
    case ANNOTATED_IMAGE: {
      const anns = parseAnnotations(p.annotations);
      el = (
        <StaticRegions
          url={String(p.url ?? "")}
          name={String(p.name ?? "")}
          annotations={anns}
          startAt={anns[0] ? (ctx.regionNums.get(anns[0].id) ?? 1) : 1}
        />
      );
      break;
    }
    case DRAWING:
      el = p.drawingId ? (
        <figure className="static-figure">
          <img className="static-drawing" src={`/api/drawings/${String(p.drawingId)}/preview.svg`} alt="Drawing" />
        </figure>
      ) : null;
      break;
    case "image":
      el = p.url ? <img className="static-image" src={String(p.url)} alt={String(p.caption ?? "")} /> : null;
      break;
    case "video":
    case "audio":
    case "file":
      el = p.url ? (
        <p>
          <a href={String(p.url)}>{String(p.name || p.caption || "Attachment")}</a>
        </p>
      ) : null;
      break;
    default:
      el = <p>{inline}</p>;
  }
  return (
    <>
      {el}
      {kids}
    </>
  );
}

function StaticTable({ content, ctx }: { content: unknown; ctx: Ctx }) {
  const rows = (content as { rows?: { cells: unknown[] }[] })?.rows ?? [];
  return (
    <table className="static-table">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.cells.map((c, j) => {
              const cell = c as { type?: string; content?: unknown };
              return (
                <td key={j}>
                  <Inline content={cell?.type === "tableCell" ? cell.content : c} ctx={ctx} />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Inline({ content, ctx }: { content: unknown; ctx: Ctx }): ReactNode {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const out: ReactNode[] = [];
  // Consecutive pieces linked to the same region get one number after them.
  let region: string | null = null;
  const closeRegion = (key: string) => {
    const n = region ? ctx.regionNums.get(region) : undefined;
    if (n) out.push(<sup key={`r${key}`} className="static-ref tabular">{n}</sup>);
    region = null;
  };
  content.forEach((raw, i) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const styles = (item.styles ?? {}) as Record<string, unknown>;
    const ann = typeof styles.annotation === "string" && styles.annotation ? styles.annotation : null;
    if (ann !== region) closeRegion(String(i));
    if (item.type === "text") {
      out.push(<Styled key={i} text={String(item.text ?? "")} styles={styles} linked={!!ann} />);
      region = ann;
    } else if (item.type === "link") {
      out.push(
        <a key={i} href={String(item.href ?? "")}>
          <Inline content={item.content} ctx={ctx} />
        </a>,
      );
    } else if (item.type === "math") {
      const latex = String((item.props as { latex?: string })?.latex ?? "");
      out.push(<span key={i} className="math-inline" dangerouslySetInnerHTML={{ __html: mathHtml(latex) }} />);
    } else if (item.type === "mention") {
      const m = (item.props ?? {}) as Partial<MentionProps>;
      out.push(
        <span key={i} className="mention static-mention">
          @{m.label || "link"}
        </span>,
      );
    }
  });
  closeRegion("end");
  return <>{out}</>;
}

function Styled({ text, styles, linked }: { text: string; styles: Record<string, unknown>; linked: boolean }) {
  let el: ReactNode = text.split("\n").map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {line}
    </Fragment>
  ));
  if (styles.code) el = <code>{el}</code>;
  if (styles.bold) el = <strong>{el}</strong>;
  if (styles.italic) el = <em>{el}</em>;
  if (styles.underline) el = <u>{el}</u>;
  if (styles.strike) el = <s>{el}</s>;
  if (linked) el = <span className="static-linked">{el}</span>;
  return <>{el}</>;
}
