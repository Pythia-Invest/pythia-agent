"use client";

import {
  ActivityIndicator,
  Alert,
  Badge,
  Button,
  Progress,
  Skeleton,
  pythiaToast,
} from "@pythia/ui";
import type { CatalogRoute } from "../../catalog";
import { Specimen, SpecimenGrid } from "./specimen";

export function FeedbackPreview({ route }: { route: CatalogRoute }) {
  switch (route) {
    case "/components/alert":
      return (
        <SpecimenGrid>
          <Specimen label="Interface status meanings">
            <div className="catalog-feedback-list">
              <Alert title="Synthetic information" tone="info">
                Helpful fictional context for the specimen.
              </Alert>
              <Alert title="Synthetic step complete" tone="success">
                No external work was performed.
              </Alert>
              <Alert title="Check the synthetic date" tone="warning">
                This conventional warning is distinct from a Pythia signal.
              </Alert>
              <Alert title="Synthetic operation failed" tone="error">
                A labelled failure state for presentation review.
              </Alert>
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/badge":
      return (
        <SpecimenGrid>
          <Specimen label="Compact textual labels">
            <div className="catalog-row">
              <Badge>Neutral</Badge>
              <Badge tone="info">Information</Badge>
              <Badge tone="success">Complete</Badge>
              <Badge tone="warning">Review</Badge>
              <Badge tone="error">Failed</Badge>
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/progress":
      return (
        <SpecimenGrid>
          <Specimen label="Real supplied percentages">
            <div className="catalog-feedback-list">
              <Progress label="Synthetic document set" value={42} />
              <Progress label="Synthetic checklist" value={7} max={8} />
              <Progress
                label="Synthetic stage without visible number"
                showValue={false}
                value={68}
              />
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/skeleton":
      return (
        <SpecimenGrid>
          <Specimen label="Reserved loading shapes">
            <div
              aria-label="Loading synthetic content"
              className="catalog-skeleton-demo"
              role="status"
            >
              <Skeleton className="catalog-skeleton-avatar" shape="circle" />
              <div>
                <Skeleton />
                <Skeleton className="catalog-skeleton-short" />
              </div>
              <Skeleton className="catalog-skeleton-block" shape="block" />
              <span className="py-visually-hidden">
                Loading synthetic content
              </span>
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/activity-indicator":
      return (
        <SpecimenGrid>
          <Specimen label="Indeterminate activity">
            <div className="catalog-row">
              <ActivityIndicator label="Checking synthetic sources" />
              <ActivityIndicator
                label="Refreshing synthetic labels"
                size="small"
              />
              <ActivityIndicator
                label="Loading synthetic context"
                visuallyHiddenLabel
              />
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/toast":
      return (
        <SpecimenGrid>
          <Specimen label="Native toast queue">
            <div className="catalog-row">
              <Button
                onClick={() =>
                  pythiaToast.info({
                    title: "Synthetic information",
                    description: "A local, provider-free toast specimen.",
                    actionProps: {
                      children: "Review",
                      onClick: () => undefined,
                    },
                  })
                }
                variant="secondary"
              >
                Information toast
              </Button>
              <Button
                onClick={() =>
                  pythiaToast.success({
                    title: "Synthetic step complete",
                    description: "No external action occurred.",
                  })
                }
                variant="secondary"
              >
                Success toast
              </Button>
              <Button
                onClick={() =>
                  pythiaToast.warning({
                    title: "Review synthetic input",
                    description: "Warning remains separate from Signal Amber.",
                  })
                }
                variant="secondary"
              >
                Warning toast
              </Button>
              <Button
                onClick={() =>
                  pythiaToast.error({
                    title: "Synthetic operation failed",
                    description: "A labelled error in the native queue.",
                  })
                }
                variant="secondary"
              >
                Error toast
              </Button>
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    default:
      throw new Error(`Missing curated feedback preview: ${route}`);
  }
}
