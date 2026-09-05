import { researchEvidenceSemanticsCompositionDemo } from "../../../composition-demos";
import { CompositionDemoFrame } from "../demo-frame";
import { ResearchEvidenceComposition } from "./research-composition";

export default function ResearchEvidenceSemanticsCompositionPage() {
  return (
    <CompositionDemoFrame demo={researchEvidenceSemanticsCompositionDemo}>
      <ResearchEvidenceComposition />
    </CompositionDemoFrame>
  );
}
