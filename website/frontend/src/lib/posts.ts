export interface PostLike {
  id: string;
  body?: string;
  data: { date: Date; draft: boolean };
}

/** Published posts newest first. Drafts only when asked (dev server). */
export function selectPosts<T extends PostLike>(posts: T[], includeDrafts: boolean): T[] {
  return posts
    .filter((p) => includeDrafts || !p.data.draft)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export function readingMinutes(body = ""): number {
  const words = body.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
