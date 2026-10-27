import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import remarkNumberKinds from "./src/lib/remark-number-kinds.mjs";

export default defineConfig({
  site: "https://kardata.co",
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [sitemap()],
  markdown: {
    remarkPlugins: [remarkNumberKinds],
    // Footnotes are the post's sources list.
    remarkRehype: {
      footnoteLabel: "Sources",
      footnoteLabelTagName: "h2",
      footnoteLabelProperties: { className: ["sources-title"] },
      footnoteBackLabel: "Back to the text",
    },
  },
});
