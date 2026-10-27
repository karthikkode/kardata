import { describe, expect, it } from "vitest";
import { readingMinutes, selectPosts } from "../src/lib/posts";

const post = (id: string, date: string, draft = false) => ({ id, data: { date: new Date(date), draft } });

describe("selectPosts", () => {
  const posts = [post("old", "2026-10-01"), post("draft", "2026-11-01", true), post("new", "2026-10-20")];

  it("drops drafts for the production build and sorts newest first", () => {
    expect(selectPosts(posts, false).map((p) => p.id)).toEqual(["new", "old"]);
  });

  it("keeps drafts for the dev server", () => {
    expect(selectPosts(posts, true).map((p) => p.id)).toEqual(["draft", "new", "old"]);
  });
});

describe("readingMinutes", () => {
  it("is at least one minute", () => {
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes("word ".repeat(1150))).toBe(5);
  });
});
