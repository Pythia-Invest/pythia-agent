# Pythia Design Direction

Status: Approved direction, imported from the Pythia Invest design brief
Audience: product designers, brand designers, and design-generation tools
Applies to: the public website and the Pythia product application, including Desk

## Purpose

This document defines what Pythia should look and feel like. It gives a
designer enough stable context, visual direction, and domain-specific
guardrails to create a coherent design system and high-quality interfaces
without prescribing the design itself.

It is deliberately not:

- a page, screen, workflow, navigation, or information-architecture spec;
- a finished token table or component library;
- a responsive layout prescription;
- an implementation plan or test plan; or
- a substitute for the approved logo assets.

Mutable product strategy, audience segmentation, capabilities, behavior, and
content belong in the current product documents and in page or screen briefs.
Those sources govern what a particular experience does; this document governs
the enduring visual and experiential language used to express it.

The designer owns the creative resolution: exact scales, token values,
components, layouts, and interaction patterns. Those decisions must express
the direction below rather than merely repeating familiar finance or AI
software conventions.

In this document, **must** and **must not** express non-negotiable identity,
trust, or design-language boundaries. **Should** expresses the expected
default; departing from it needs a clear design reason. **May** identifies open
creative space.

## Stable design context

Pythia Invest is an AI-native financial and investing brand and software
environment. It spans public-facing communication and working application
contexts. Its subject matter can be dense, consequential, time-sensitive,
uncertain, and highly sensitive to provenance. The design must make complexity
manageable without making it look simple by hiding evidence or uncertainty.

Pythia may perform substantial analytical work, but human judgment and capital
remain human responsibilities. The interface must distinguish what came from a
source, what the machine inferred, and what a person believes. This is an
enduring trust principle, independent of any particular feature set.

The experience must never imply that Pythia is an oracle that knows the
future. It must never style a machine assessment as settled fact or use visual
authority to conceal uncertainty. The historical Pythia metaphor belongs in
the name and pictogram; the brand earns trust through evidence, precision, and
visible intellectual honesty.

## Audience and desired effect

Design for people doing serious financial research and making consequential
investment judgments. They may have different levels of experience and work in
different settings, but they need an understandable default, efficient repeated
use, traceable information, and control over consequential decisions. Avoid
both an institutional terminal that requires training before use and a
simplified investing app that substitutes reassurance for evidence.

The first impression should be:

- calm;
- rigorous;
- intelligent;
- quietly agentic; and
- subtly premium and professional.

Pythia should feel contemporary and AI-native, with a restrained
institutional edge. It should not look like a traditional bank, asset manager,
crypto exchange, trading terminal, or generic chatbot. Premium quality should
come from precision, hierarchy, typography, and thoughtful interaction—not
ornament or claims of authority.

The enduring emotional outcomes are **confidence** that important information
can be understood and inspected, and **calm** that complexity is being handled
without exaggeration. The interface should make both feelings credible without
promising certainty.

## One language, two profiles

The Public website and Product application are two profiles of one Pythia
design language. They must share the identity, typography family, color
semantics, icon style, geometry, motion character, accessibility intent, and
core interaction character. They should differ where their jobs genuinely
require it.

### Public website

The public website should translate the same identity into a spacious,
confident environment for explanation, trust, and product truth. Its specific
audience, conversion goal, content, and page structure belong in the current
website brief.

The website should be:

- spacious and compositionally confident in either theme;
- bold but controlled in its headline typography;
- concise, with narrow readable text measures and generous breathing room;
- visually grounded in truthful product behavior, evidence, and financial
  material when those are relevant; and
- recognizably modern in the direct, product-led manner of a strong technology
  company.

A fluid, generous canvas should support asymmetric compositions and credible
product demonstrations. Prose should feel comfortable at approximately 18px,
while embedded research or financial previews may be denser. Cards should
express real grouping, not serve as the default layout primitive.

