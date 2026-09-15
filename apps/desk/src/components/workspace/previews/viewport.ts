import { useEffect, useState, type RefObject } from "react";

/** Measure the reader's available area, not the potentially oversized artifact. */
export function usePreviewViewport(root: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 600, height: 500 });
  useEffect(() => {
    const element = root.current;
    const reader = element?.closest('[data-slot="workspace-reader-scroll"]');
    if (!element || !reader) return;
    const toolbar = element.firstElementChild;
    const update = () =>
      setSize({
        width: Math.max(100, element.clientWidth),
        height: Math.max(
          100,
          reader.clientHeight -
            (element.querySelector<HTMLElement>(
              '[data-slot="workspace-preview-toolbar"]',
            )?.offsetHeight ?? 40),
        ),
      });
    const observer = new ResizeObserver(update);
    observer.observe(reader);
    observer.observe(element);
    if (toolbar) observer.observe(toolbar);
    update();
    return () => observer.disconnect();
  }, [root]);
  return size;
}
