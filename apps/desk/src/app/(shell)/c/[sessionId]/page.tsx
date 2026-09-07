/** An existing Hermes chat; the conversation surface renders here next. */
export default async function ChatPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  await params;
  return null;
}
