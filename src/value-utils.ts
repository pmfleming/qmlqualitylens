import type { JsonValue } from "./types.js";

export function parseJson(text: string): JsonValue { return JSON.parse(text); }

export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export function isJsonRecord(value: JsonValue | undefined): value is Record<string, JsonValue> { return isRecord(value); }

export function stringValue(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }

export function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;
}

export function hasCaptures(match: RegExpMatchArray | null, ...indexes: number[]): match is RegExpMatchArray { return match !== null && indexes.every((index) => Boolean(match[index])); }
