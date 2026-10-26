import { SITE } from "../config";

export interface SeoInput {
  title?: string;
  description?: string;
  path: string;
  image?: string;
  type?: "website" | "article";
  publishedTime?: Date;
}

export interface Seo {
  title: string;
  description: string;
  canonical: string;
  image: string;
  type: "website" | "article";
  publishedTime?: string;
}

const DEFAULT_IMAGE = "/og-default.png";

export function buildSeo(input: SeoInput): Seo {
  const canonical = new URL(input.path, SITE.url).toString();
  return {
    title: input.title ? `${input.title} | ${SITE.name}` : SITE.name,
    description: input.description ?? SITE.description,
    canonical,
    image: new URL(input.image ?? DEFAULT_IMAGE, SITE.url).toString(),
    type: input.type ?? "website",
    publishedTime: input.publishedTime?.toISOString(),
  };
}
