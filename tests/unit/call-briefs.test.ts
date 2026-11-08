import { expect, it } from "vitest";
import { CALL_OPENER, CALL_PITCH, groundBrief, backupLine, renderBrief, validateCallScript, type BriefResponse, type CitedFact, type Evidence } from "../../src/domain/call-briefs/brief.js";
import { changePercent, confirmedBrochureEvidence, filedServices, firmBrochureCover, publicLinks, registrationAge } from "../../src/domain/call-briefs/evidence.js";

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

it("uses the exact fixed opener/pitch and a separately cited backup", () => {
  const rendered = renderBrief({ companyId: "synthetic", name: "Synthetic firm", order: 2, callDate: "2026-11-09",
    owner: null, baseFacts, evidence, response, gaps: [] });
  expect(rendered.markdown).toContain(CALL_OPENER);
  expect(CALL_OPENER).toBe("Hi [name], Karthik from Kardata. This is a cold call. Can I take 20 seconds to tell you why, and then you can decide?");
  expect(CALL_PITCH).toBe("(if yes) I help solo advisers cut the office work. Things like: forms the custodian sends back, typing up meeting notes, quarterly billing. Any of those take up much of your time?");
  expect(rendered.markdown).toContain(CALL_PITCH);
  expect(backupLine(response)).toBe('If none of the three: "What about checking account lists? Does that take much of your time?"');
  expect(() => validateCallScript(rendered.markdown.replace("20 seconds", "a minute"), null)).toThrow("fixed call script");
  for (const claim of ["I talk to advisers", "Most advisers I've spoken with agree", "Most advisers I’ve spoken with agree"]) {
    expect(() => validateCallScript(`${rendered.markdown}\n${claim}`, null)).toThrow("prior conversations");
  }
  expect(rendered.markdown).toContain("owner not found");
  expect(rendered.markdown).toContain("custodian: not found");
  expect(rendered.markdown).toContain("client count not found");
  expect(rendered.markdown).not.toContain("[1][1]");
  expect(rendered.markdown).toContain("**Guess:** May need separate account checks [1]");
  expect(rendered.markdown).toContain("read 2026-11-08");
  expect(rendered.markdown).toContain("<details>");
  expect(rendered.markdown).not.toContain("Fixed price, a week or two");
  expect(rendered.topGuess).toContain("Guess:");
  expect(rendered.sourceCount).toBe(1);
});

it("rejects ungrounded facts, invented references, asserted problems and guesses without conditional wording", () => {
  expect(groundBrief(response, evidence, baseFacts).facts[0]?.id).toBe("detail-1");
  expect(() => groundBrief({ ...response, facts: [{ ...response.facts[0], quote: "Not present in the source" }] }, evidence, baseFacts)).toThrow("quote not found");
  expect(() => groundBrief({ ...response, tasks: [{ text: "invented task", factIds: ["unknown"] }, response.tasks[1]] }, evidence, baseFacts)).toThrow("unknown supporting fact");
  expect(() => groundBrief({ ...response, guesses: [{ text: "They waste time", factIds: ["accounts"] }] }, evidence, baseFacts)).toThrow("every guess");
  expect(() => groundBrief({ ...response, facts: [{ ...response.facts[0], text: "They waste time" }] }, evidence, baseFacts)).toThrow("cannot be a firm fact");
  expect(() => groundBrief({ ...response, facts: [{ ...response.facts[0], text: "2% annual fee" }] }, evidence, baseFacts)).toThrow("number not supported");
});

it("assigns IDs and rewrites references for formerly invalid aliases and collisions without weakening evidence checks", () => {
  const raw = { ...response, facts: [
    { ...response.facts[0]!, id: "services / planning" },
    { ...response.facts[0]!, id: "accounts" },
    { ...response.facts[0]!, id: "accounts", text: "flat fee", quote: "charge a flat fee" },
  ], tasks: [{ text: "gathering plan documents", factIds: ["services / planning"] },
    { text: "reviewing plan fees", factIds: ["accounts"] }] };
  const grounded = groundBrief(raw, evidence, baseFacts);
  expect(grounded.facts.map(f => f.id)).toEqual(["detail-1", "detail-2", "detail-3"]);
  expect(grounded.tasks.map(t => t.factIds)).toEqual([["detail-1"], ["detail-2", "detail-3"]]);
  expect(baseFacts[0]?.text).toBe("100 accounts");
  expect(raw.facts[0]?.id).toBe("services / planning");
  expect(() => groundBrief({ ...raw, facts: [{ ...raw.facts[1], quote: "invented" }] }, evidence, baseFacts)).toThrow("quote not found");
  expect(() => groundBrief({ ...raw, facts: [{ ...raw.facts[1], text: "5% fee" }] }, evidence, baseFacts)).toThrow("number not supported");
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
  expect(firmBrochureCover("Form ADV Part 3: Relationship Summary. See our Form ADV Part 2A Firm Brochure for details.")).toBe(false);
  const crs: Evidence = { ...evidence[0]!, id: "crs", kind: "brochure", page: 1,
    text: "Form ADV Part 3: Relationship Summary. See our Form ADV Part 2A Firm Brochure." };
  expect(confirmedBrochureEvidence([crs])).toEqual({ evidence: [], brochureFound: false, dropped: true });
});

it("labels checked SEC services explicitly without inferring services from fee types", () => {
  expect(filedServices({ "5G(1)": "Y", "5G(2)": "Y", "5G(6)": "N", "5G(7)": "" })).toEqual([
    { field: "5G(1)", value: "Y", label: "financial planning" }, { field: "5G(2)", value: "Y", label: "individual/small-business portfolios" },
  ]);
});
