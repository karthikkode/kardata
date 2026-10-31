import { describe, expect, it } from "vitest";
import { pickFirmWebsite } from "../../src/domain/ria-steps/handlers.js";


describe("pickFirmWebsite (B3)", () => {
  it("drops social URLs and lower-cases the firm's own site", () => {
    expect(pickFirmWebsite("https://www.linkedin.com/company/acme")).toBeNull();
    expect(pickFirmWebsite("HTTPS://ACME-Wealth.COM/about")).toBe("https://www.acme-wealth.com");
    expect(pickFirmWebsite(null)).toBeNull();
  });
});

