/** Exclude obvious legal entities and extraction fragments; this is not identity verification. */
export function isContactName(name: string): boolean {
  if (name.replace(/[^\p{L}]/gu, "").length < 3) return false;
  // A role label or isolated first-name/table fragment is not a full contact
  // name. Keep the original record so partial information remains available.
  const words = name.match(/\p{L}+/gu) ?? [];
  if (words.length < 2 || !words.some((word) => word.length > 1) || /[&\d]/.test(name)) return false;
  if (/\b[a-z0-9-]+\.(?:com|net|org|ai|io|co|biz|edu|gov)\b/i.test(name)) return false;
  const roleWords = new Set(["chief", "executive", "officer", "founder", "owner", "partner", "president", "director", "manager", "managing", "member", "principal", "sponsor", "representative", "corporate", "senior", "vice", "operations", "operating", "financial", "compliance", "investment", "portfolio", "ceo", "coo", "cco", "cfo", "cio", "svp", "of", "and", "the", "i", "de", "fe"]);
  if (words.every((word) => roleWords.has(word.toLowerCase()))) return false;
  // Ownership tables include organizations even when a legal suffix is absent
  // or truncated. Keep those ownership records, but don't present them as people.
  const organization = /\b(?:holdings?|llc|inc|corp|ltd|incorporated|corporation|limited|partnership|trust|company|bank|banking|foundation|university|associates|advis[eo]rs?|management|capital|partners|financial|wealth|group|fund|services|investments?|planning|enterprises?|revocable|irrevocable)\b/i;
  const legalSuffix = /\b(?:l\.?\s*l\.?\s*c|l\.?\s*l\.?\s*p|l\.?\s*p|p\.?\s*l\.?\s*c)\.?(?:\s+(?:DE|FE))?\s*,?$/i;
  return !organization.test(name) && !legalSuffix.test(name.trim());
}
