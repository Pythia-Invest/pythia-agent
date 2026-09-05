import { publicProfileCompositionDemo } from "../../../composition-demos";
import { CompositionDemoFrame } from "../demo-frame";
import { PublicProfileComposition } from "./public-composition";

export default function PublicProfileCompositionPage() {
  return (
    <CompositionDemoFrame demo={publicProfileCompositionDemo}>
      <PublicProfileComposition />
    </CompositionDemoFrame>
  );
}
