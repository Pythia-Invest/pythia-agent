import { chatTypographyCompositionDemo } from "../../../composition-demos";
import { CompositionDemoFrame } from "../demo-frame";
import { ChatTypographyComposition } from "./chat-typography";

export default function ChatTypographyCompositionPage() {
  return (
    <CompositionDemoFrame demo={chatTypographyCompositionDemo}>
      <ChatTypographyComposition />
    </CompositionDemoFrame>
  );
}
