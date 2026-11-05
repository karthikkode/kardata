/** A site alias is only the exact host or its single www/bare spelling. */
export function sameSiteRedirect(from: URL, to: URL): boolean {
  if (to.username || to.password || !["http:", "https:"].includes(to.protocol)) return false;
  const host = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, "");
  return host(from) === host(to) && from.port === to.port &&
    (from.protocol === to.protocol || (from.protocol === "http:" && to.protocol === "https:"));
}
