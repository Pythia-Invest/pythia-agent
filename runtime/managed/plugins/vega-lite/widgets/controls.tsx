import { Button, Menu } from "@pythia/widget-sdk";
export function VisualActions({
  ready,
  busy,
  onExport,
  onSave,
  onCopy,
  onReset,
}: {
  ready: boolean;
  busy: boolean;
  onExport: (format: "svg" | "png") => void;
  onSave: () => void;
  onCopy: () => void;
  onReset: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button size="sm" variant="ghost" loading={busy}>
            Actions
          </Button>
        }
      >
        Actions
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end">
          <Menu.Popup>
            <Menu.Item
              disabled={!ready || busy}
              onClick={() => onExport("png")}
            >
              Export PNG
            </Menu.Item>
            <Menu.Item
              disabled={!ready || busy}
              onClick={() => onExport("svg")}
            >
              Export SVG
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item disabled={!ready || busy} onClick={onSave}>
              Download scenario
            </Menu.Item>
            <Menu.Item disabled={!ready || busy} onClick={onCopy}>
              Copy scenario context
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item disabled={busy} onClick={onReset}>
              Reset visual
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
