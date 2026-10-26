import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getPosts } from "../lib/collection";
import { SITE } from "../config";

export async function GET(context: APIContext) {
  const posts = await getPosts();
  return rss({
    title: `${SITE.name} blog`,
    description: "One sourced piece a week for D2C brand owners.",
    site: context.site ?? SITE.url,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.summary,
      pubDate: p.data.date,
      link: `/blog/${p.id}/`,
    })),
  });
}
