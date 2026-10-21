/** Types for the pure parser half of harness/reviews.mjs (browser main excluded). */
export const SUPPORTED_VENDORS: string[];
export const MORE_SELECTORS: Record<string, string[]>;

export interface ParsedReview {
  text: string;
  title?: string;
  rating?: number;
  rating_scale?: number;
  date?: string;
  verified_buyer?: boolean;
}

export function detectVendor(html: string): { vendor: string | null; signals: string[] };
export function parseWidgetReviews(html: string, vendor: string): ParsedReview[];
export function parseAccessibleReviewCards(html: string): ParsedReview[];
export function parseJsonLdReviews(html: string): ParsedReview[];
export function parseJsonLdAggregateCount(html: string): number | null;
export function parseDisplayedTotal(html: string, vendor: string | null): number | null;
export function findNextPageNumber(html: string, selectors: string[]): { current: number; next: number } | null;
export function collectPageReviews(html: string): {
  vendor: string | null;
  signals: string[];
  reviews: ParsedReview[];
  displayedTotal: number | null;
};
