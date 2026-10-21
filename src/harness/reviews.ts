/**
 * On-site reviews jobs (Stage 4.1 Step 2): one `kardata-agent` container per
 * collect runs the baked-in Chromium scraper (`harness/reviews.mjs`, no LLM)
 * over the company's own product pages and prints JSON to stdout.
 *
 * Invariants (asserted in tests/harness/reviews.test.ts):
 * - no secret env, no MCP, no Muse volume (the job needs no model);
 * - the job input travels over stdin, never a mount or the network;
 * - the only stdout contract is the validated ReviewsJobOutput below.
 */
import { spawn } from "node:child_process";
import { z } from "zod";
import { AGENTS_NETWORK, AGENT_IMAGE } from "./setup.js";
import { CONTAINER_CPUS, CONTAINER_MEMORY, CONTAINER_PIDS_LIMIT, RUN_LABEL } from "./docker.js";

export const REVIEWS_JOB_MAX_PAGES = 10;
export const REVIEWS_JOB_MAX_REVIEWS = 300;
export const REVIEWS_JOB_TIMEOUT_MS = 600_000;

export interface ReviewsJobPage {
  url: string;
  product: string;
}

export interface ReviewsJobInput {
  runId: string;
  pages: ReviewsJobPage[];
  maxReviews: number;
}

const jobReview = z.object({
  text: z.string(),
  title: z.string().optional(),
  rating: z.number().optional(),
  rating_scale: z.number().optional(),
  date: z.string().optional(),
  product: z.string().optional(),
  verified_buyer: z.boolean().optional(),
  url: z.string().optional(),
});

const jobPage = z.object({
  url: z.string(),
  product: z.string(),
  vendor: z.string().nullable(),
  status: z.string(),
  reason: z.string().optional(),
  reviewCount: z.number(),
  displayedTotal: z.number().nullable().optional(),
});

export const reviewsJobOutput = z.object({
  pages: z.array(jobPage),
  reviews: z.array(jobReview),
});

export type ReviewsJobOutput = z.infer<typeof reviewsJobOutput>;
export type ReviewsJobReview = z.infer<typeof jobReview>;

export function reviewsContainerName(runId: string): string {
  const safe = runId.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 60);
  if (safe === "") throw new Error("runId has no usable characters for a container name");
  return `kardata-reviews-${safe}`;
}

/** Exact `docker run` argv for one reviews job. Refuses an empty page list. */
export function reviewsJobArgs(runId: string, pages: ReviewsJobPage[]): string[] {
  if (pages.length === 0) throw new Error("reviews jobs need at least one page");
  return [
    "run",
    "--rm",
    "-i",
    "--name",
    reviewsContainerName(runId),
    "--label",
    `${RUN_LABEL}=${runId}`,
    "--memory",
    CONTAINER_MEMORY,
    "--cpus",
    CONTAINER_CPUS,
    "--pids-limit",
    CONTAINER_PIDS_LIMIT,
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--tmpfs",
    "/workspace",
    "--network",
    AGENTS_NETWORK,
    "-e",
    "HOME=/tmp",
    "-e",
    "LANG=C.UTF-8",
    AGENT_IMAGE,
    "reviews",
  ];
}

export type ReviewsJobRunner = (input: ReviewsJobInput) => Promise<ReviewsJobOutput>;

/** Run the job in a container; stdin carries the input, stdout the output. */
export const dockerReviewsJob: ReviewsJobRunner = async (input) => {
  const child = spawn("docker", reviewsJobArgs(input.runId, input.pages), {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout = `${stdout}${chunk.toString("utf8")}`.slice(-2_000_000);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000);
  });
  child.stdin?.write(JSON.stringify({ pages: input.pages, maxReviews: input.maxReviews }));
  child.stdin?.end();
  const exitCode = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, REVIEWS_JOB_TIMEOUT_MS);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(-1);
    });
  });
  if (exitCode === null) throw new Error("reviews job timed out");
  if (exitCode !== 0) {
    const detail = stderr.trim() === "" ? "no stderr" : stderr.trim().split("\n").slice(-3).join(" | ");
    throw new Error(`reviews job exited ${exitCode}: ${detail}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    throw new Error(`reviews job returned invalid JSON: ${stdout.slice(-200)}`);
  }
  const output = reviewsJobOutput.safeParse(parsed);
  if (!output.success) throw new Error(`reviews job returned malformed output: ${output.error.message}`);
  return output.data;
};
