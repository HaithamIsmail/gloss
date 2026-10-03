import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef } from "react";

export type RunMode = "next" | "stay" | "insert";

// Ink, one red, and grey: the Modernist palette applied to code.
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: "#ae1800", fontWeight: "600" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "#3f6b34" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#7d7979", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.null], color: "#7c1405" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#201e1d", fontWeight: "600" },
  { tag: [t.definition(t.variableName), t.definition(t.function(t.variableName)), t.className], color: "#201e1d", fontWeight: "700" },
  { tag: [t.self, t.atom], color: "#ae1800" },
  { tag: [t.heading], color: "#201e1d", fontWeight: "800" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.strong], fontWeight: "700" },
  { tag: [t.link, t.url], color: "#ae1800" },
  { tag: [t.monospace], color: "#605d5d" },
]);

const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", fontSize: "14px" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { fontFamily: "var(--font-mono)", padding: "10px 0", caretColor: "#ec3013" },
  ".cm-line": { padding: "0 12px" },
  ".cm-gutters": { display: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(236, 48, 19, 0.18) !important",
  },
  ".cm-matchingBracket": { backgroundColor: "rgba(236, 48, 19, 0.15)", outline: "none" },
  ".cm-tooltip": { border: "2px solid #201e1d", borderRadius: "0", backgroundColor: "#f3f2f2" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "#ec3013", color: "#fff" },
  ".cm-placeholder": { color: "#9b9797" },
});

/** A CodeMirror editor for a notebook cell, with Jupyter's run shortcuts. */
export function CodeEditor({
  value,
  language,
  onChange,
  onRun,
  onEscape,
  onFocus,
  autoFocus,
  focusSignal,
  placeholder,
}: {
  value: string;
  language: "python" | "markdown";
  onChange: (value: string) => void;
  onRun: (mode: RunMode) => void;
  onEscape: () => void;
  onFocus?: () => void;
  autoFocus?: boolean;
  /** Bump to move the keyboard focus into the editor. */
  focusSignal?: number;
  placeholder?: string;
}) {
  // Handlers change every render; the keymap reads them through refs.
  const handlers = useRef({ onRun, onEscape });
  handlers.current = { onRun, onEscape };
  const ref = useRef<ReactCodeMirrorRef>(null);

  useEffect(() => {
    if (focusSignal) ref.current?.view?.focus();
  }, [focusSignal]);

  const extensions = useMemo(
    () => [
      language === "python" ? python() : markdown(),
      syntaxHighlighting(highlight),
      theme,
      EditorView.lineWrapping,
      Prec.highest(
        keymap.of([
          { key: "Shift-Enter", run: () => (handlers.current.onRun("next"), true) },
          { key: "Mod-Enter", run: () => (handlers.current.onRun("stay"), true) },
          { key: "Alt-Enter", run: () => (handlers.current.onRun("insert"), true) },
          {
            key: "Escape",
            run: (view) => {
              view.contentDOM.blur();
              handlers.current.onEscape();
              return true;
            },
          },
        ]),
      ),
    ],
    [language],
  );

  return (
    <CodeMirror
      ref={ref}
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme="none"
      autoFocus={autoFocus}
      placeholder={placeholder}
      onFocus={onFocus}
      indentWithTab
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        highlightSelectionMatches: false,
        searchKeymap: false,
      }}
    />
  );
}
