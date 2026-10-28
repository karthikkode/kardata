import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Company, ResearchRun } from "../../src/db/schema.js";
import { DomainError } from "../../src/domain/errors.js";
import type { PromptContext } from "../../src/runs/agent-runner.js";
import {
  assertPromptVersion,
  availablePromptVersions,
  buildPreflightPrompt,
  buildResearchPrompt,
  buildStagePrompt,
  latestPromptVersion,
  preflightAdapterList,
  PROMPT_AREAS,
  resolvePromptVersion,
} from "../../src/runs/prompt.js";

function ctx(overrides: {
  company?: Partial<Company>;
  run?: Partial<ResearchRun>;
  brief?: string;
}): PromptContext {
  const runId = randomUUID();
  const companyId = randomUUID();
  return {
    run: {
      id: runId,
      companyId,
      kind: "agent",
      status: "running",
      createdBy: "owner",
      requestedAreas: null,
      requestedAdapters: null,
      batchId: null,
      jobId: null,
      companyJobId: null,
      stage: null,
      error: null,
      promptVersion: "v1.6",
      agentPhase: "researching",
      agentOptions: null,
      agentSessionId: null,
      agentContainerId: null,
      agentExitCode: null,
      agentUsage: null,
      agentFinalMessage: null,
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
      lastActivityAt: new Date(),
      requestCount: 0,
      ...overrides.run,
    },
    company: {
      id: companyId,
      apolloAccountId: null,
      source: "apollo",
      domain: "example.com",
      sharedDomain: false,
      name: "Example Co",
      website: "https://example.com",
      linkedinUrl: null,
      facebookUrl: null,
      twitterUrl: null,
      employees: 42,
      industry: "Skincare",
      keywords: [],
      technologies: ["Shopify", "Klaviyo"],
      country: "USA",
      state: null,
      city: null,
      postalCode: null,
      address: null,
      phone: null,
      annualRevenue: "$1M",
      totalFunding: "$2M",
      latestFunding: null,
      latestFundingAmount: null,
      lastRaisedAt: null,
      foundedYear: 2019,
      shortDescription: null,
      logoUrl: null,
      sicCodes: [],
      naicsCodes: [],
      notes: null,
      raw: {},
      overrides: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides.company,
    },
    brief: overrides.brief,
    sectorProfile: null,
  };
}

describe("buildResearchPrompt", () => {
  it("renders the run, company and Apollo facts with the brief", () => {
    const context = ctx({ brief: "Focus on pricing." });
    const prompt = buildResearchPrompt(context);
    expect(prompt).toContain(context.run.id);
    expect(prompt).toContain(context.company.id);
    expect(prompt).toContain("Example Co");
    expect(prompt).toContain("example.com");
    expect(prompt).toContain("USA");
    expect(prompt).toContain("42");
    expect(prompt).toContain("revenue $1M");
    expect(prompt).toContain("founded 2019");
    expect(prompt).toContain("Shopify");
    expect(prompt).toContain("Focus on pricing.");
    expect(prompt).not.toContain("{{");
  });

  it("omits the brief section and truncates long technology lists", () => {
    const techs = Array.from({ length: 40 }, (_, i) => `tech${i}`);
    const prompt = buildResearchPrompt(ctx({ company: { technologies: techs } }));
    expect(prompt).not.toContain("Owner brief");
    expect(prompt).toContain("tech29");
    expect(prompt).not.toContain("tech30");
    expect(prompt).toContain("(+10 more)");
  });

  it("refuses pre-versioning runs (null version)", () => {
    expect(() => buildResearchPrompt(ctx({ run: { promptVersion: null } }))).toThrowError(/pre-versioning run; cannot re-render/);
  });

  it("lists v1 through v1.7 with v1.7 latest", () => {
    expect(availablePromptVersions()).toEqual(["v1", "v1.1", "v1.2", "v1.3", "v1.4", "v1.5", "v1.6", "v1.7"]);
    expect(latestPromptVersion()).toBe("v1.7");
    expect(resolvePromptVersion()).toBe("v1.7");
    expect(() => resolvePromptVersion("v0")).toThrowError(/unknown prompt version/);
  });

  it("rejects bad or unknown versions", () => {
    for (const bad of ["bogus", "1", "v", "v1;rm"]) {
      expect(() => assertPromptVersion(bad)).toThrowError(DomainError);
    }
    expect(() => assertPromptVersion("v9")).toThrowError(/unknown prompt version/);
    expect(() => buildResearchPrompt(ctx({ run: { promptVersion: "v9" } }))).toThrowError(DomainError);
  });

  it("renders v1 with all seven briefs and substituted values", () => {
    const context = ctx({ run: { promptVersion: "v1" }, brief: "Watch pricing." });
    const prompt = buildResearchPrompt(context);
    expect(prompt).toContain("## Flow");
    expect(prompt).toContain("### 1. Orient");
    for (const area of PROMPT_AREAS) {
      expect(prompt, area).toContain(`### ${area}`);
    }
    expect(prompt).toContain("5–15 findings");
    expect(prompt).toContain("summary.md");
    expect(prompt).toContain("only one subagent at a time uses the browser");
    expect(prompt).toContain("Watch pricing.");
    expect(prompt).toContain("Example Co");
    expect(prompt).toContain("example.com");
    expect(prompt).not.toContain("{{");
  });

  it("renders v1.1 with the stall fixes", () => {
    const prompt = buildResearchPrompt(ctx({ run: { promptVersion: "v1.1" } }));
    for (const area of PROMPT_AREAS) {
      expect(prompt, area).toContain(`### ${area}`);
    }
    expect(prompt).toContain("never the Workflow tool");
    expect(prompt).toContain("Do NOT call these");
    expect(prompt).toContain("bank progress continuously");
    expect(prompt).toContain("MUST ingest up to 300");
    expect(prompt).not.toContain("{{");
  });

  it("renders v1.2 as depth-plus-citations with no structuring", () => {
    const prompt = buildResearchPrompt(ctx({ run: { promptVersion: "v1.2" } }));
    for (const area of PROMPT_AREAS) {
      expect(prompt, area).toContain(`### ${area}`);
    }
    expect(prompt).toContain("depth and citations, not structuring");
    expect(prompt).toContain("[src:<uuid>]");
    expect(prompt).toContain("At least 3 sources per area");
    expect(prompt).toContain("No reviewer names or initials");
    expect(prompt).toContain("never the Workflow tool");
    expect(prompt).toContain("summary.md");
    expect(prompt).toContain("fact_add, record_upsert, reviews_ingest, finding_add");
    expect(prompt).not.toContain("MUST ingest up to 300");
    expect(prompt).not.toContain("{{");
  });

  it("renders v1.3 with verbatim-capture and no-test-data rules", () => {
    const prompt = buildResearchPrompt(ctx({ run: { promptVersion: "v1.3" } }));
    for (const area of PROMPT_AREAS) {
      expect(prompt, area).toContain(`### ${area}`);
    }
    expect(prompt).toContain("Capture verbatim excerpts, never summaries");
    expect(prompt).toContain("relied-upon passages");
    expect(prompt).toContain("Never write test or probe data to kardata");
    expect(prompt).toContain("depth and citations, not structuring");
    expect(prompt).not.toContain("{{");
  });

  it("renders v1.5 with plausibility, citation and decisions rules", () => {
    const prompt = buildResearchPrompt(ctx({ run: { promptVersion: "v1.5" } }));
    expect(prompt).toContain("Revenue plausibility");
    expect(prompt).toContain("disputed");
    expect(prompt).toContain("Citations are source IDs, never URLs");
    expect(prompt).toContain("exact company name in quotes, without the domain anchor");
    expect(prompt).not.toContain("{{");
  });

  it("renders v1.4 with the fetch-order rule", () => {
    const prompt = buildResearchPrompt(ctx({ run: { promptVersion: "v1.4" } }));
    expect(prompt).toContain("Fetch order per URL: source_fetch FIRST, always");
    expect(prompt).toContain("ONLY if it returns blocked");
    expect(prompt).toContain("never web_fetch a robots_disallowed URL at all");
    expect(prompt).toContain("Evidence grades");
    expect(prompt).not.toContain("{{");
  });
});

