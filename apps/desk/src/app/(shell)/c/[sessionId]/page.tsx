import { ChatView } from "@/components/chat/chat-view";

/** An existing Hermes chat. */
export default async function ChatPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <ChatView sessionId={sessionId} />;
}
