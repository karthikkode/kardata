import { apolloProfileCollector } from "./apollo-profile.js";
import { companiesHouseCollector } from "./companies-house.js";
import { feedsCollector } from "./feeds.js";
import { jobsCollector } from "./jobs.js";
import { newsCollector } from "./news.js";
import { reviewsCollector } from "./reviews.js";
import { reviewsOnsiteCollector } from "./reviews-onsite.js";
import { secCollector } from "./sec.js";
import { shopifyCollector } from "./shopify.js";
import { siteCollector } from "./site.js";
import { stackCollector } from "./stack.js";
import type { Collector } from "./types.js";
import { waybackCollector } from "./wayback.js";

// Collectors run in this order; a later one may read an earlier one's sources
// via ctx.shared.
export const COLLECTORS: Collector[] = [
  siteCollector,
  shopifyCollector,
  jobsCollector,
  reviewsCollector,
  reviewsOnsiteCollector,
  stackCollector,
  feedsCollector,
  newsCollector,
  secCollector,
  waybackCollector,
  companiesHouseCollector,
  apolloProfileCollector,
];
