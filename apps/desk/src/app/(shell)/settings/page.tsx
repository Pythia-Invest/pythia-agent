import { redirect } from "next/navigation";
import { resolvePage } from "@/components/settings/sections";

/** Settings is a dialog over Desk; this address opens it over Chat. */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; page?: string }>;
}) {
  const { section, page } = await searchParams;
  const address = page ?? section;
  if (address === "skills" || address === "tools")
    redirect(`/capabilities?tab=${address}`);
  redirect(`/?settings=${resolvePage(address)?.id ?? ""}`);
}
