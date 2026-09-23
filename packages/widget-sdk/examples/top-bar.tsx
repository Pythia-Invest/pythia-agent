import { Button, type TopBarProps } from "@pythia/widget-sdk";

/** Declare this compiled asset with input_contract pythia.desk-topbar.v1. */
export default function ExampleTopBar({ data, settings }: TopBarProps) {
  return (
    <header
      data-slot="example-top-bar"
      className="flex h-12 items-center gap-3 border-border border-b bg-canvas px-4"
    >
      <strong className="min-w-0 flex-1 truncate">{data.title}</strong>
      <input
        aria-label="Search chats"
        type="search"
        value={data.query}
        onChange={(event) => data.onQueryChange(event.target.value)}
        className="min-w-0 rounded-control border border-border bg-raised px-2 text-body"
      />
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          data.prepareChat(
            typeof settings.prompt === "string"
              ? settings.prompt
              : "Help me investigate a research question.",
          )
        }
      >
        Prepare chat
      </Button>
      {data.actions}
    </header>
  );
}
