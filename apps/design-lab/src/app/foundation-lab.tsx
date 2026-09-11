"use client";

import { PythiaLockup, PythiaSignal } from "@pythia/ui";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { LabControls, type LabViewport } from "./lab-controls";

const semanticGroups = [
  {
    label: "Interface status",
    description: "What the interface needs the user to know.",
    specimens: [
      [
        "i",
        "Information",
        "Helpful context",
        "var(--py-status-info-foreground)",
      ],
      ["✓", "Success", "Completed", "var(--py-status-success-foreground)"],
      ["!", "Warning", "Needs caution", "var(--py-status-warning-foreground)"],
      ["×", "Error", "Could not complete", "var(--py-status-error-foreground)"],
    ],
  },
  {
    label: "Market movement",
    description: "Observed direction, never analytical judgment.",
    specimens: [
      ["↑", "Up", "+2.4%", "var(--py-market-up)"],
      ["↓", "Down", "−1.8%", "var(--py-market-down)"],
      ["→", "Flat", "0.0%", "var(--py-market-flat)"],
    ],
  },
  {
    label: "Analytical impact",
    description: "How evidence affects the investment case.",
    specimens: [
      ["+", "Favorable", "Supports", "var(--py-impact-favorable)"],
      ["−", "Unfavorable", "Challenges", "var(--py-impact-unfavorable)"],
      ["=", "Neutral", "No change", "var(--py-impact-neutral)"],
      ["?", "Unresolved", "Open effect", "var(--py-impact-unresolved)"],
    ],
  },
  {
    label: "Freshness",
    description: "How current the supplied evidence is.",
    specimens: [
      ["Now", "Current", "Up to date", "var(--py-freshness-current)"],
      ["Lag", "Delayed", "Known delay", "var(--py-freshness-delayed)"],
      ["Old", "Stale", "Review needed", "var(--py-freshness-stale)"],
      ["?", "Unknown", "No date", "var(--py-freshness-unknown)"],
    ],
  },
  {
    label: "Epistemic source",
    description: "Who or what supplied the judgment.",
    specimens: [
      ["F", "Fact", "Sourced claim", "var(--py-epistemic-fact)"],
      ["M", "Machine", "Model judgment", "var(--py-epistemic-machine)"],
      ["H", "Human", "Investor view", "var(--py-epistemic-human)"],
      ["?", "Unknown", "Not established", "var(--py-epistemic-unknown)"],
    ],
  },
] as const;

function SemanticSpecimen({
  cue,
  description,
  foreground,
  label,
}: {
  cue: string;
  description: string;
  foreground: string;
  label: string;
}) {
  return (
    <div className="lab-semantic-swatch">
      <span
        aria-hidden="true"
        className="lab-semantic-cue"
        style={{ color: foreground }}
      >
        {cue}
      </span>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </div>
  );
}

