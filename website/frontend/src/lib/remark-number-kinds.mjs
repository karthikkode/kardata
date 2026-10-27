// Turns {study}, {claim}, {vendor} and {estimate} in post text into a small label (D-45).
// Any other {word} fails the build, so a typo can't ship as raw text.

export const KINDS = {
  study: "study",
  claim: "company claim",
  vendor: "vendor data",
  estimate: "estimate",
};

const TOKEN = /\{([a-z][a-z-]*)\}/g;

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function splitText(value, where = "post") {
  const out = [];
  let last = 0;
  for (const m of value.matchAll(TOKEN)) {
    const kind = m[1];
    if (!(kind in KINDS)) {
      throw new Error(
        `Unknown number kind {${kind}} in ${where}. Use one of: ${Object.keys(KINDS).map((k) => `{${k}}`).join(", ")}`,
      );
    }
    if (m.index > last) out.push({ type: "text", value: value.slice(last, m.index) });
    out.push({
      type: "html",
      value: `<span class="kind kind-${kind}">${escapeHtml(KINDS[kind])}</span>`,
    });
    last = m.index + m[0].length;
  }
  if (out.length === 0) return null;
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function walk(node, where) {
  if (!node.children) return;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child.type === "text") {
      const parts = splitText(child.value, where);
      if (parts) {
        node.children.splice(i, 1, ...parts);
        i += parts.length - 1;
      }
    } else if (child.type !== "code" && child.type !== "inlineCode") {
      walk(child, where);
    }
  }
}

export default function remarkNumberKinds() {
  return (tree, file) => walk(tree, file?.path ?? "post");
}
