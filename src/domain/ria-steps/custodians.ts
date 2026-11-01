// Share the same stored-list interpretation between signals and exports. Prose is never counted.
export function custodianCountNames(raw: { valueText: string | null; valueJson: unknown } | undefined | null, extra: string[]): string[] {
  const names: string[] = [...extra];
  if (raw) {
    if (Array.isArray(raw.valueJson)) names.push(...raw.valueJson.filter((x): x is string => typeof x === "string"));
    const text = typeof raw.valueText === "string" ? raw.valueText.trim() : "";
    if (text.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(text.replace(/'/g, '"'));
        if (Array.isArray(parsed)) names.push(...parsed.filter((x): x is string => typeof x === "string"));
      } catch {
        // Not a JSON list: prose, not counted.
      }
    }
  }
  const seen = new Map<string, string>();
  for (const n of names) {
    const clean = n.replace(/^["'\[]+|["'\]]+$/g, "").trim();
    if (clean.length < 2) continue;
    seen.set(clean.toLowerCase(), clean);
  }
  return [...seen.values()];
}