When the website uses product demonstrations or concept previews, they must be
truthfully labelled and grounded in the capabilities documented at that time.
They must not invent customers, performance, returns, quotations, or product
behavior. When cited research or reports appear publicly, their evidence and
epistemic distinctions should remain intact. Their strategic role and
information architecture belong in the relevant product and page briefs.

### Product application

The application should be a calm, low-chrome professional environment.
Neutral surfaces, fine borders, and predictable placement should support
spatial memory wherever context benefits from continuity. Branding should
recede behind the user's work.

The application should be moderately compact rather than sparse or
terminal-dense. A useful starting character is 14px interface text, 16px for
longer reading, and controls around 32–36px high. Exact values belong to the
downstream system; the intention is to support sustained financial work while
remaining immediately understandable.

Conversational interaction, source inspection, structured research, tables,
and charts are illustrative ways this language may appear, not required
features or a prescribed composition. When natural language or chat is used,
it should feel integrated with the substantive information it helps produce or
examine rather than becoming an isolated generic transcript. Current product
documents decide whether conversation is primary, secondary, or absent and how
it relates to other surfaces.

The system must provide a strong, opinionated default experience. If
customization exists, it must not turn the user's entry point into a
configurable blank canvas.

## Visual language

### Typography

Use **IBM Plex Sans** for the interface in both profiles. The one sanctioned
exception is conversation text in the application: what the person types and
what Pythia answers are set in **Inter**, a neutral reading face that
separates the exchange from the chrome around it. Do not introduce any further
display, serif, or monospace family merely to make the product feel premium.
Hierarchy should come from disciplined size, weight, line height, measure,
spacing, and placement.

The website should use large, fluid, bounded display typography rather than
making every hero billboard-scale. Display size must be inversely related to
copy length: an exceptionally large headline is appropriate only for a very
short statement, while a full sentence needs a more restrained scale and
measure. Hero supporting copy must remain body-like, materially smaller than
the headline, and normally fit within one or two comfortable lines. It must
never compete with the headline as a second display element. The application
should use a tighter hierarchy suited to repeated reading and dense
information. Sentence case is the default. Uppercase is reserved for short
eyebrows, compact metadata, and status labels.

Financial values should use IBM Plex Sans tabular lining numerals. Comparable
numeric columns should scan and align cleanly; ordinary financial data does
not need a separate monospace typeface.

Legibility outranks visual subtlety. Body copy, labels, financial values, and
supporting text must remain comfortably readable at their intended sizes in
both themes. Use regular or stronger weights for small text; do not use thin
weights, compressed line heights, tight tracking, or low opacity to manufacture
hierarchy. Secondary text may be quieter than primary text, but it must not
become faint—create hierarchy through size, weight, placement, and spacing
before reducing contrast. Small metadata and uppercase labels require
particular care because size, tracking, and muted color compound one another.

### Color and themes

The approved identity palette is:

- **Oracle Ink** `#171B22` — authority, primary text, and primary action;
- **Product Surface** `#F7F8F9` — the canonical light foundation;
- **Signal Amber** `#D89A1E` — a meaningful Pythia-detected signal, including
  the focus state while that specific signal is being examined;
- **Amber Tint** `#FEF1D4` — Public-profile atmosphere and a rare, low-area
  support treatment around an explicitly identified signal; and
- **Warm White** `#FDFDFD` — light-on-dark text and identity detail.

Signal Amber has one special meaning: **Pythia found the signal that matters**.
Within the Product application, it must not become a generic brand decoration,
primary-button color, warning color, default chart series, selected-row state,
current tab, or general focus color. “Active analytical focus” may use amber
only when the active object is the Pythia signal itself. Primary actions should
normally use Oracle Ink.

The two profiles intentionally have different amber budgets. The Public
website may feel visibly warm and branded; the Product application should feel
predominantly neutral, with amber occupying only small, local moments. In the
Product profile, start with no amber and add the minimum mark needed to connect
an item to Pythia: normally one dot, short rule, compact icon detail, or focused
annotation. Do not repeat several amber cues within one component. If removing
amber would not weaken Pythia identity or signal recognition, leave it out.

