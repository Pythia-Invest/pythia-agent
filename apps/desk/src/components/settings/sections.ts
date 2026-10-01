import {
  Archive,
  Box,
  Brain,
  Cpu,
  Database,
  Download,
  FileImage,
  FileText,
  FolderOpen,
  Globe,
  Info,
  KeyRound,
  Library,
  Lock,
  type LucideIcon,
  MessageCircle,
  Monitor,
  Palette,
  ShieldCheck,
  Terminal,
  UserRound,
  Users,
  Wrench,
  Zap,
} from "lucide-react";

/*
 * The Settings tree, after Hermes Desktop's sidebar (apps/desktop/src/app/
 * settings/index.tsx and subpages.ts in NousResearch/hermes-agent, MIT):
 * sections with pages under them and spacers between the groups. Every page
 * is either schema-driven fields (from Hermes, or Pythia's own schema) or one
 * of the few views that need more than rows.
 */

export type PageView =
  | { kind: "hermes" }
  | { kind: "pythia"; fields: readonly string[] }
  | { kind: "main-model" }
  | { kind: "accounts" }
  | { kind: "api-keys" }
  | { kind: "endpoints" }
  | { kind: "data-sources" }
  | { kind: "reference" }
  | { kind: "repairs" }
  | { kind: "about" };

export type SettingsPage = {
  /** `section/page`; for Hermes pages, the id in settings/hermes-pages. */
  id: string;
  title: string;
  icon: LucideIcon;
  view: PageView;
  /** Words search should also match. */
  keywords?: string;
};

export type SettingsSection = {
  id: string;
  title: string;
  icon: LucideIcon;
  pages: readonly SettingsPage[];
  /** A spacer before it in the sidebar, starting a new group. */
  gapBefore?: boolean;
};

const hermes = { kind: "hermes" } as const;

