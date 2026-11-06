import { expect, it } from "vitest";
import { redirectRepairEligible, transientWebsiteRetryEligible } from "../../src/domain/benchmark/website-retry.js";

const redirect = { status: "error", httpStatus: null, error: "redirect outside the allowed site or path" };
const unavailable = { status: "error", httpStatus: null, error: "robots.txt unavailable" };
it("recognizes both legacy page redirects and unavailable robots backed by the exact redirect error", () => {
  expect(redirectRepairEligible([redirect])).toBe(true);
  expect(redirectRepairEligible([unavailable, redirect])).toBe(true);
  expect(redirectRepairEligible([unavailable])).toBe(false);
  expect(redirectRepairEligible([{ ...redirect, error: "fetch failed" }])).toBe(false);
});
it.each([401, 403, 406, 418, 500, 503, 599])("never repairs a stored HTTP %s result", httpStatus => {
  expect(redirectRepairEligible([redirect, { ...unavailable, httpStatus }])).toBe(false);
});
it.each([
  { status: "blocked", httpStatus: 200, error: null },
  { status: "robots_disallowed", httpStatus: null, error: null },
  { status: "error", httpStatus: null, error: "redirect disallowed by robots.txt" },
  { status: "error", httpStatus: null, error: "timeout after 15000ms" },
])("does not retry challenges, robots exclusions or competing failures: %j", blocked => {
  expect(redirectRepairEligible([redirect, blocked])).toBe(false);
});

const fetchError = { status: "fetch_error", clientStatus: null };
it.each(["timeout after 15000ms", "fetch failed"])("retries an ordinary page failure: %s", error => {
  expect(transientWebsiteRetryEligible(fetchError, [{ status: "error", httpStatus: null, error, url: "https://fixture.example/" }])).toBe(true);
});
it.each(["fetch failed", "too many redirects (over 5)"])("never retries the known failed robots cause: %s", error => {
  expect(transientWebsiteRetryEligible(fetchError, [{ status: "error", httpStatus: null, error, url: "https://fixture.example/robots.txt" }])).toBe(false);
});
it.each([401, 403, 406, 418, 500, 503, 599])("never treats HTTP %s as a transient retry", httpStatus => {
  expect(transientWebsiteRetryEligible(fetchError, [{ status: "error", httpStatus, error: null }])).toBe(false);
});
it("retains challenge/robots blocks and keeps the redirect repair separate from ordinary retries", () => {
  for (const row of [unavailable, redirect, { status: "robots_disallowed", httpStatus: null, error: null },
    { status: "blocked", httpStatus: 200, error: null }]) expect(transientWebsiteRetryEligible(fetchError, [row])).toBe(false);
  expect(transientWebsiteRetryEligible({ status: "found", clientStatus: "fetch_error" }, [{ status: "error", httpStatus: null, error: "timeout" }])).toBe(true);
  expect(transientWebsiteRetryEligible({ status: "none_found", clientStatus: null }, [])).toBe(false);
});