A Pythia signal must not resemble a warning banner. Prefer a neutral surface
with an amber dot or identity marker, a restrained amber edge or rule, and an
explicit **Pythia signal** label over a large amber-tinted container. Do not use
warning symbols such as a triangle or exclamation mark for a signal. Warning
has its own distinct burnt-orange or copper semantic family, explicit label,
and warning icon. Its hue, tint, iconography, and wording must remain visibly
separate from Signal Amber and Amber Tint; warning surfaces must never reuse
Amber Tint merely because it is already available.

The Public website may use amber-derived color as brand atmosphere: pale warm
section washes, soft glows, or a low-saturation gradient that fades into the
page. This is a profile-specific use of the brand family, not a Pythia signal.
It must not borrow the signal dot-and-label treatment or appear like a status
container. Exact Signal Amber remains reserved for small identity accents,
focused emphasis, and the approved logo; broad decorative fields should use
lighter derived tints.

Create complete light and dark themes by mapping semantic roles, not by
inverting colors mechanically. Both must feel deliberately designed rather
than adapted after the fact. Theme is a global presentation choice, not a
difference between the Public and Product profiles: both initially follow the
operating-system preference, allow a manual light/dark override, and persist an
explicit selection. Any composition that shows the website and application
together must show them in the same active theme unless it is explicitly
demonstrating theme coverage. Intentional contrasting sections may exist, but
an embedded product view must not be made dark merely to signal that it is
“the app.”

The downstream design system should separate primitive values, semantic roles,
and component or profile aliases. It should also define restrained,
accessible colors for information, warning, success, and error. These states
normally use a tinted surface and border with a darker semantic foreground;
solid fills belong to small indicators or genuinely urgent moments. State
text must remain readable rather than inheriting a pale version of the state
color. Each state also needs a plain-language label and, where useful, an icon
or border so color is never the only cue. Body text must meet WCAG AA contrast;
the tint should make the state recognizable without turning it into a loud
banner.

Gradients are atmospheric composition tools, never semantic tokens. When used,
keep them low-saturation, limited to a small family of adjacent brand-derived
hues, and localized behind a hero, illustration, or product stage. Let them
fade into a stable page surface. Text, controls, evidence, financial data, and
status messages should sit on solid high-contrast surfaces. Do not use text
gradients, rainbow or animated meshes, glowing borders, or gradients inside
semantic banners and dense analytical surfaces. Dark-theme gradients should
be independently tuned as restrained illumination within Oracle Ink rather
than mechanically inverted from the light theme.

Text placed over atmospheric color must meet its contrast requirement at the
least favorable point of the gradient or glow, not only against the nominal
surface token. When that cannot be guaranteed responsively, place the text on
a solid surface or move the atmosphere away from the reading area.

### Surfaces, geometry, and spacing

Prefer flat composition, whitespace, fine borders, and subtle background
contrast. Use shadows only where something is genuinely elevated, such as an
overlay, menu, dialog, or intentionally floating element.

Geometry should feel restrained and contemporary: roughly 8px rounding on
controls and 12–16px on major containers is the intended character. Full
pills should be limited to statuses and compact labels. Avoid both severe
square-edged enterprise software and soft, inflated consumer-fintech forms.

The downstream spacing system should use a 4px base with an 8px dominant
rhythm. The Public website should add a generous section-spacing layer; the
Product application should use a denser profile of the same underlying
rhythm.

### Iconography, imagery, and motion

Use one restrained outline-icon family with consistent stroke and optical
sizing. Filled icons should indicate a genuine state, not visual variety. The
Pythia pictogram is the only custom identity mark.

When they are truthful to the experience being designed, the product's own
work can be strong visual material: for example, evidence excerpts,
source-linked values, research surfaces, simple explanatory diagrams, and
disciplined data visualization. Use such material with purpose rather than as
decoration. Do not default to generic stock photography, investors looking at
screens, city skylines, coins, candlesticks, Greek temples, oracle characters,
celestial motifs, or abstract AI artwork.

