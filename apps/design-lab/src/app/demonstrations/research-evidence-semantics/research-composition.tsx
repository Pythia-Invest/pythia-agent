import {
  Citation,
  EpistemicLabel,
  FinancialValue,
  KnowledgeState,
  MarketDirection,
  Provenance,
  PythiaSignal,
} from "@pythia/ui";
import { syntheticCompositionFixture } from "../../../composition-fixture";
import styles from "./research-composition.module.css";

export function ResearchEvidenceComposition() {
  const fixture = syntheticCompositionFixture;
  const [revenue, margin] = fixture.financialValues;
  const [filingCitation, marketCitation] = fixture.citations;
  const [factState, machineState, humanState] = fixture.epistemicStates;
  const machineProvenance = fixture.provenance[1];

  return (
    <div
      className={styles.composition}
      data-research-evidence-composition="true"
      data-responsive-minimum="320px"
    >
      <section
        aria-labelledby="research-conclusion-title"
        className={styles.section}
        data-composition-section="conclusion-and-evidence"
      >
        <header className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Point-of-use evidence</p>
          <h3 id="research-conclusion-title">
            One synthetic conclusion, kept with its evidence
          </h3>
          <p>
            The components display classifications already supplied by the
            fixture. This presentation neither verifies nor infers their
            meaning.
          </p>
        </header>

        <div className={styles.claimEvidencePair} data-evidence-pair="fact">
          <div className={styles.claim}>
            <EpistemicLabel kind={factState.kind} />
            <h4>{factState.label}</h4>
            <p>{factState.detail}</p>
            <FinancialValue
              basis={revenue.basis}
              currencyOrUnit={`${revenue.currency} ${revenue.unit}`}
              freshness={revenue.freshness}
              label={revenue.label}
              period={revenue.period}
              value={revenue.display}
            />
          </div>
          <div className={styles.evidence} data-adjacent-evidence="S1">
            <p className={styles.supportLabel}>Adjacent source record</p>
            <Citation
              locator={filingCitation.locator}
              marker={filingCitation.marker}
              retrievedAt={filingCitation.retrieved}
              source={filingCitation.source}
              sourceDate={filingCitation.published}
            />
          </div>
        </div>
      </section>

      <section
        aria-labelledby="research-ownership-title"
        className={styles.section}
        data-composition-section="claim-ownership"
      >
        <header className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Claim ownership</p>
          <h3 id="research-ownership-title">
            Fact, machine assessment, and human judgment stay distinct
          </h3>
        </header>

        <div className={styles.judgmentGrid}>
          <article className={styles.judgment} data-epistemic-kind="machine">
            <h4>{machineState.label}</h4>
            <p>{machineState.detail}</p>
            <Provenance
              basis={machineProvenance.method}
              epistemic={machineProvenance.epistemic}
              freshness={machineProvenance.freshness}
              period={margin.period}
              source={machineProvenance.source}
            />
          </article>
          <article className={styles.judgment} data-epistemic-kind="human">
            <h4>{humanState.label}</h4>
            <p>{humanState.detail}</p>
            <Provenance
              basis={humanState.detail}
              epistemic={humanState.kind}
              period={margin.period}
            />
          </article>
        </div>
      </section>

      <section
        aria-labelledby="research-finance-title"
        className={styles.section}
        data-composition-section="finance-and-market"
      >
        <header className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Financial context</p>
          <h3 id="research-finance-title">
            Values, freshness, and market direction keep separate meanings
          </h3>
        </header>

        <div className={styles.financeGrid}>
          <div className={styles.financialValue}>
            <p className={styles.supportLabel}>{margin.label}</p>
            <FinancialValue
              basis={margin.basis}
              currencyOrUnit={margin.unit}
              freshness={margin.freshness}
              label={margin.label}
              period={margin.period}
              value={margin.display}
            />
          </div>
          <div className={styles.marketEvidence} data-evidence-pair="market">
            <div>
              <p className={styles.supportLabel}>Market direction only</p>
              <MarketDirection
                context={fixture.marketMovement.context}
                direction={fixture.marketMovement.direction}
                value={fixture.marketMovement.display}
              />
            </div>
            <Citation
              locator={marketCitation.locator}
              marker={marketCitation.marker}
              retrievedAt={marketCitation.retrieved}
              source={marketCitation.source}
              sourceDate={marketCitation.published}
            />
          </div>
        </div>
      </section>

      <section
        aria-labelledby="research-signal-title"
        className={styles.section}
        data-composition-section="pythia-signal"
      >
        <header className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Restrained analytical emphasis</p>
          <h3 id="research-signal-title">Signal remains explicit</h3>
        </header>

        <PythiaSignal
          metadata={
            <Provenance
              basis={fixture.signal.detail}
              epistemic={fixture.signal.epistemic}
              freshness={fixture.signal.freshness}
              period={margin.period}
              source={fixture.signal.sourceMarker}
            />
          }
          title={fixture.signal.title}
        >
          {fixture.signal.detail}
        </PythiaSignal>
      </section>

      <section
        aria-labelledby="research-boundaries-title"
        className={styles.section}
        data-composition-section="knowledge-boundaries"
      >
        <header className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Knowledge boundaries</p>
          <h3 id="research-boundaries-title">
            Missing knowledge and failed work do not collapse together
          </h3>
        </header>

        <div className={styles.knowledgeGrid}>
          {fixture.knowledgeStates.map((item) => (
            <KnowledgeState key={item.state} state={item.state}>
              {item.detail}
            </KnowledgeState>
          ))}
        </div>
      </section>
    </div>
  );
}
