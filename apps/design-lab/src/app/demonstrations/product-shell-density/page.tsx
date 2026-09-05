import { productShellDensityCompositionDemo } from "../../../composition-demos";
import { CompositionDemoFrame } from "../demo-frame";
import { ProductShellComposition } from "./product-shell-composition";

export default function ProductShellDensityCompositionPage() {
  return (
    <CompositionDemoFrame demo={productShellDensityCompositionDemo}>
      <ProductShellComposition />
    </CompositionDemoFrame>
  );
}
