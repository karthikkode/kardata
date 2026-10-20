import { DomainError } from "../domain/errors.js";

export function text(text: string): { type: "text"; text: string } {
  return { type: "text", text };
}

export function ok(summary: string, data: object) {
  return { content: [text(summary)], structuredContent: data as Record<string, unknown> };
}

export function fail(code: string, message: string) {
  return {
    content: [text(`${code}: ${message}`)],
    isError: true,
    structuredContent: { code, message },
  };
}

export async function wrap(fn: () => Promise<{ summary: string; data: object }>) {
  try {
    const { summary, data } = await fn();
    return ok(summary, data);
  } catch (err) {
    if (err instanceof DomainError) return fail(err.code, err.message);
    return fail("internal", err instanceof Error ? err.message : String(err));
  }
}
