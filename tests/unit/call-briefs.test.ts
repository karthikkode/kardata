import { expect, it } from "vitest";
import { CALL_OPENER, groundBrief, reasonLine, renderBrief, type BriefResponse, type CitedFact, type Evidence } from "../../src/domain/call-briefs/brief.js";
import { changePercent, filedServices, firmBrochureCover, publicLinks, registrationAge } from "../../src/domain/call-briefs/evidence.js";

const evidence: Evidence[] = [{ id: "web", sourceId: "source", url: "https://example.test/services", date: "2026-11-08", dateKind: "read",
  kind: "website", text: "We provide financial planning and charge a flat fee." }];
const baseFacts: CitedFact[] = [{ id: "accounts", label: "size", text: "100 accounts", evidenceId: "web", quote: "100 accounts" }];
const response: BriefResponse = {
  facts: [{ id: "x1", label: "services", text: "financial planning", evidenceId: "web", quote: "We provide financial planning" }],
  tasks: [{ text: "checking account lists", factIds: ["accounts"] }, { text: "organising planning documents", factIds: ["x1"] }],
  guesses: [{ text: "May need separate account checks", factIds: ["accounts"] }],
  questions: ["How did the last account update reach your records?", "How did the last plan's documents reach you?", "Which step took the time?"].map(text => ({ text, factIds: ["accounts"] })),
  avoid: [],
};

it("uses the owner's exact new opener and reason shape, with no retired pitch", () => {
  const rendered = renderBrief({ companyId: "synthetic", name: "Synthetic firm", order: 2, callDate: "2026-11-09",
    owner: null, baseFacts, evidence, response, gaps: [] });
  expect(rendered.markdown).toContain(CALL_OPENER);
  expect(reasonLine(response)).toBe("Most solo advisers I talk to lose hours a week on checking account lists or organising planning documents. Which one takes most of your time?");
  expect(rendered.markdown).toContain("owner not found");
  expect(rendered.markdown).toContain("custodian: not found");
  expect(rendered.markdown).toContain("**Guess:** May need separate account checks [1]");
  expect(rendered.markdown).toContain("read 2026-11-08");
  expect(rendered.markdown).toContain("<details>");
  expect(rendered.markdown).not.toContain("Fixed price, a week or two");
  expect(rendered.topGuess).toContain("Guess:");
  expect(rendered.sourceCount).toBe(1);
});

it("rejects ungrounded facts, invented references, asserted problems and guesses without conditional wording", () => {
  expect(groundBrief(response, evidence, baseFacts)).toEqual(response);
  expect(() => groundBrief({ ...response, facts: [{ ...response.facts[0], quote: "Not present in the source" }] }, evidence, baseFacts)).toThrow("quote not found");
  expect(() => groundBrief({ ...response, tasks: [{ text: "invented task", factIds: ["unknown"] }, response.tasks[1]] }, evidence, baseFacts)).toThrow("unknown supporting fact");
  expect(() => groundBrief({ ...response, guesses: [{ text: "They waste time", factIds: ["accounts"] }] }, evidence, baseFacts)).toThrow("every guess");
  expect(() => groundBrief({ ...response, facts: [{ ...response.facts[0], text: "They waste time" }] }, evidence, baseFacts)).toThrow("cannot be a firm fact");
  expect(() => groundBrief({ ...response, facts: [{ ...response.facts[0], text: "2% annual fee" }] }, evidence, baseFacts)).toThrow("number not supported");
});

it("accepts descriptive fact IDs while retaining collision and citation checks", () => {
  const descriptive = { ...response, facts: [{ ...response.facts[0]!, id: "services-planning" }],
    tasks: [response.tasks[0]!, { ...response.tasks[1]!, factIds: ["services-planning"] }] };
  expect(groundBrief(descriptive, evidence, baseFacts).facts[0]?.id).toBe("services-planning");
  expect(() => groundBrief({ ...descriptive, facts: [{ ...descriptive.facts[0]!, id: "accounts" }] }, evidence, baseFacts)).toThrow("duplicate brief fact ID");
});

it("computes snapshot changes without inventing percentages from zero, and registration tenure at call date", () => {
  expect(changePercent(65, 251)).toBe("+286.2%");
  expect(changePercent(0, 251)).toBeNull();
  expect(changePercent(100, 50)).toBe("-50.0%");
  expect(registrationAge("2025-09-25", "2026-11-09")).toBe("1y 1m at call date");
  expect(registrationAge("2027-01-01", "2026-11-09")).toBe("duration not found");
});

it("prioritises brochure/services pages while excluding social and login links", () => {
  const links = publicLinks(`<a href="/services">Services</a><a href="/adv.pdf">Form ADV</a>
    <a href="/login">Login</a><a href="https://linkedin.com/firm">About us</a><a href="https://other.test/services">Services</a>`, "https://example.test/");
  expect(links.map(l => l.url)).toEqual(["https://example.test/adv.pdf", "https://example.test/services"]);
});

it("does not treat a personnel supplement's reference to Part 2A as a firm brochure", () => {
  expect(firmBrochureCover("Form ADV Part 2B Brochure Supplement. This accompanies the Form ADV Part 2A.")).toBe(false);
  expect(firmBrochureCover("Wrap Fee Program Brochure Form ADV Part 2A Appendix 1")).toBe(false);
  expect(firmBrochureCover("Form ADV Part 2A Firm Brochure")).toBe(true);
});

it("labels checked SEC services explicitly without inferring services from fee types", () => {
  expect(filedServices({ "5G(1)": "Y", "5G(2)": "Y", "5G(6)": "N", "5G(7)": "" })).toEqual([
    { field: "5G(1)", value: "Y", label: "financial planning" }, { field: "5G(2)", value: "Y", label: "individual/small-business portfolios" },
  ]);
});
