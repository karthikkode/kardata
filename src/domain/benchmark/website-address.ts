export const FILED_WEBSITE_KEY = "firm.filed_corporate_website";
export const FILED_WEBSITE_COLLECTOR = "sec_adv_website_promote";
export const FILED_WEBSITE_VERSION = "schedule-website-v1";
export const websiteHost = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, "");

/** Match a printed website, including spaced dots, but never infer one from an email. */
export function coverWebsiteQuote(text: string, host: string): string | null {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\./g, "\\s*\\.\\s*");
  const pattern = new RegExp(`(?<![@\\w.-])(?:https?://)?(?:www\\s*\\.\\s*)?${escaped}(?![\\w.-])`, "ig");
  for (const match of text.matchAll(pattern)) {
    if (!text.slice(0, match.index).trimEnd().endsWith("@")) return match[0];
  }
  return null;
}
