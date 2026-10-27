import { describe, expect, it } from "vitest";
import { sectorSlug } from "../../src/domain/sectors.js";

describe("sectorSlug (Stage 5.6 B9)", () => {
  it("lower-cases and dashes non-alphanumerics", () => {
    expect(sectorSlug("Skincare")).toBe("skincare");
    expect(sectorSlug("Home & Garden UK")).toBe("home-garden-uk");
    expect(sectorSlug("  Pet  Care!! ")).toBe("pet-care");
    expect(sectorSlug("")).toBe("sector");
  });
});
