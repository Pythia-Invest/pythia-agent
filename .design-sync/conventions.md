# Building with @pythia/ui

This is the design system for Pythia, a local investment-research product. It is
a Tailwind v4 component library over Base UI primitives. Components are imported
from the bundle; layout glue is written in Tailwind utilities that resolve to
this system's own theme names.

## Setup

**No provider is required.** Components render correctly as soon as `styles.css`
is loaded — there is no ThemeProvider, no context root, no registration step.

Two attributes on the root element drive presentation. Set them; do not restyle
around them:

```jsx
<html data-theme="light" data-pythia-profile="product">
```

- `data-theme`: `"light"` or `"dark"`. Every token has both values; nothing else
  is needed for dark mode.
- `data-pythia-profile`: `"product"` for the application surface, `"public"` for
  marketing and public pages. The profile changes control height, page gutter,
  section gap, body/reading/display type size and the container surface. It is
  the correct way to make a page feel denser or more spacious — never hand-tune
  spacing to fake it.

## The styling idiom: semantic utilities, never raw palette

Write Tailwind utilities, but only over **this system's** theme names. There is
no `bg-gray-100`, no `text-slate-700`, no `rounded-md` — a raw palette class is
the signal that something has gone wrong. Real names, all of them usable as
`bg-*`, `text-*`, or `border-*` where the role makes sense:

| Family | Names |
| --- | --- |
| Surfaces | `canvas`, `raised`, `subtle`, `overlay`, `container`, `atmosphere` |
| Text | `foreground`, `foreground-secondary`, `foreground-disabled` |
| Lines & interaction | `border`, `border-strong`, `interaction-hover`, `interaction-active`, `ring` |
| Primary action | `primary`, `primary-foreground` |
| Interface status | `info`, `success`, `warning`, `error` — each with `-surface` and `-border` |
| Market movement | `market-up`, `market-down`, `market-flat` |
| Analytical impact | `impact-favorable`, `impact-unfavorable`, `impact-neutral`, `impact-unresolved` |
| Evidence freshness | `freshness-current`, `freshness-delayed`, `freshness-stale`, `freshness-unknown` |
| Claim ownership | `epistemic-fact`, `epistemic-machine`, `epistemic-human`, `epistemic-unknown` |
| Pythia signal | `signal`, `signal-foreground`, `signal-atmosphere` |

Geometry and type use named steps too: `rounded-control`, `rounded-container`,
`rounded-pill`; `h-control`, `px-gutter`, `gap-section`, `gap-group`,
`max-w-measure`; `text-body`, `text-reading`, `text-display`, `leading-tight`,
`leading-ui`, `leading-reading`; `shadow-popup`, `shadow-overlay`; `ring-ring`;
`font-sans` for interface chrome and `font-reading` for long-form prose.

Numeric Tailwind scales still work where the system has no named step —
`gap-3`, `p-4`, `text-sm`. Reach for the named step when one exists.

**Tone prop values are not uniform**: `Badge` takes
`info | success | warning | error | neutral`, while `SemanticMessage` takes
`information | success | warning | error`. Check the `.d.ts`.

## Meaning is not decoration — three distinctions this system enforces

These are why the semantic colour families are separate, and getting them wrong
misrepresents research to an investor:

1. **Market movement is not favourability.** `market-up` means the number went
   up. Whether that is good is `impact-*`, and it is a separate judgement.
2. **Interface status is not a research finding.** `warning` means the interface
   has something to report — a stale source, a failed import. It never means
   Pythia has a view about an investment.
3. **`signal` is reserved.** Use it only for `PythiaSignal`, the seam where the
   product presents something it found. Never as an accent or an emphasis colour.

Prefer the semantic components over hand-built equivalents: `FinancialValue`,
`MarketDirection`, `FreshnessLabel`, `EpistemicLabel`, `Provenance`, `Citation`,
`SourceMetadata`, `KnowledgeState`, `SemanticMessage`, `PythiaSignal`. They carry
these rules already. In particular, use `KnowledgeState` when there is no answer —
missing evidence is a designed state here, not an empty div.

## Where the truth is

- `styles.css` and its imports: every token, both themes, both profiles.
- `components/<group>/<Name>/<Name>.prompt.md`: what the component is for.
- `components/<group>/<Name>/<Name>.d.ts`: the prop contract. Use the exported names shown in those contracts: `Select` with
  `SelectTrigger`, `Table` with `TableRow`, and namespace parts such as
  `Accordion.Item`. `SearchSelect` is a namespace; start with
  `SearchSelect.Root`, then compose its Trigger, Portal, Positioner and Popup.

`PythiaLockup` is exported but its artwork cannot load in this environment — do
not put the brand mark in a design; use a text wordmark placeholder instead.

## An idiomatic composition

```jsx
<Card className="bg-canvas">
  <Stack gap="4">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-display leading-tight text-foreground">Northwind Grid Utilities</h2>
      <Badge tone="info">FY 2028</Badge>
    </div>
    <FinancialValue
      value="1,240" currencyOrUnit="EUR million"
      period="FY 2028" basis="Reported" freshness="current"
    />
    <Provenance
      source="Annual filing S1" period="FY 2028"
      basis="Arithmetic over a labelled filing" epistemic="machine" freshness="current"
    />
    <div className="flex justify-end gap-2">
      <Button variant="ghost">Dismiss</Button>
      <Button>Open evidence</Button>
    </div>
  </Stack>
</Card>
```
