import { expect, it } from "vitest";
import { sourceFetchPolicy } from "../../src/domain/research/source-fetch-policy.js";
it("uses the SEC contact agent only for the official hosts", () => {
  expect(sourceFetchPolicy("https://www.sec.gov/orders/example.pdf")).toEqual({ userAgent: "Kardata karthik@kardata.co" });
  expect(sourceFetchPolicy("https://sec.gov/example")).toEqual({ userAgent: "Kardata karthik@kardata.co" });
  expect(sourceFetchPolicy("https://sec.gov.example.com/example")).toEqual({});
  expect(sourceFetchPolicy("https://example.com/?site=sec.gov")).toEqual({});
});
