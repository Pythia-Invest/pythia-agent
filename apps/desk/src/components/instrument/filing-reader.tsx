"use client";

import {
  type Filings,
  filingDocumentRequest,
} from "@pythia/market-data/subject";
import {
  Button,
  Drawer,
  IconButton,
  Input,
  Toggle,
  ToggleGroup,
} from "@pythia/ui";
import { ArrowLeft, ExternalLink, X } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { useFilingDocument } from "../../client/instrument-queries";

type Filing = Filings["filings"][number];
type Read =
  | { section: string; start?: number | undefined }
  | { query: string }
  | null;

/** Formats core's document reader extracts; PDF comes with the first
 * PDF-only source. */
export const READABLE = new Set(["ixbrl", "html", "text"]);

function size(chars: number) {
  return chars < 1000 ? `${chars} chars` : `${Math.round(chars / 1000)}k chars`;
}

function Cited({ url }: { url: string | null | undefined }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-foreground-secondary text-xs underline-offset-2 outline-ring hover:text-foreground hover:underline focus-visible:outline-2"
    >
      Open this place in the original
      <ExternalLink aria-hidden="true" className="size-3" />
    </a>
  );
}

/** The reader's body: the outline, one section part or search passages. */
function Body({
  subjectId,
  filing,
  read,
  setRead,
}: {
  subjectId: string;
  filing: Filing;
  read: Read;
  setRead(read: Read): void;
}) {
  const id = filing.id as string;
  const outline = useFilingDocument(filingDocumentRequest(subjectId, id));
  const part = useFilingDocument(
    read ? filingDocumentRequest(subjectId, id, read) : null,
  );
  const query = read ? part : outline;
  if (query.isPending)
    return (
      <p className="text-foreground-secondary text-sm" role="status">
        Reading the document. The first read of a large report takes some
        seconds.
      </p>
    );
  const back = read ? (
    <Button
      variant="ghost"
      size="sm"
      className="self-start"
      onClick={() => setRead(null)}
    >
      <ArrowLeft aria-hidden="true" className="size-3.5" />
      Contents
    </Button>
  ) : null;
  if (query.error)
    return (
      <div className="flex flex-col gap-3">
        {back}
        <p className="text-error text-sm" role="alert">
          {query.error.message}
        </p>
      </div>
    );
  const document = query.data;
  if (document.passages)
    return (
      <div className="flex flex-col gap-3">
        {back}
        {document.passages.length ? null : (
          <p className="text-foreground-secondary text-sm">
            No passage contains these words.
          </p>
        )}
        {document.passages.map((passage) => (
          <article
            key={passage.citation.offsets.join(":")}
            className="flex flex-col gap-1 border-border/60 border-b pb-3 last:border-b-0"
          >
            <button
              type="button"
              className="self-start text-left font-semibold text-xs outline-ring hover:underline focus-visible:outline-2"
              onClick={() =>
                setRead({
                  section: passage.citation.section,
                  start: passage.citation.offsets[0],
                })
              }
            >
              {passage.citation.section_title}
            </button>
            <p className="max-w-[68ch] whitespace-pre-line text-base [overflow-wrap:anywhere]">
              {passage.text}
            </p>
          </article>
        ))}
      </div>
    );
  if (document.section)
    return (
      <div className="flex flex-col gap-3">
        {back}
        <h3 className="font-semibold text-base">{document.section.title}</h3>
        <p className="max-w-[68ch] whitespace-pre-line text-base leading-relaxed [overflow-wrap:anywhere]">
          {document.text}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {read && "section" in read && read.start ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRead({ section: read.section })}
            >
              From the section's start
            </Button>
          ) : null}
          {document.continue_from != null && read && "section" in read ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setRead({
                  section: read.section,
                  start: document.continue_from as number,
                })
              }
            >
              Continue reading
            </Button>
          ) : null}
          <Cited url={document.citation?.url} />
        </div>
      </div>
    );
  return (
    <ol className="flex flex-col">
      {(document.sections ?? []).map((section) => (
        <li key={section.id}>
          <button
            type="button"
            className="flex w-full items-baseline justify-between gap-3 rounded-control px-2 py-1.5 text-left text-sm outline-ring hover:bg-interaction-hover focus-visible:outline-2"
            onClick={() => setRead({ section: section.id })}
          >
            <span className="min-w-0">{section.title}</span>
            <span className="shrink-0 text-foreground-secondary text-xs tabular-nums">
              {size(section.chars)}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** A side drawer that reads one report's document through core: outline,
 * sections and search, each linking to the place in the original. A report
 * with several versions shows them as a choice; none is picked silently. */
export function FilingReader({
  subjectId,
  open,
  variants,
  labels,
  onClose,
}: {
  subjectId: string;
  open: boolean;
  /** Kept while the drawer closes, so it slides out as it was. */
  variants: readonly Filing[] | null;
  labels: readonly string[];
  onClose(): void;
}) {
  const readable = (variants ?? []).filter(
    (filing) => filing.id && READABLE.has(filing.format ?? ""),
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const [read, setRead] = useState<Read>(null);
  const [words, setWords] = useState("");
  const body = useRef<HTMLDivElement>(null);
  // A new part replaces the button that asked for it: keep focus in the reader.
  const navigate = (next: Read) => {
    setRead(next);
    body.current?.focus({ preventScroll: true });
    body.current?.scrollIntoView({ block: "start" });
  };
  const filing =
    readable.find((item) => item.id === chosen) ?? readable[0] ?? null;
  const search = (event: FormEvent) => {
    event.preventDefault();
    if (words.trim().length >= 2) setRead({ query: words.trim() });
  };
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onOpenChangeComplete={(next) => {
        if (next) return;
        setChosen(null);
        setRead(null);
        setWords("");
      }}
      swipeDirection="left"
    >
      <Drawer.Portal>
        <Drawer.Backdrop />
        <Drawer.Viewport>
          <Drawer.Popup className="data-[swipe-direction=left]:w-[min(44rem,calc(100vw-1rem))]">
            <Drawer.Content
              data-slot="filing-reader"
              className="flex min-h-0 flex-1 flex-col gap-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <Drawer.Title>
                    {filing?.form ?? "Filing"}
                    {filing?.period_end ? ` · ${filing.period_end}` : ""}
                  </Drawer.Title>
                  <Drawer.Description>
                    {filing?.title}
                    {filing?.source ? ` · ${filing.source}` : ""}
                  </Drawer.Description>
                </div>
                <Drawer.Close
                  render={
                    <IconButton label="Close reader" size="sm">
                      <X />
                    </IconButton>
                  }
                />
              </div>
              {readable.length > 1 ? (
                <ToggleGroup
                  label="Version"
                  value={filing?.id ? [filing.id] : []}
                  onValueChange={(value) => {
                    if (!value[0]) return; // the chosen version stays chosen
                    setChosen(value[0]);
                    setRead(null);
                  }}
                  className="flex-wrap self-start"
                >
                  {readable.map((item) => (
                    <Toggle
                      key={item.id}
                      value={item.id as string}
                      label={labels[(variants ?? []).indexOf(item)] ?? ""}
                      size="sm"
                      appearance="ghost"
                    />
                  ))}
                </ToggleGroup>
              ) : null}
              <form className="flex gap-2" onSubmit={search}>
                <Input
                  aria-label="Search this document"
                  placeholder="Search this document"
                  value={words}
                  onValueChange={(value) => setWords(value)}
                  size="sm"
                  className="min-w-0 flex-1"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  disabled={words.trim().length < 2}
                  title={
                    words.trim().length < 2
                      ? "Type at least two characters"
                      : undefined
                  }
                >
                  Search
                </Button>
              </form>
              {filing ? (
                <div ref={body} tabIndex={-1} className="outline-none">
                  <Body
                    key={filing.id}
                    subjectId={subjectId}
                    filing={filing}
                    read={read}
                    setRead={navigate}
                  />
                </div>
              ) : (
                <p className="text-foreground-secondary text-sm">
                  Pythia cannot read this format yet; open the original.
                </p>
              )}
              {filing?.url ? (
                <a
                  href={filing.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 self-start text-foreground-secondary text-xs underline-offset-2 outline-ring hover:text-foreground hover:underline focus-visible:outline-2"
                >
                  Open the original
                  <ExternalLink aria-hidden="true" className="size-3" />
                </a>
              ) : null}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
