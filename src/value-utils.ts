export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;
}

export function hasCaptures(match: RegExpMatchArray | null, ...indexes: number[]): match is RegExpMatchArray {
  return match !== null && indexes.every((index) => Boolean(match[index]));
}
