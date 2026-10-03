import { memo, useState } from "react";
import type { NotebookOutput } from "../../shared/pages";
import { ansiToHtml, applyCarriageReturns, joinText, renderLatex, renderMarkdown, sanitize } from "./render";

/** Picks the richest representation we can show safely, like Jupyter's renderers. */
function DataOutput({ data }: { data: Record<string, string | string[]> }) {
  const get = (mime: string) => (data[mime] !== undefined ? joinText(data[mime]) : undefined);
  const png = get("image/png");
  if (png) return <img className="nb-img" src={`data:image/png;base64,${png.trim()}`} alt="" />;
  const jpeg = get("image/jpeg");
  if (jpeg) return <img className="nb-img" src={`data:image/jpeg;base64,${jpeg.trim()}`} alt="" />;
  const svg = get("image/svg+xml");
  if (svg) return <div className="nb-html" dangerouslySetInnerHTML={{ __html: sanitize(svg) }} />;
  const html = get("text/html");
  if (html) return <div className="nb-html" dangerouslySetInnerHTML={{ __html: sanitize(html) }} />;
  const markdown = get("text/markdown");
  if (markdown) return <div className="nb-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }} />;
  const latex = get("text/latex");
  if (latex) return <div className="nb-latex" dangerouslySetInnerHTML={{ __html: renderLatex(latex) }} />;
  const json = data["application/json"];
  if (json !== undefined) return <pre className="nb-text">{JSON.stringify(json, null, 2)}</pre>;
  return <pre className="nb-text" dangerouslySetInnerHTML={{ __html: ansiToHtml(get("text/plain") ?? "") }} />;
}

function Output({ output }: { output: NotebookOutput }) {
  switch (output.output_type) {
    case "stream":
      return (
        <pre
          className={`nb-text nb-stream${output.name === "stderr" ? " is-stderr" : ""}`}
          dangerouslySetInnerHTML={{ __html: ansiToHtml(applyCarriageReturns(joinText(output.text))) }}
        />
      );
    case "error":
      return (
        <pre
          className="nb-text nb-error"
          dangerouslySetInnerHTML={{
            __html: ansiToHtml(output.traceback?.length ? output.traceback.join("\n") : `${output.ename}: ${output.evalue}`),
          }}
        />
      );
    case "execute_result":
    case "display_data":
      return <DataOutput data={output.data ?? {}} />;
    default:
      return null;
  }
}

export const Outputs = memo(function Outputs({
  outputs,
  input,
}: {
  outputs: NotebookOutput[];
  input?: { prompt: string; password: boolean; submit: (value: string) => void } | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (!outputs.length && !input) return null;
  return (
    <div className={`nb-outputs${collapsed ? " is-collapsed" : ""}`}>
      <button
        type="button"
        className="nb-outputs-toggle"
        title={collapsed ? "Show output" : "Collapse output"}
        onClick={() => setCollapsed((c) => !c)}
      />
      {collapsed ? (
        <div className="nb-outputs-collapsed" onClick={() => setCollapsed(false)}>
          Output hidden · click to show
        </div>
      ) : (
        <div className="nb-outputs-body">
          {outputs.map((o, i) => (
            <Output key={i} output={o} />
          ))}
          {input && <InputPrompt {...input} />}
        </div>
      )}
    </div>
  );
});

function InputPrompt({ prompt, password, submit }: { prompt: string; password: boolean; submit: (v: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <label className="nb-input">
      <span>{prompt}</span>
      <input
        autoFocus
        type={password ? "password" : "text"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") submit(value);
        }}
      />
    </label>
  );
}
