import {
  Badge,
  Button,
  EmptyState,
  Field,
  FinancialValue,
  Inline,
  KnowledgeState,
  PythiaLockup,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarItem,
  SidebarLink,
  SidebarList,
  SidebarNav,
  SidebarSection,
  SidebarSectionLabel,
  Stack,
  Textarea,
} from "@pythia/ui";
import { NotebookText } from "lucide-react";
import { syntheticCompositionFixture } from "../../../composition-fixture";
import styles from "./product-shell-composition.module.css";

const fixture = syntheticCompositionFixture;
const incompleteState = fixture.knowledgeStates[1];

export function ProductShellComposition() {
  return (
    <section
      aria-label="Product shell-and-density component composition"
      className={styles.stage}
      data-density="moderately-compact"
      data-responsive-minimum="320px"
    >
      <div className={styles.shell}>
        <Sidebar className={styles.sidebar}>
          <SidebarHeader className={styles.sidebarHeader}>
            <PythiaLockup
              className={styles.lockup}
              label="Pythia"
              variant="compact"
            />
          </SidebarHeader>
          <SidebarContent className={styles.sidebarContent}>
            <SidebarNav aria-label="Stable synthetic shell navigation">
              <SidebarSection className={styles.navSection}>
                <SidebarSectionLabel>Composition areas</SidebarSectionLabel>
                <SidebarList className={styles.navList}>
                  <SidebarItem>
                    <SidebarLink active href="#synthetic-context">
                      Context
                    </SidebarLink>
                  </SidebarItem>
                  <SidebarItem>
                    <SidebarLink href="#synthetic-grouping">
                      Grouping
                    </SidebarLink>
                  </SidebarItem>
                  <SidebarItem>
                    <SidebarLink href="#synthetic-boundaries">
                      Boundaries
                    </SidebarLink>
                  </SidebarItem>
                  <SidebarItem>
                    <SidebarLink href="#synthetic-conversation">
                      Conversation
                    </SidebarLink>
                  </SidebarItem>
                </SidebarList>
              </SidebarSection>
            </SidebarNav>
          </SidebarContent>
        </Sidebar>

        <div className={styles.workspace}>
          <header className={styles.workspaceHeader} id="synthetic-context">
            <div className={styles.entityHeading}>
              <p className={styles.eyebrow}>Synthetic working context</p>
              <h4>{fixture.entity.name}</h4>
              <p>{fixture.entity.qualifier}</p>
            </div>
            <Inline align="center" gap="2" wrap>
              <Badge tone="info">As of {fixture.dates.asOf}</Badge>
            </Inline>
          </header>

          <div className={styles.workspaceBody}>
            <main className={styles.primaryColumn} id="synthetic-grouping">
              <section
                aria-labelledby="investment-snapshot-heading"
                className={styles.snapshotSection}
              >
                <header className={styles.sectionHeader}>
                  <div>
                    <p className={styles.eyebrow}>Investment snapshot</p>
                    <h5 id="investment-snapshot-heading">
                      Supplied financial context
                    </h5>
                    <p className={styles.sectionDescription}>
                      A single primary reading surface keeps the important
                      values and their basis together.
                    </p>
                  </div>
                  <Badge tone="neutral">2 supplied values</Badge>
                </header>

                <div className={styles.metricStrip}>
                  {fixture.financialValues.map((item) => (
                    <FinancialValue
                      basis={item.basis}
                      currencyOrUnit={
                        "currency" in item
                          ? `${item.currency} · ${item.unit}`
                          : item.unit
                      }
                      freshness={item.freshness}
                      key={item.label}
                      label={item.label}
                      period={item.period}
                      value={item.display}
                    />
                  ))}
                </div>

                <dl className={styles.contextList}>
                  <div>
                    <dt>Fixture ticker</dt>
                    <dd>{fixture.entity.ticker}</dd>
                  </div>
                  <div>
                    <dt>Venue</dt>
                    <dd>{fixture.entity.venue}</dd>
                  </div>
                  <div>
                    <dt>Period end</dt>
                    <dd>{fixture.dates.periodEnd}</dd>
                  </div>
                  <div>
                    <dt>Retrieved</dt>
                    <dd>{fixture.dates.retrieved}</dd>
                  </div>
                </dl>

                <div className={styles.coverageNotice}>
                  <p className={styles.supportLabel}>Evidence coverage</p>
                  <KnowledgeState
                    className={styles.coverageState}
                    state={incompleteState.state}
                  >
                    {incompleteState.detail}
                  </KnowledgeState>
                </div>
              </section>

              <section
                aria-label="Research notes"
                className={styles.notesSection}
                id="synthetic-boundaries"
              >
                <EmptyState
                  className={styles.notesEmptyState}
                  description="This valid empty area contains no supplied synthetic notes."
                  icon={<NotebookText aria-hidden="true" />}
                  title="No synthetic notes"
                />
              </section>
            </main>

            <aside
              aria-label="Integrated conversational affordance"
              className={styles.conversationColumn}
              id="synthetic-conversation"
            >
              <header className={styles.railHeader}>
                <p className={styles.eyebrow}>Conversation affordance</p>
                <h5>Research assistant</h5>
                <p className={styles.sectionDescription}>
                  A subordinate rail stays beside the context it could examine,
                  without depicting live AI behavior.
                </p>
              </header>

              <Stack className={styles.railBody} gap="4">
                <div className={styles.conversationContext}>
                  <span>Context attached</span>
                  <strong>{fixture.signal.title}</strong>
                  <p>{fixture.signal.detail}</p>
                </div>
                <Field
                  description="Read-only in this component composition; no request is sent."
                  label="Ask about the synthetic context"
                >
                  <Textarea
                    aria-label="Synthetic conversation prompt"
                    className={styles.conversationInput}
                    placeholder="Ask a focused question…"
                    readOnly
                    rows={5}
                    size="sm"
                  />
                </Field>
                <Inline align="center" gap="2" wrap>
                  <Button disabled size="sm">
                    Send unavailable
                  </Button>
                  <span className={styles.staticNote}>Static affordance</span>
                </Inline>
              </Stack>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}
