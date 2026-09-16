"use client";
import { useEffect, useState } from "react";
import type { CodeHighlighterPlugin } from "streamdown";
import type { CSSProperties } from "react";
import { cn, IconButton } from "@pythia/ui";
import { Check, Copy } from "lucide-react";
import { PreviewToolbar } from "./toolbar";
import { codeLanguage, TEXT_RENDER_CHARS } from "@/workspace/previews/formats";

export function useCodeHighlight(enabled: boolean) {
  const [code, setCode] = useState<CodeHighlighterPlugin>();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void import("@/workspace/previews/highlighter")
      .then((module) => {
        if (active) setCode(module.code);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [enabled]);
  return enabled ? code : undefined;
}
type Highlight = NonNullable<ReturnType<CodeHighlighterPlugin["highlight"]>>;

export function CodePreview({
  text,
  name,
  language,
  embedded = false,
}: {
  text: string;
  name?: string;
  language?: string;
  embedded?: boolean;
}) {
  const content = text.slice(0, TEXT_RENDER_CHARS).split("\n", 5000).join("\n");
  const lang = language ?? codeLanguage(name ?? "");
  const code = useCodeHighlight(lang !== "text");
  const [highlight, setHighlight] = useState<{
    source: string;
    language: string;
    result: Highlight;
  }>();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => {
    if (!code) return;
    let active = true;
    const receive = (result: Highlight) => {
      if (active) setHighlight({ source: content, language: lang, result });
    };
    const result = code.highlight(
      { code: content, language: lang, themes: code.getThemes() },
      receive,
    );
    if (result) receive(result);
    return () => {
      active = false;
    };
  }, [code, content, lang]);
  useEffect(() => {
    setCopied(false);
    setCopyFailed(false);
  }, [text]);
  const lines: Highlight["tokens"] =
    highlight?.source === content && highlight.language === lang
      ? highlight.result.tokens
      : content.split("\n").map((line) => [{ content: line }]);
  return (
    <div data-slot="workspace-code" className="min-w-0">
      {!embedded ? (
        <PreviewToolbar label="Code tools">
          <span className="text-foreground-secondary">
            {lang === "text" ? "Plain text" : lang}
          </span>
          <div className="ml-auto">
            <IconButton
              size="sm"
              label={copied ? "Copied" : "Copy code"}
              onClick={() => {
                void navigator.clipboard
                  .writeText(text)
                  .then(() => {
                    setCopied(true);
                    setCopyFailed(false);
                  })
                  .catch(() => setCopyFailed(true));
              }}
            >
              {copied ? <Check /> : <Copy />}
            </IconButton>
          </div>
          {copyFailed ? (
            <span role="status">
              Could not copy. Select the text to copy it.
            </span>
          ) : null}
        </PreviewToolbar>
      ) : null}
      {text.length > content.length ? (
        <p className="px-4 py-2 text-foreground-secondary text-xs">
          Showing the first {content.length.toLocaleString()} characters.
          Download the original for the complete file.
        </p>
      ) : null}
      <section
        className={cn(
          "overflow-x-auto bg-container py-3",
          embedded && "bg-subtle px-2 py-1",
        )}
        aria-label="Source code"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll long source lines.
        tabIndex={0}
      >
        <pre className="w-max min-w-full font-mono text-sm leading-6">
          <code>
            {lines.map((line, index) => (
              <span
                key={index}
                data-slot="workspace-code-line"
                className="flex"
              >
                {!embedded ? (
                  <span
                    aria-hidden="true"
                    className="sticky left-0 w-12 shrink-0 select-none bg-container pr-3 text-right text-foreground-secondary text-xs leading-6"
                  >
                    {index + 1}
                  </span>
                ) : null}
                <span className="pr-4">
                  {line.map((token, i) => (
                    <span
                      key={i}
                      style={token.htmlStyle as CSSProperties}
                      className="dark:!text-[var(--shiki-dark)]"
                    >
                      {token.content}
                    </span>
                  ))}
                  {index < lines.length - 1 ? "\n" : ""}
                </span>
              </span>
            ))}
          </code>
        </pre>
      </section>
    </div>
  );
}
