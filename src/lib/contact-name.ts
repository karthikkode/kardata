/** Exclude obvious legal entities and extraction fragments; this is not identity verification. */
export function isContactName(name: string): boolean {
  if (name.replace(/[^\p{L}]/gu, "").length < 3) return false;
  return !/\b(?:holdings?|llc|incorporated|corporation|limited|partnership|trust|company)\b|\b(?:l\.?\s*l\.?\s*c|l\.?\s*l\.?\s*p|inc|corp|ltd)\.?$/i.test(name.trim());
}
