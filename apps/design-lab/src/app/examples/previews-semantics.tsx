import {
  Citation,
  EpistemicLabel,
  FinancialValue,
  FreshnessLabel,
  KnowledgeState,
  MarketDirection,
  Provenance,
  PythiaSignal,
  SemanticMessage,
  SourceMetadata,
} from "@pythia/ui";
import type { CatalogRoute } from "../../catalog";
import { DemoNote, Specimen, SpecimenGrid } from "./specimen";

export function SemanticsPreview({ route }: { route: CatalogRoute }) {
  switch (route) {
    case "/components/citation":
      return (
        <SpecimenGrid>
          <Specimen label="Point-of-use source reference">
            <Citation
              locator="Synthetic filing · page 42 · invented excerpt location"
              marker="S1"
              retrievedAt="2028-04-12 09:30 UTC"
              source="Northstar Materials fictional annual filing"
              sourceDate="2028-03-31"
            />
            <DemoNote>
              This citation does not resolve, verify, or authorize a source.
            </DemoNote>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/source-metadata":
      return (
        <SpecimenGrid>
          <Specimen label="Kept-together source facts">
            <SourceMetadata
              retrievedAt="2028-04-12 09:30 UTC"
              source="Synthetic issuer filing"
              sourceDate="2028-03-31"
            />
            <SourceMetadata
              source="Synthetic investor note"
              sourceDate="2028-04-02"
            />
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/provenance":
      return (
        <SpecimenGrid>
          <Specimen label="Nearby basis and ownership">
            <Provenance
              basis="Invented arithmetic over a labelled synthetic filing"
              epistemic="machine"
              freshness="current"
              period="FY 2028"
              source="Synthetic filing S1"
            />
            <Provenance
              basis="Explicit fictional investor assumption"
              epistemic="human"
              period="Long-term synthetic scenario"
            />
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/epistemic-label":
      return (
        <SpecimenGrid>
          <Specimen label="Supplied claim ownership">
            <div className="catalog-feedback-list">
              <EpistemicLabel kind="fact" />
              <EpistemicLabel kind="machine" />
              <EpistemicLabel kind="human" />
            </div>
            <DemoNote>
              The component presents the caller’s classification; it does not
              infer truth.
            </DemoNote>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/financial-value":
      return (
        <SpecimenGrid>
          <Specimen label="Value with required context">
            <FinancialValue
              basis="Synthetic reported"
              currencyOrUnit="EUR million"
              freshness="current"
              period="FY 2028"
              value="1,240"
            />
            <FinancialValue
              basis="Synthetic estimate"
              currencyOrUnit="×"
              freshness="delayed"
              period="FY 2029E"
              value="3.2"
            />
            <DemoNote>
              Values are preformatted fictional display inputs; no arithmetic is
              performed.
            </DemoNote>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/market-direction":
      return (
        <SpecimenGrid>
          <Specimen label="Direction without recommendation">
            <div className="catalog-feedback-list">
              <MarketDirection
                context="synthetic day"
                direction="up"
                value="+2.4%"
              />
              <MarketDirection
                context="synthetic day"
                direction="down"
                value="−1.8%"
              />
              <MarketDirection
                context="synthetic day"
                direction="unchanged"
                value="0.0%"
              />
            </div>
            <DemoNote>
              Movement is not favorable or unfavorable analytical impact.
            </DemoNote>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/freshness-label":
      return (
        <SpecimenGrid>
          <Specimen label="Supplied evidence recency">
            <div className="catalog-feedback-list">
              <FreshnessLabel
                detail="Synthetic as of 2028-04-12"
                state="current"
              />
              <FreshnessLabel
                detail="Synthetic 15-minute lag"
                state="delayed"
              />
              <FreshnessLabel
                detail="Synthetic source needs review"
                state="stale"
              />
              <FreshnessLabel
                detail="No synthetic source date"
                state="unknown"
              />
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/pythia-signal":
      return (
        <SpecimenGrid>
          <Specimen label="Canonical Oracle seam">
            <PythiaSignal
              metadata={
                <Provenance
                  basis="Invented comparison for visual evaluation"
                  epistemic="machine"
                  freshness="current"
                  period="FY 2028"
                  source="Synthetic filing S1"
                />
              }
              title="Synthetic working capital is absorbing more cash."
            >
              Fictional receivables rose faster than fictional revenue. Labelled
              synthetic; no company or investment claim.
            </PythiaSignal>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/semantic-message":
      return (
        <SpecimenGrid>
          <Specimen label="Conventional interface messages">
            <div className="catalog-feedback-list">
              <SemanticMessage
                title="Synthetic context available"
                tone="information"
              >
                Helpful presentation-only information.
              </SemanticMessage>
              <SemanticMessage title="Synthetic step complete" tone="success">
                No external action was performed.
              </SemanticMessage>
              <SemanticMessage title="Check the synthetic date" tone="warning">
                A conventional warning, never a Pythia signal.
              </SemanticMessage>
              <SemanticMessage title="Synthetic operation failed" tone="error">
                A labelled failure specimen.
              </SemanticMessage>
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/knowledge-state":
      return (
        <SpecimenGrid>
          <Specimen label="Distinct limitations and failures">
            <div className="catalog-feedback-list">
              <KnowledgeState state="no-evidence">
                No matching synthetic evidence was supplied.
              </KnowledgeState>
              <KnowledgeState state="insufficient-coverage">
                Only one fictional period is represented.
              </KnowledgeState>
              <KnowledgeState state="stale">
                The labelled synthetic source date needs review.
              </KnowledgeState>
              <KnowledgeState state="unavailable">
                The fictional calculation has no required input.
              </KnowledgeState>
              <KnowledgeState state="failed">
                The local synthetic operation did not complete.
              </KnowledgeState>
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    default:
      throw new Error(`Missing curated semantics preview: ${route}`);
  }
}
