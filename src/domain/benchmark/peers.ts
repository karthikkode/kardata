import { z } from "zod";
import { MEASURES, type FeeMeasure, type FeeRanges, type Measure, type MeasureValues } from "./measures.js";

export const peerConfig = z.object({
  aumBandStarts: z.array(z.number().finite().nonnegative()).min(2).refine(
    starts => starts[0] === 0 && starts.every((start, i) => i === 0 || start > starts[i - 1]!), "AUM starts must increase from zero"),
  individualShareMin: z.number().gt(0).lte(1),
  institutionalShareMax: z.number().gte(0).lt(1),
  soloStaffMax: z.number().int().nonnegative(),
  minimumGroupSize: z.number().int().min(2),
}).refine(config => config.institutionalShareMax < config.individualShareMin, "mix thresholds must be distinct");

export type PeerConfig = z.infer<typeof peerConfig>;
type PeerFirm = { id: string; staff: number | null; aum: number | null; values: MeasureValues; feeRanges?: FeeRanges };
type PeerGroup = { mix: string; bands: number[]; members: PeerFirm[] };

function bandFor(aum: number, config: PeerConfig) {
  return config.aumBandStarts.findLastIndex(start => aum >= start);
}

export function groupPeers(firms: PeerFirm[], config: PeerConfig) {
  const lanes = new Map<string, Map<number, PeerGroup>>();
  for (const firm of firms) {
    const solo = firm.staff !== null && firm.staff <= config.soloStaffMax;
    const share = firm.values.individual_aum_share_pct;
    if (!solo && (firm.staff === null || firm.aum === null || share === null)) continue;
    const mix = solo ? "solo" : share! >= config.individualShareMin * 100 ? "mostly_individual" :
      share! <= config.institutionalShareMax * 100 ? "mostly_institutional" : "mixed";
    const band = solo ? -1 : bandFor(firm.aum!, config);
    const lane = lanes.get(mix) ?? new Map<number, PeerGroup>();
    lanes.set(mix, lane);
    const group = lane.get(band) ?? { mix, bands: [band], members: [] };
    group.members.push(firm);
    lane.set(band, group);
  }
  const groups: PeerGroup[] = [];
  for (const lane of lanes.values()) {
    const sorted = [...lane.values()].sort((a, b) => a.bands[0]! - b.bands[0]!);
    for (let i = 0; i < sorted.length && sorted.length > 1;) {
      const group = sorted[i]!;
      if (group.members.length >= config.minimumGroupSize) { i++; continue; }
      const left = sorted[i - 1];
      const right = sorted[i + 1];
      const leftDistance = left ? group.bands[0]! - left.bands.at(-1)! : Infinity;
      const rightDistance = right ? right.bands[0]! - group.bands.at(-1)! : Infinity;
      const first = leftDistance <= rightDistance ? i - 1 : i;
      const a = sorted[first]!;
      const b = sorted[first + 1]!;
      sorted.splice(first, 2, { mix: group.mix, bands: [...a.bands, ...b.bands], members: [...a.members, ...b.members] });
      i = first;
    }
    groups.push(...sorted);
  }
  return groups;
}

function quantile(sorted: number[], p: number) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * p;
  const lo = Math.floor(position);
  const hi = Math.ceil(position);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (position - lo);
}

function rangePercentile(sorted: number[], value: number) {
  const boundary = (inclusive: boolean) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid]! < value || (inclusive && sorted[mid] === value)) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return (boundary(false) + boundary(true)) / (2 * sorted.length) * 100;
}

export function peerStatistics(firms: PeerFirm[], config: PeerConfig) {
  const groups = groupPeers(firms, config);
  const memberGroups = new Map<string, { key: string; size: number; percentiles: Partial<Record<Measure, number>>;
    feeRangePercentiles: FeeRanges }>();
  const summaries = [];
  for (const group of groups) {
    const key = group.mix === "solo" ? "solo" : `${group.mix}:${group.bands.join("+")}`;
    const size = group.members.length;
    const comparisonAvailable = size >= config.minimumGroupSize;
    for (const firm of group.members) memberGroups.set(firm.id, { key, size, percentiles: {}, feeRangePercentiles: {} });
    for (const measure of MEASURES) {
      const values = group.members.flatMap(firm => {
        const value = firm.values[measure];
        return value === null ? [] : [{ id: firm.id, value }];
      }).sort((a, b) => a.value - b.value);
      const sorted = values.map(row => row.value);
      summaries.push({
        key, measure, size, n: sorted.length, mix: group.mix, bandIndices: group.bands.filter(index => index >= 0),
        q1: comparisonAvailable ? quantile(sorted, 0.25) : null, median: comparisonAvailable ? quantile(sorted, 0.5) : null,
        q3: comparisonAvailable ? quantile(sorted, 0.75) : null, comparisonAvailable,
      });
      if (!comparisonAvailable || !sorted.length) continue;
      if (measure.startsWith("fee_")) {
        const feeMeasure = measure as FeeMeasure;
        for (const firm of group.members) {
          const range = firm.feeRanges?.[feeMeasure];
          if (range) memberGroups.get(firm.id)!.feeRangePercentiles[feeMeasure] = {
            low: rangePercentile(sorted, range.low), high: rangePercentile(sorted, range.high),
          };
        }
      }
      for (let first = 0; first < values.length;) {
        let end = first + 1;
        while (end < values.length && values[end]!.value === values[first]!.value) end++;
        const midpoint = ((first + end) / 2) / values.length * 100;
        for (const row of values.slice(first, end)) memberGroups.get(row.id)!.percentiles[measure] = midpoint;
        first = end;
      }
    }
  }
  return { summaries, memberGroups };
}
