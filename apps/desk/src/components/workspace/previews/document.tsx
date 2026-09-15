"use client";
import DOMPurify from "dompurify";
import { useMemo } from "react";

export function sanitizeDocument(html: string) {
  const root = DOMPurify.sanitize(html, {
    RETURN_DOM: true,
    ALLOWED_TAGS: [
      "p",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "table",
      "thead",
      "tbody",
      "tr",
      "td",
      "th",
      "strong",
      "em",
      "u",
      "s",
      "sup",
      "sub",
      "a",
      "img",
      "br",
      "blockquote",
    ],
    ALLOWED_ATTR: ["href", "src", "alt", "colspan", "rowspan", "id"],
  }) as HTMLElement;
  for (const img of root.querySelectorAll("img")) {
    if (
      !/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\r\n]+$/i.test(
        img.getAttribute("src") ?? "",
      )
    )
      img.remove();
    else img.setAttribute("loading", "lazy");
  }
  for (const link of root.querySelectorAll("a")) {
    const href = link.getAttribute("href") ?? "";
    if (!/^(https?:\/\/|mailto:|#)/i.test(href)) link.removeAttribute("href");
    else if (!href.startsWith("#")) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
  }
  return root.innerHTML;
}
export function DocumentPreview({ html }: { html: string }) {
  const safe = useMemo(() => sanitizeDocument(html), [html]);
  return (
    <div
      data-slot="workspace-document"
      className="text-body leading-relaxed [&_a]:text-primary [&_a]:underline [&_h1]:my-4 [&_h1]:text-2xl [&_h2]:my-3 [&_h2]:text-xl [&_h3]:font-semibold [&_img]:max-w-full [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_table]:my-3 [&_table]:block [&_table]:overflow-auto [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2 [&_ul]:list-disc [&_ul]:pl-5"
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