Motion should be restrained and functional. Use short transitions and subtle
entrances only when they clarify state or causality. Avoid autoplay spectacle,
scroll choreography, glowing “thinking” effects, and animation whose purpose
is simply to look technological. Reduced-motion behavior is mandatory.

## Brand integration

The company is **Pythia Invest** and the website is
**https://pythiainvest.com**. In logo artwork, the name is **Pythia**—never
“Pythia Invest” or “Invest.”

The approved files and exact geometry live in the external Pythia Google Drive
brand kit. Designers must use those assets rather than redraw or regenerate the
oracle profile. This repository retains only the runtime assets that approved
consumers require, in `packages/ui/src/assets` (see
[ADR 0003](decisions/0003-ui-and-design-lab.md)); the complete exported kit
and its deterministic rendering source stay outside this repository.
The pictogram is borderless in both modes. Light mode uses an Oracle Ink tile
with a Warm White profile; dark mode uses its true neutral inverse, a Warm White
tile with an Oracle Ink profile. Signal Amber remains unchanged. The wordmark
uses IBM Plex Sans 700 with native kerning and normal letter spacing. Preserve
the amber dot and the required clear space.

Historical Pythia symbolism must remain inside the approved pictogram and
occasional restrained language. Do not develop an oracle mascot, mystical
illustration system, or visual claim of foresight.

## Finance-native design principles

A financial research platform carries meanings that a generic SaaS design
system does not. Precision here is not decorative polish; it determines
whether the interface tells the truth.

### Keep different meanings separate

Financial surfaces may combine several meaning domains. When multiple domains
appear, the design must not collapse them into one positive/negative/warning
vocabulary, even if some reuse underlying palette values. Conditional examples
include:

- **Interface status:** success, error, warning, and information about the
  software or operation.
- **Market movement:** up, down, or unchanged.
- **Analytical impact:** favorable, unfavorable, neutral, or unresolved in the
  context defined by the current product; this may include thesis or reason
  impact when such a concept exists.
- **Data freshness:** current, delayed, stale, or unknown.

A rising price is not automatically analytically favorable. A successful data
load does not verify the loaded claim. A stale source is not a system error.
An amber signal is not necessarily a warning. Color alone must never carry
these distinctions; use explicit language, signs, icons, and placement.

Market movement should nevertheless respect learned financial conventions.
Positive movement uses a restrained market green together with an explicit
plus sign, upward direction, or label; negative movement uses a restrained
market red with a minus sign, downward direction, or label; unchanged movement
is neutral. Information blue must not stand in for rising price. When a
composition intentionally avoids movement color, use stronger neutral type
plus the sign or directional cue instead. These treatments communicate
direction only, never “good,” “bad,” recommended, or aligned with the user's
investment case.

Two semantic principles are enduring rather than conditional examples. First,
whenever claims or judgments appear, their evidence state must remain visible.
Three epistemic states are especially important:

1. a sourced fact, with mechanically resolvable evidence;
2. a machine assessment, with uncertainty and basis; and
3. human judgment, which Pythia may challenge but never verify.

A machine guess must never look like a filed fact, and a person's own view must
never be silently rewritten as Pythia's conclusion. Unsupported or unknown
content must remain explicit rather than borrowing one of these states.

Second, a Pythia signal is a material item surfaced by Pythia as deserving
attention. Signal Amber retains this branded meaning and no other.

### Put provenance beside the conclusion

When a surface presents claims, each claim must retain its epistemic type:
sourced fact, machine assessment, or human judgment, as applicable. Each
sourced factual claim must expose a resolvable citation to the exact supporting
passage and a visible source date; live-web evidence must also expose when
Pythia retrieved it. When figures, assessments, or notifications are present,
their source or basis, relevant period, and freshness should be available at
the point of use. Show enough at a glance to establish source identity, date,
basis, and epistemic type; reveal surrounding context, methodology, and the
original source progressively on demand.

Do not detach evidence into a generic bibliography or hide it behind a global
“sources” area. In conversational answers, research material, tables,
notifications, or published work, provenance should behave as a repeated,
low-friction interaction; these are illustrative contexts, not prescribed
features.

