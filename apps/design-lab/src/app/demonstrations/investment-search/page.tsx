import { investmentSearchCompositionDemo } from "../../../composition-demos";
import { CompositionDemoFrame } from "../demo-frame";
import { InvestmentSearchDemo } from "./investment-search-demo";

export default function InvestmentSearchPage() {
  return (
    <CompositionDemoFrame demo={investmentSearchCompositionDemo}>
      <InvestmentSearchDemo />
    </CompositionDemoFrame>
  );
}
