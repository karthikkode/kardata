import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Files starting with "_" (the template) are not posts.
const posts = defineCollection({
  loader: glob({ pattern: "**/[^_]*.md", base: "./src/content/posts" }),
  schema: z
    .object({
      title: z.string().min(1),
      date: z.coerce.date(),
      summary: z.string().min(1).max(200),
      synthetic: z.boolean().default(false),
      draft: z.boolean().default(false),
      image: z.string().startsWith("/").optional(),
      imageAlt: z.string().min(1).optional(),
    })
    .refine((d) => !d.image || d.imageAlt, { message: "image needs imageAlt", path: ["imageAlt"] }),
});

export const collections = { posts };