export function FoundationLab() {
  const [viewport, setViewport] = useState<LabViewport>("wide");

  return (
    <div className="lab-shell min-h-screen">
      <header className="lab-toolbar-wrap">
        <div className="lab-toolbar">
          <div className="lab-title">
            <span className="lab-title-mark" />
            <strong>Foundation Lab</strong>
            <span>Shared baseline</span>
          </div>
          <LabControls onViewportChange={setViewport} viewport={viewport} />
        </div>
      </header>

      <div className="lab-viewport-stage" data-lab-viewport={viewport}>
        <main className="lab-page">
          <section className="lab-hero">
            <span className="lab-eyebrow">Foundation / current baseline</span>
            <h1>One language, tuned for two jobs.</h1>
            <p>
              This synthetic surface isolates the shared visual decisions: type,
              identity, rhythm, geometry, interaction, and semantic color.
              Switch the controls above to judge the system—not a proposed page.
            </p>
          </section>

          <section className="lab-section">
            <div className="lab-section-heading">
              <h2>Identity at working scales</h2>
              <p>
                Approved full, compact and mark exports adapt to the resolved
                theme. All three use the shared package component; none is
                recreated by the consumer.
              </p>
            </div>
            <div className="lab-grid">
              <article className="lab-card lab-identity">
                <p className="lab-card-kicker">Full lockup</p>
                <PythiaLockup
                  className="lab-lockup"
                  label="Pythia full lockup specimen"
                />
                <p>Primary signature for spacious, identity-led moments.</p>
              </article>
              <article className="lab-card lab-identity">
                <p className="lab-card-kicker">Compact lockup</p>
                <PythiaLockup
                  className="lab-lockup compact"
                  label="Pythia compact lockup specimen"
                  variant="compact"
                />
                <p>Recognizable at constrained and application scales.</p>
              </article>
              <article className="lab-card lab-identity">
                <p className="lab-card-kicker">Mark</p>
                <PythiaLockup
                  className="lab-lockup mark"
                  label="Pythia mark specimen"
                  variant="mark"
                />
                <p>
                  The pictogram alone, where the surface already names Pythia in
                  words.
                </p>
              </article>
            </div>
          </section>

          <section className="lab-section">
            <div className="lab-section-heading">
              <h2>Typography and reading rhythm</h2>
              <p>
                IBM Plex Sans carries display, reading, UI, and tabular numbers.
                Profile tokens—not separate implementations—change the cadence.
              </p>
            </div>
            <article className="lab-card lab-type-specimen">
              <div className="lab-type-display">Reason before reaction.</div>
              <div className="lab-type-reading">
                A calm reading line gives evidence room to breathe while keeping
                the analytical hierarchy obvious at a glance.
              </div>
              <div className="lab-type-ui">
                Persistent label · Medium emphasis
              </div>
              <div className="pythia-numeric">
                € 4,280.50 · +2.40% · FY 2028
              </div>
            </article>
          </section>

          <section className="lab-section">
            <div className="lab-section-heading">
              <h2>Rhythm and geometry</h2>
              <p>
                A short spacing ladder and restrained radii keep groups legible.
                Public is generous; Product is moderately compact.
              </p>
            </div>
            <div className="lab-grid">
              <article className="lab-card">
                <p className="lab-card-kicker">4 · 8 · 16 · 32 · 64</p>
                <div
                  aria-label="Spacing scale"
                  className="lab-rhythm"
                  role="img"
                >
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              </article>
              <article className="lab-card">
                <p className="lab-card-kicker">Interaction character</p>
                <h3>Neutral action, visible focus</h3>
                <p>
                  Hover and press stay quiet and neutral. Persistent selection
                  uses a hierarchy: interaction-active surfaces for subtle
                  current states, the primary pair for compact committed
                  controls, and primary-color markers where fill is unnecessary.
                  Signal Amber remains reserved for explicit Pythia signal
                  treatment.
                </p>
                <div className="lab-actions">
                  <button className="lab-action primary" type="button">
                    Primary action
                  </button>
                  <button className="lab-action" type="button">
                    Secondary
                  </button>
                </div>
              </article>
            </div>
          </section>

          <section className="lab-section">
            <div className="lab-section-heading">
              <h2>Color with a job</h2>
              <p>
                Amber marks analysis surfaced by Pythia. Orange asks the user to
                proceed carefully. Their shapes, surfaces, language, and
                placement make the difference clear before color does.
              </p>
            </div>
            <div className="lab-meaning-stage">
              <PythiaSignal
                className="lab-signal-specimen"
                metadata={
                  <div className="lab-signal-meta">
                    <span>
                      Machine assessment · synthetic · confidence not supplied
                    </span>
                    <span>
                      Synthetic issuer filing · S1 · 2032-03-28 · delayed
                    </span>
                  </div>
                }
                title="Working capital is absorbing more cash."
              >
                Receivables grew 18% while revenue grew 7%. The divergence is
                now material enough to examine.
              </PythiaSignal>

              <div className="lab-warning-demo">
                <p className="lab-card-kicker">Interface warning</p>
                <div className="lab-warning-notice" role="status">
                  <span className="lab-warning-icon">
                    <TriangleAlert aria-hidden="true" />
                  </span>
                  <div>
                    <strong>Check the source date</strong>
                    <p>
                      The latest filing is 45 days old. Review newer evidence
                      before relying on this figure.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="lab-section-heading lab-semantic-secondary-heading">
              <h3>Semantic reference</h3>
              <p>
                The remaining domains use explicit words and conventional signs.
                Color reinforces the meaning; it never has to explain it alone.
              </p>
            </div>
            <div className="lab-semantic-reference">
              {semanticGroups.map((group) => (
                <section className="lab-semantic-group" key={group.label}>
                  <div className="lab-semantic-group-heading">
                    <h3>{group.label}</h3>
                    <p>{group.description}</p>
                  </div>
                  <div className="lab-semantic-swatches">
                    {group.specimens.map(
                      ([cue, label, description, foreground]) => (
                        <SemanticSpecimen
                          cue={cue}
                          description={description}
                          foreground={foreground}
                          key={label}
                          label={label}
                        />
                      ),
                    )}
                  </div>
                </section>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
