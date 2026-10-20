import { DomainError } from "../errors.js";

export const FACT_VALUE_TYPES = [
  "number",
  "money",
  "percent",
  "date",
  "bool",
  "text",
  "url",
  "text_list",
] as const;

export type FactValueType = (typeof FACT_VALUE_TYPES)[number];

// Record fields use the fact value types plus long_text.
export const RECORD_FIELD_TYPES = [...FACT_VALUE_TYPES, "long_text"] as const;

export type MoneyValue = { amount: number; currency: string };

export interface TypedValue {
  valueNum: string | null;
  valueText: string | null;
  valueDate: string | null;
  valueBool: boolean | null;
  valueJson: unknown;
  currency: string | null;
}

const EMPTY_VALUE: TypedValue = {
  valueNum: null,
  valueText: null,
  valueDate: null,
  valueBool: null,
  valueJson: null,
  currency: null,
};

export function isFactValueType(t: string): t is FactValueType {
  return (FACT_VALUE_TYPES as readonly string[]).includes(t);
}

export function isRecordFieldType(t: string): boolean {
  return (RECORD_FIELD_TYPES as readonly string[]).includes(t);
}

export function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Validate one value against its declared type, returning the typed columns.
// Errors name the expected shape so the caller can fix the call.
export function validateTypedValue(type: string, value: unknown, label: string): TypedValue {
  switch (type) {
    case "number":
    case "percent": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new DomainError("invalid_input", `${label}: expected a JSON number, got ${describe(value)}`);
      }
      return { ...EMPTY_VALUE, valueNum: String(value) };
    }
    case "money": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new DomainError(
          "invalid_input",
          `${label}: money needs {"amount": number, "currency": "USD"}, got ${describe(value)}`,
        );
      }
      const { amount, currency } = value as Record<string, unknown>;
      if (typeof amount !== "number" || !Number.isFinite(amount)) {
        throw new DomainError("invalid_input", `${label}: money amount must be a number`);
      }
      if (typeof currency !== "string" || currency.trim() === "") {
        throw new DomainError("invalid_input", `${label}: money needs a currency code, e.g. "USD"`);
      }
      return { ...EMPTY_VALUE, valueJson: { amount }, currency: currency.trim().toUpperCase() };
    }
    case "date": {
      if (typeof value !== "string" || !isValidDateString(value)) {
        throw new DomainError(
          "invalid_input",
          `${label}: expected a date as "YYYY-MM-DD", got ${describe(value)}`,
        );
      }
      return { ...EMPTY_VALUE, valueDate: value };
    }
    case "bool": {
      if (typeof value !== "boolean") {
        throw new DomainError("invalid_input", `${label}: expected true or false, got ${describe(value)}`);
      }
      return { ...EMPTY_VALUE, valueBool: value };
    }
    case "text":
    case "long_text": {
      if (typeof value !== "string" || value.trim() === "") {
        throw new DomainError("invalid_input", `${label}: expected a non-empty string`);
      }
      return { ...EMPTY_VALUE, valueText: value };
    }
    case "url": {
      if (typeof value !== "string" || !isHttpUrl(value)) {
        throw new DomainError("invalid_input", `${label}: expected an http(s) URL, got ${describe(value)}`);
      }
      return { ...EMPTY_VALUE, valueText: value };
    }
    case "text_list": {
      if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string")) {
        throw new DomainError("invalid_input", `${label}: expected a non-empty array of strings`);
      }
      return { ...EMPTY_VALUE, valueJson: value };
    }
    default:
      throw new DomainError(
        "invalid_input",
        `${label}: unknown type "${type}". Valid types: ${RECORD_FIELD_TYPES.join(", ")}`,
      );
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

// Normalized for near-duplicate detection: lowercase, alphanumerics only.
export function normalizeRegistryName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min((prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + 1, diag + cost);
      diag = temp;
    }
  }
  return prev[b.length] ?? 0;
}

export const FACT_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
export const RECORD_TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;
export const SNAKE_PATTERN = /^[a-z][a-z0-9_]*$/;
