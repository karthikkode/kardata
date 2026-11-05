function monthIndex(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) return null;
  const [year, month] = value.split("-").map(Number);
  return year! * 12 + month! - 1;
}

/** Labels describe the actual release interval; stable measure keys remain unchanged. */
export function growthWindows(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const windows = input as Record<string, unknown>;
  const current = monthIndex(windows.current);
  const prior1 = monthIndex(windows.prior1);
  const prior3 = monthIndex(windows.prior3);
  if (current === null || prior1 === null || prior3 === null || prior3 >= prior1 || prior1 >= current) return null;
  const describe = (from: unknown, index: number) => ({
    from: String(from), to: String(windows.current), months: current - index,
    label: `${current - index} months (${String(from)} to ${String(windows.current)})`,
  });
  return { prior1: describe(windows.prior1, prior1), prior3: describe(windows.prior3, prior3) };
}

export function growthMeasureLabels(windows: ReturnType<typeof growthWindows>) {
  if (!windows) return {};
  return Object.fromEntries(["clients", "accounts", "staff", "advisory_staff", "aum"].flatMap(name => {
    const label = name === "aum" ? "AUM" : name === "advisory_staff" ? "Advisory staff" : name[0]!.toUpperCase() + name.slice(1);
    return [[`${name}_growth_1y_pct`, `${label} growth over ${windows.prior1.label}`],
      [`${name}_growth_3y_pct`, `${label} growth over ${windows.prior3.label}`]];
  }));
}
