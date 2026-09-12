import { PagePlaceholder } from "@/components/shell/page-placeholder";

/** Workspace is a reserved destination; nothing backs it yet. */
export default function WorkspacePage() {
  return (
    <PagePlaceholder
      description="This surface is part of the desk's design, but no data source is connected to it yet."
      title="Workspace"
    />
  );
}
