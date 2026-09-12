import { syntheticCompositionFixture } from "../../../composition-fixture";

/**
 * Reading faces compared for the Desk conversation. Inter was chosen and is
 * self-hosted in `packages/ui`; the other candidates still load from Google
 * Fonts so the comparison stays readable.
 */
const candidates = [
  {
    id: "source-serif",
    name: "Source Serif 4",
    family: '"Source Serif 4", Georgia, "Times New Roman", serif',
    note: "Text serif with optical sizes, true italics, tabular lining numerals.",
    size: "17px",
  },
  {
    id: "inter",
    name: "Inter",
    family: 'Inter, "Helvetica Neue", Arial, sans-serif',
    note: "Chosen. Self-hosted from @pythia/ui as the font-reading role.",
    size: "14px",
  },
  {
    id: "geist",
    name: "Geist",
    family: 'Geist, "Helvetica Neue", Arial, sans-serif',
    note: "Slightly more geometric grotesque with a large x-height.",
    size: "16px",
  },
] as const;

const reference = {
  id: "plex",
  name: "IBM Plex Sans (current)",
  family: '"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif',
  note: "What the chat renders in today, for comparison.",
  size: "16px",
} as const;

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..700&family=Geist:wght@400..700&display=swap";

const entity = syntheticCompositionFixture.entity;

function FakeChat({ family, size }: { family: string; size: string }) {
  return (
    <div
      className="mx-auto grid w-full max-w-3xl gap-6"
      style={{ fontFamily: family, fontSize: size }}
    >
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-[1.25rem] bg-subtle px-4 py-2.5 text-foreground leading-reading">
          How sensitive is {entity.name}&rsquo;s free cash flow to a 10% drop in
          component volumes next year? Keep it short.
        </div>
      </div>
      <div className="grid gap-3 text-foreground leading-reading">
        <p className="m-0">
          Fairly sensitive. {entity.ticker} runs a high fixed-cost base, so a
          10% volume decline flows through to free cash flow at roughly{" "}
          <em>two to three times</em> the revenue move. Three things drive that:
        </p>
        <ol className="m-0 grid gap-1 ps-6">
          <li>
            <strong>Operating leverage.</strong> About 62% of cost of sales is
            fixed over a twelve-month horizon, mostly fab depreciation and
            salaried headcount.
          </li>
          <li>
            <strong>Working capital release.</strong> Lower volumes free
            inventory, which softens the first two quarters.
          </li>
          <li>
            <strong>Capex commitments.</strong> The 2032 expansion is
            contracted, so it does not flex with demand.
          </li>
        </ol>
        <table className="numeric w-full border-collapse text-[0.94em]">
          <thead>
            <tr>
              <th className="border border-border bg-subtle px-3 py-1.5 text-start font-medium">
                Scenario (fictional)
              </th>
              <th className="border border-border bg-subtle px-3 py-1.5 text-end font-medium">
                Revenue
              </th>
              <th className="border border-border bg-subtle px-3 py-1.5 text-end font-medium">
                Free cash flow
              </th>
              <th className="border border-border bg-subtle px-3 py-1.5 text-end font-medium">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-border px-3 py-1.5">Base case</td>
              <td className="border border-border px-3 py-1.5 text-end">
                €4,812m
              </td>
              <td className="border border-border px-3 py-1.5 text-end">
                €1,106m
              </td>
              <td className="border border-border px-3 py-1.5 text-end">—</td>
            </tr>
            <tr>
              <td className="border border-border px-3 py-1.5">Volumes −10%</td>
              <td className="border border-border px-3 py-1.5 text-end">
                €4,331m
              </td>
              <td className="border border-border px-3 py-1.5 text-end">
                €804m
              </td>
              <td className="border border-border px-3 py-1.5 text-end text-error">
                −27.3%
              </td>
            </tr>
            <tr>
              <td className="border border-border px-3 py-1.5">
                Volumes −10%, capex deferred
              </td>
              <td className="border border-border px-3 py-1.5 text-end">
                €4,331m
              </td>
              <td className="border border-border px-3 py-1.5 text-end">
                €958m
              </td>
              <td className="border border-border px-3 py-1.5 text-end text-error">
                −13.4%
              </td>
            </tr>
          </tbody>
        </table>
        <p className="m-0">
          The figures above are the fixture&rsquo;s synthetic model, not a
          forecast. If you want, I can rerun it with the{" "}
          <code className="rounded-control bg-subtle px-1 py-0.5 text-[0.9em]">
            fcf_sensitivity
          </code>{" "}
          tool against the 2031 filing for a fuller bridge.
        </p>
      </div>
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-[1.25rem] bg-subtle px-4 py-2.5 text-foreground leading-reading">
          Yes, and show the bridge as a table.
        </div>
      </div>
    </div>
  );
}

export function ChatTypographyComposition() {
  return (
    <section
      aria-labelledby="chat-typography-heading"
      className="grid gap-10"
      data-chat-typography="true"
    >
      <link href={FONTS_HREF} rel="stylesheet" />
      <h2 className="sr-only" id="chat-typography-heading">
        Chat typography candidates
      </h2>
      <nav aria-label="Candidates" className="flex flex-wrap gap-2">
        {[...candidates, reference].map((candidate) => (
          <a
            className="rounded-pill border border-border px-3 py-1 text-foreground-secondary text-sm no-underline hover:bg-interaction-hover hover:text-foreground"
            href={`#font-${candidate.id}`}
            key={candidate.id}
          >
            {candidate.name}
          </a>
        ))}
      </nav>
      {[...candidates, reference].map((candidate, index) => (
        <article
          className="grid gap-5 rounded-container border border-border bg-raised p-6"
          data-font={candidate.id}
          id={`font-${candidate.id}`}
          key={candidate.id}
        >
          <header className="grid gap-1">
            <p className="m-0 text-foreground-disabled text-xs uppercase tracking-wide">
              {index < candidates.length ? `Option ${index + 1}` : "Reference"}
            </p>
            <h3 className="m-0 font-semibold text-foreground text-lg">
              {candidate.name}
              <span className="ms-2 font-normal text-foreground-secondary text-sm">
                {candidate.size} body
              </span>
            </h3>
            <p className="m-0 text-foreground-secondary text-sm">
              {candidate.note}
            </p>
          </header>
          <FakeChat family={candidate.family} size={candidate.size} />
        </article>
      ))}
    </section>
  );
}
