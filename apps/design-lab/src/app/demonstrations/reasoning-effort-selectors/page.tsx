import { reasoningEffortSelectorsCompositionDemo } from "../../../composition-demos";
import { CompositionDemoFrame } from "../demo-frame";
import { ReasoningEffortSelectorsComposition } from "./reasoning-effort-selectors";

export default function ReasoningEffortSelectorsPage() {
  return (
    <CompositionDemoFrame demo={reasoningEffortSelectorsCompositionDemo}>
      <ReasoningEffortSelectorsComposition />
    </CompositionDemoFrame>
  );
}
