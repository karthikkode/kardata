// Internal links and anchors in a built site. `files` maps "blog/x/index.html" to its HTML.
const SITE = "https://kardata.co";

export function idsIn(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}

export function linksIn(html) {
  const attrs = [...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  // <meta content> only counts when it is one of our URLs (og:image, og:url).
  const metas = [...html.matchAll(/\scontent="(https:\/\/kardata\.co[^"]*)"/g)].map((m) => m[1]);
  return [...attrs, ...metas];
}

/** Map a link to the dist file it should hit, or null when it isn't ours. */
export function targetOf(link, fromFile) {
  let url = link;
  if (url.startsWith(SITE)) url = url.slice(SITE.length) || "/";
  if (url.startsWith("#")) return { file: fromFile, hash: url.slice(1) };
  if (!url.startsWith("/") || url.startsWith("//")) return null;
  const [pathAndQuery, hash = ""] = url.split("#");
  let path = pathAndQuery.split("?")[0];
  path = decodeURIComponent(path).replace(/^\//, "");
  if (path === "" || path.endsWith("/")) path += "index.html";
  return { file: path, hash: decodeURIComponent(hash) };
}

export function checkLinks(files, exists) {
  const problems = [];
  for (const [file, html] of Object.entries(files)) {
    for (const link of linksIn(html)) {
      const t = targetOf(link, file);
      if (!t) continue;
      if (!exists(t.file)) {
        problems.push(`${file}: broken link ${link}`);
        continue;
      }
      if (t.hash && files[t.file] && !idsIn(files[t.file]).has(t.hash)) {
        problems.push(`${file}: missing anchor ${link}`);
      }
    }
  }
  return problems;
}
