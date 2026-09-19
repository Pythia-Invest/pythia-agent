export function buildWidget(
  entry: string,
  output: string,
): Promise<{
  output: string;
  bytes: number;
  durationMs: number;
}>;