When financial values appear, they should retain the context needed to
interpret them: currency or units, period and basis, appropriate precision,
freshness, and an honest meaning for missing data. This brief does not
prescribe the exact formatting mechanics.

### Lead with change, preserve the baseline

When a surface presents a change or comparison, it should make clear what
changed, why it may matter, how certain that interpretation is, what may not be
comparable, and how fresh the evidence is. The underlying baseline values and
complete source context must remain easy to inspect on demand. Interpretation
should reduce effort without hiding the record from which it was derived.

### Make the boundary of knowledge visible

Where research, derived data, or asynchronous work can be incomplete, the
interface should calmly distinguish between:

- no evidence found;
- insufficient coverage;
- a stale source;
- a calculation that is unavailable; and
- an operation that failed.

Do not collapse these into “Unavailable,” hide incomplete work, or use error
styling for an honest research limitation. Trust comes as much from showing
what Pythia does not know as from presenting a confident result.

### Support professional density without dashboard noise

Dense tables, evidence collections, and financial snapshots are illustrative
patterns that are appropriate when they support comparison or repeated work.
Density should be structured through alignment, grouping, stable placement,
direct labels, and progressive disclosure—not by shrinking everything or
placing every metric in a card.

On narrow surfaces, prioritize information. Secondary detail may move into
disclosures or focused views. Preserve horizontal scrolling when a genuinely
comparative table would lose meaning if dismantled; do not mechanically turn
every row into a mobile card.

When charts are used, they should have neutral scaffolding, restrained
semantic series colors, and direct labels. Avoid 3D, decorative gradients,
excessive legends, and the use of green/red as generic “good/bad.” In market
movement contexts, their directional convention is appropriate when paired
with signs or labels. Signal Amber appears only for a Pythia-detected signal,
including the focus state while inspecting that signal.

## AI-native design principles

Pythia should look modern because machine work is legible when it appears, not
because the interface performs “AI-ness.”

When an experience exposes agent activity, useful examples of what it may
reveal at an appropriate level include:

- what context the agent is working within;
- what source families it is checking;
- named activity such as “Reading sources” or “Building the case”;
- partial findings and changes in direction;
- which statements are evidence and which are interpretation; and
- honest unknown, interrupted, or failed states.

When progress is shown, use a percentage only if it is genuinely measurable;
otherwise use restrained indeterminate activity and plain-language status.
Avoid generic spinners as the only explanation, fabricated time estimates,
animated avatars, sparkle icons as a universal AI signifier, neon gradients,
glowing borders, or raw chain-of-thought theatre.

Conversational interaction is one possible expression of an AI-native
environment, not an assumption of this brief. When it is used, a transcript
should not be the only structure available for understanding, verifying,
comparing, or challenging consequential information. Current product documents
define its role.

## Interaction character

The system should provide a polished, understandable default while supporting
professional repeated use. Progressive disclosure and keyboard efficiency are
desirable; complexity should become available as the user needs it rather
than being displayed as proof of sophistication.

Actions should have a stable hierarchy: Oracle Ink filled primary, bordered
secondary, and text-link tertiary. Destructive styling is reserved for
actually destructive actions. Forms should use persistent labels, concise
help, validation after interaction, and clear recovery; placeholders must not
serve as labels.

Interactive patterns should feel complete and intentional across hover,
focus, active, disabled, loading, success, and error conditions, in both
themes. The downstream designer determines exact component behavior.

## Accessibility and responsive intent

WCAG 2.2 AA is the baseline, not a finishing pass. The design must support
keyboard operation, visible and unobscured focus, meaningful semantic
structure, non-color cues, suitable contrast, useful target sizes, 320px
reflow, 200% zoom, alternatives for meaningful visuals, and reduced motion.

