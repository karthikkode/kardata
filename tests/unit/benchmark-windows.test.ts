import { expect, it } from "vitest";
import { growthMeasureLabels, growthWindows } from "../../src/domain/benchmark/windows.js";

it("labels the actual release gap while preserving nominal growth keys", () => {
  const windows = growthWindows({ current: "2026-11", prior1: "2025-12", prior2: "2024-11", prior3: "2023-11" });
  expect(windows).toEqual({
    prior1: { from: "2025-12", to: "2026-11", months: 11, label: "11 months (2025-12 to 2026-11)" },
    prior3: { from: "2023-11", to: "2026-11", months: 36, label: "36 months (2023-11 to 2026-11)" },
  });
  expect(growthMeasureLabels(windows)).toMatchObject({
    clients_growth_1y_pct: "Clients growth over 11 months (2025-12 to 2026-11)",
    aum_growth_3y_pct: "AUM growth over 36 months (2023-11 to 2026-11)",
  });
  expect(growthWindows({ current: "2026-01", prior1: "2025-12", prior3: "2023-01" })?.prior1.months).toBe(1);
});

it.each([undefined, {}, { current: "2026-13", prior1: "2025-12", prior3: "2023-11" },
  { current: "2026-11", prior1: "2026-11", prior3: "2023-11" },
  { current: "2026-11", prior1: "2025-12", prior3: "2026-01" }])("does not invent a label for invalid or unavailable metadata: %j", input => {
  const windows = growthWindows(input);
  expect(windows).toBeNull();
  expect(growthMeasureLabels(windows)).toEqual({});
});