describe("preflight prompt", () => {
  it("renders recon instructions with the company facts and every adapter id", () => {
    const prompt = buildPreflightPrompt(ctx({}));
    expect(prompt).toContain("Preflight recon for Example Co");
    expect(prompt).toContain("example.com");
    expect(prompt).toContain("preflight_report_save");
    expect(prompt).toContain("Recon ONLY");
    for (const line of preflightAdapterList()) {
      expect(prompt).toContain(line.split(" ")[0] as string);
    }
    expect(prompt).not.toContain("{{");
  });

  it("lists exactly the registered collectors", () => {
    const ids = preflightAdapterList().map((line) => line.split(" ")[0]);
    expect(ids).toContain("reviews_onsite");
    expect(ids).toContain("sec_form_d");
    expect(ids.length).toBeGreaterThanOrEqual(12);
  });

  it("routes preflight runs to recon and everything else to research", () => {
    expect(buildStagePrompt(ctx({ run: { stage: "preflight", promptVersion: "v1.3" } }))).toContain("Preflight recon");
    expect(buildStagePrompt(ctx({ run: { stage: "research", promptVersion: "v1.3" } }))).toContain("### reviews");
    expect(buildStagePrompt(ctx({ run: { stage: null, promptVersion: "v1.3" } }))).toContain("### reviews");
  });
});

describe("research-v1.6 sector hints", () => {
  it("fills sector.* placeholders from the profile, else the neutral fallback", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { parseSectorProfile } = await import("../../src/domain/sector-preflight/profile.js");
    const profile = parseSectorProfile(
      JSON.parse(readFileSync(resolve("tests/fixtures/sector-profile.json"), "utf8")),
    );
    const withProfile = buildResearchPrompt({
      ...ctx({ run: { promptVersion: "v1.6" } }),
      sectorProfile: profile,
    });
    expect(withProfile).toContain("example big-box stores and marketplaces");
    expect(withProfile).toContain("entry, mid, premium");
    expect(withProfile).toContain("durable, repairable, two-year warranty");
    expect(withProfile).toContain("built-to-last story");
    expect(withProfile).not.toContain("{{");
    const without = buildResearchPrompt(ctx({ run: { promptVersion: "v1.6" } }));
    expect(without).toContain("none listed for this sector");
    expect(without).not.toContain("{{");
  });
});

describe("research-v1.7 rules", () => {
  it("asks for data-team searches, events as stated and the last sign of life", () => {
    const prompt = buildResearchPrompt(ctx({ run: { promptVersion: "v1.7" } }));
    expect(prompt).toContain("Data and tech team");
    expect(prompt).toContain("never open LinkedIn");
    expect(prompt).toContain("exactly as the source states it");
    expect(prompt).toContain("Last sign of life");
  });
});