export const settingsSections: readonly SettingsSection[] = [
  {
    id: "model",
    title: "Model",
    icon: Box,
    pages: [
      {
        id: "model/main",
        title: "Main model",
        icon: Box,
        view: { kind: "main-model" },
        keywords: "default provider reasoning context window",
      },
      {
        id: "model/fallbacks",
        title: "Fallback models",
        icon: Box,
        view: hermes,
      },
      {
        id: "model/auxiliary",
        title: "Auxiliary models",
        icon: Cpu,
        view: hermes,
        keywords: "vision compression title summary",
      },
    ],
  },
  {
    id: "chat",
    title: "Chat",
    icon: MessageCircle,
    pages: [
      {
        id: "chat/behavior",
        title: "Behavior",
        icon: MessageCircle,
        view: hermes,
        keywords: "personality timezone reasoning",
      },
      {
        id: "chat/attachments",
        title: "Attachments",
        icon: FileImage,
        view: hermes,
      },
    ],
  },
  {
    id: "appearance",
    title: "Appearance",
    icon: Palette,
    pages: [
      {
        id: "appearance/theme",
        title: "Theme",
        icon: Palette,
        view: { kind: "pythia", fields: ["desk.theme"] },
        keywords: "dark light system color mode",
      },
    ],
  },
  {
    id: "workspace",
    title: "Workspace",
    icon: Monitor,
    pages: [
      {
        id: "workspace/folders",
        title: "Folders",
        icon: FolderOpen,
        view: {
          kind: "pythia",
          fields: ["folders.workspace", "folders.working"],
        },
        keywords: "path directory files cwd",
      },
      {
        id: "workspace/shell",
        title: "Shell environment",
        icon: Terminal,
        view: hermes,
      },
      {
        id: "workspace/files",
        title: "Files & execution",
        icon: FileText,
        view: hermes,
      },
    ],
  },
  {
    id: "safety",
    title: "Safety",
    icon: Lock,
    pages: [
      {
        id: "safety/approvals",
        title: "Approvals",
        icon: ShieldCheck,
        view: hermes,
        keywords: "allowlist commands confirm",
      },
      {
        id: "safety/privacy",
        title: "Privacy & network",
        icon: Lock,
        view: hermes,
      },
      {
        id: "safety/checkpoints",
        title: "Checkpoints",
        icon: Archive,
        view: hermes,
      },
    ],
  },
  {
    id: "memory",
    title: "Memory & Context",
    icon: Brain,
    pages: [
      {
        id: "memory/persistent",
        title: "Persistent memory",
        icon: Brain,
        view: hermes,
      },
      {
        id: "memory/context",
        title: "Context & compression",
        icon: FileText,
        view: hermes,
      },
    ],
  },
  {
    id: "data",
    title: "Data",
    icon: Database,
    pages: [
      {
        id: "data/sources",
        title: "Data sources",
        icon: Database,
        view: { kind: "data-sources" },
        keywords: "plugin catalogue sync identifiers pause disable",
      },
      {
        id: "data/reference",
        title: "Reference data",
        icon: Library,
        view: { kind: "reference" },
        keywords: "catalogue package build search instruments notices licence",
      },
      {
        id: "data/repairs",
        title: "Repairs",
        icon: Wrench,
        view: { kind: "repairs" },
        keywords: "issues identity questions agent suggestion confirm",
      },
    ],
  },
  {
    id: "advanced",
    title: "Advanced",
    icon: Wrench,
    pages: [
      {
        id: "advanced/runtime",
        title: "Agent limits",
        icon: Cpu,
        view: hermes,
      },
      {
        id: "advanced/tools",
        title: "Tool access",
        icon: Wrench,
        view: hermes,
      },
      {
        id: "advanced/terminal",
        title: "Terminal backend",
        icon: Terminal,
        view: hermes,
        keywords: "docker modal ssh sandbox",
      },
      {
        id: "advanced/delegation",
        title: "Subagents",
        icon: Users,
        view: hermes,
      },
      {
        id: "advanced/output",
        title: "Output limits",
        icon: FileText,
        view: hermes,
      },
    ],
  },
  {
    id: "providers",
    title: "Providers",
    icon: Zap,
    gapBefore: true,
    pages: [
      {
        id: "providers/accounts",
        title: "Accounts",
        icon: UserRound,
        view: { kind: "accounts" },
        keywords: "sign in login oauth subscription codex claude nous",
      },
      {
        id: "providers/keys",
        title: "API keys",
        icon: KeyRound,
        view: { kind: "api-keys" },
        keywords: "token openrouter anthropic openai credentials",
      },
      {
        id: "providers/endpoints",
        title: "Custom endpoints",
        icon: Globe,
        view: { kind: "endpoints" },
        keywords: "openai compatible local ollama lm studio vllm",
      },
    ],
  },
  {
    id: "about",
    title: "About",
    icon: Info,
    gapBefore: true,
    pages: [
      {
        id: "about/updates",
        title: "Version & updates",
        icon: Download,
        view: { kind: "about" },
        keywords: "release build upgrade restart",
      },
    ],
  },
];

export const settingsPages = settingsSections.flatMap((section) =>
  section.pages.map((page) => ({ ...page, section })),
);

export type SettingsPageId = string;

export const DEFAULT_PAGE = "model/main";

/** Addresses from before sections had pages. */
const LEGACY: Record<string, string> = {
  overview: DEFAULT_PAGE,
  general: "appearance/theme",
  appearance: "appearance/theme",
  models: DEFAULT_PAGE,
  agent: DEFAULT_PAGE,
  "data-sources": "data/sources",
  folders: "workspace/folders",
  capabilities: "workspace/folders",
  updates: "about/updates",
};

/**
 * The page an address names: a page id, a section (its first page), or an
 * older address.
 */
export function resolvePage(address: string | null | undefined) {
  if (!address) return undefined;
  const id = LEGACY[address] ?? address;
  return (
    settingsPages.find((page) => page.id === id) ??
    settingsPages.find((page) => page.section.id === id)
  );
}
