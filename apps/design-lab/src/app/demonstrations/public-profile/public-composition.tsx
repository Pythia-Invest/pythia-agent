import {
  Badge,
  Card,
  Citation,
  Container,
  FinancialValue,
  Inline,
  LinkButton,
  Provenance,
  PythiaLockup,
  PythiaSignal,
  Stack,
} from "@pythia/ui";
import { syntheticCompositionFixture } from "../../../composition-fixture";
import styles from "./public-profile.module.css";

const fixture = syntheticCompositionFixture;
const revenue = fixture.financialValues[0];
const citation = fixture.citations[0];
const signal = fixture.signal;
const signalProvenance = fixture.provenance[1];

export function PublicProfileComposition() {
  return (
    <section
      aria-labelledby="public-composition-heading"
      className={styles.publicStudy}
      data-public-composition="true"
    >
      <Container className={styles.canvas} size="wide">
        <header className={styles.identityLine}>
          <PythiaLockup
            className={styles.lockup ?? ""}
            label="Pythia public-profile identity"
          />
          <Inline className={styles.studyLabel} gap="3">
            <Badge>Public profile</Badge>
            <span>Composition study</span>
          </Inline>
        </header>

        <section className={styles.hero}>
          <Stack className={styles.heroCopy} gap="6">
            <p className={styles.eyebrow}>Typography · rhythm · atmosphere</p>
            <h2 id="public-composition-heading">
              Evidence needs room to breathe.
            </h2>
            <p className={styles.lede}>
              A spacious Public-profile study built from approved shared
              components and labelled synthetic material. It is not a live site,
              product view, or investment conclusion.
            </p>
            <nav aria-label="Public composition study anchors">
              <Inline className={styles.actions} gap="3">
                <LinkButton href="#public-concept-preview" size="lg">
                  View concept preview
                </LinkButton>
                <LinkButton
                  href="#public-composition-notes"
                  size="lg"
                  variant="secondary"
                >
                  Read composition note
                </LinkButton>
              </Inline>
            </nav>
          </Stack>

          <Card
            className={styles.intentCard}
            description="A bounded visual specimen, not a page proposal."
            title="Composition intent"
            variant="outlined"
          >
            <dl className={styles.intentList}>
              <div>
                <dt>Profile</dt>
                <dd>Public</dd>
              </div>
              <div>
                <dt>Material</dt>
                <dd>Labelled synthetic fixture</dd>
              </div>
              <div>
                <dt>Behavior</dt>
                <dd>Anchor navigation only</dd>
              </div>
            </dl>
          </Card>
        </section>

        <section
          aria-labelledby="public-concept-heading"
          className={styles.conceptSection}
          id="public-concept-preview"
        >
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Concept preview · Synthetic</p>
            <h2 id="public-concept-heading">Context stays beside the claim.</h2>
            <p>
              The preview remains editorial and transparent: the invented source
              record, supplied value, and machine assessment keep their distinct
              labels.
            </p>
          </div>

          <div className={styles.conceptGrid}>
            <Card
              className={styles.excerptCard}
              description={fixture.entity.qualifier}
              title="Synthetic research excerpt"
            >
              <Stack gap="6">
                <div className={styles.excerptHeading}>
                  <Badge>Concept preview · Synthetic</Badge>
                  <div>
                    <h3>{fixture.entity.name}</h3>
                    <p>
                      As of {fixture.dates.asOf} · {fixture.entity.ticker} ·{" "}
                      {fixture.entity.venue}
                    </p>
                  </div>
                </div>
                <p className={styles.excerptCopy}>
                  This invented excerpt gives the financial value a clear period
                  and basis before any interpretation is introduced.
                </p>
                <FinancialValue
                  basis={revenue.basis}
                  currencyOrUnit={`${revenue.currency} · ${revenue.unit}`}
                  freshness={revenue.freshness}
                  label={revenue.label}
                  period={revenue.period}
                  value={revenue.display}
                />
                <Citation
                  locator={citation.locator}
                  marker={citation.marker}
                  retrievedAt={citation.retrieved}
                  source={citation.source}
                  sourceDate={citation.published}
                />
              </Stack>
            </Card>

            <PythiaSignal
              className={styles.signal ?? ""}
              metadata={
                <Provenance
                  basis={signalProvenance.method}
                  epistemic={signal.epistemic}
                  freshness={signal.freshness}
                  period={revenue.period}
                  source={signalProvenance.source}
                />
              }
              title={signal.title}
            >
              {signal.detail} Synthetic source marker [{signal.sourceMarker}].
            </PythiaSignal>
          </div>
        </section>

        <footer className={styles.studyFooter} id="public-composition-notes">
          <div>
            <p className={styles.eyebrow}>Composition note</p>
            <p>
              Identity, generous measure, restrained atmosphere, and direct
              controls share one calm cadence without implying a shipped public
              page.
            </p>
          </div>
          <LinkButton href="#public-composition-heading" variant="ghost">
            Back to study heading
          </LinkButton>
        </footer>
      </Container>
    </section>
  );
}
