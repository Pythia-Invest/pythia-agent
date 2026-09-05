import { notFound } from "next/navigation";
import { componentCatalog } from "../../../catalog";
import { catalogEntryFromSlug } from "../../../catalog-routing";
import { ComponentPreview } from "../../examples/component-preview";

export function generateStaticParams() {
  return componentCatalog.map((entry) => ({
    slug: entry.route.slice("/components/".length),
  }));
}

export default async function ComponentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const entry = catalogEntryFromSlug(slug);
  if (!entry) notFound();

  return <ComponentPreview entry={entry} />;
}