Contrast must be verified using the rendered foreground/background pair in
every theme and relevant state, including muted copy, metadata, placeholders,
table text, chart labels, semantic messages, hover, focus, disabled, and
selected treatments. Normal text must reach at least 4.5:1 and large text at
least 3:1; meaningful non-text controls, focus indicators, and graphical
boundaries must reach at least 3:1 where WCAG requires it. Treat these as
floors, not targets: sustained reading and dense financial work should normally
be more comfortable than the minimum. Do not exploit exemptions for inactive
controls to make their label or state unnecessarily illegible.

Use documented reference breakpoints, but let content determine when a layout
or pattern transforms. Financial information should not be forced through one
universal mobile pattern. Light and dark themes must both preserve hierarchy,
semantics, and accessibility.

## Reference lessons, not templates

The following products illustrate useful principles. None is a visual template
for Pythia, and their page structures, palettes, and component styles should
not be copied.

- [AlphaSense Generative Grid](https://help.alpha-sense.com/hc/en-us/articles/41680141048979-Leveraging-Generative-Grid)
  shows how natural-language research can become structured, comparable work
  while keeping citations attached to generated answers.
- [Quartr AI chat](https://quartr.com/features/ai-chat) places sourced answers
  beside the underlying first-party document and links to the exact page. The
  lesson is source-adjacent verification, not its chat layout.
- [BamSEC filing comparison](https://help.bamsec.com/docs/compare-filings)
  makes document change the primary object and preserves the surrounding
  filing context. The lesson is to emphasize meaningful deltas without hiding
  the baseline.
- [Koyfin dashboards](https://www.koyfin.com/help/mydashboards-myd/) demonstrate
  professional information density, stable working surfaces, and the value of
  customization after a useful default exists.
- [Harvey's design approach](https://www.harvey.ai/fr-FR/blog/how-we-approach-design-at-harvey)
  demonstrates that professional AI can feel modern through domain awareness,
  precision, familiar working forms, and an inspectable paper trail rather
  than futuristic decoration.

For the downstream system, [Atlassian's semantic-token guidance](https://atlassian.design/foundations/tokens/design-tokens/)
is a useful model for naming by meaning rather than raw appearance. The
[USWDS design principles](https://designsystem.digital.gov/design-principles/)
reinforce user needs, trust, continuity, and accessibility as evaluative
lenses. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) is the accessibility
baseline.

## Anti-patterns

The following treatments conflict with the direction and must not define the
system:

- generic chat UI with citations dumped beneath an answer;
- autonomous-investing, guaranteed-return, or prophetic imagery and language;
- mystical oracle art, Greek architecture, celestial decoration, or a Pythia
  mascot;
- purple/blue AI-gradient clichés, neon glow, glassmorphism, 3D abstractions,
  or “thinking” spectacle; subtle brand-derived atmospheric gradients on the
  Public website are explicitly permitted;
- traditional-bank gravitas, asset-manager luxury, or Bloomberg-terminal
  cosplay;
- consumer-fintech softness, gamification, confetti, or bright market colors;
- decorative stock charts, candlesticks, coins, city skylines, and generic
  investor photography;
- every section or metric inside a floating rounded card;
- Signal Amber used as a button color, warning color, or general application
  decoration; broad Public-site atmosphere may use pale amber-derived tints as
  defined above;
- multiple amber markers competing inside one Product component, or a large
  amber Product surface where one small identity cue would communicate the
  same meaning;
- green/red used interchangeably for unrelated market, analytical, and
  software meanings;
- hidden provenance, sources-at-the-bottom, or machine judgment styled as
  sourced fact;
- false precision, invented progress, or incomplete research hidden as a
  loading state; and
- concept interfaces presented as shipped product.

## Evaluation lens

A design proposal belongs to Pythia when:

- it feels calm and clear before it feels impressive;
- it looks unmistakably modern without relying on AI visual clichés;
- professional density appears where the work requires it, not everywhere;
- evidence, uncertainty, and source context are easier to inspect than in a
  generic chat product;
- the identity feels integrated but never competes with the research;
- the website and application clearly belong to one system while serving
  different jobs; and
- nothing in the interface implies that Pythia owns the investment judgment.

If a proposal is attractive but fails one of these tests, it is not the right
design for Pythia.
