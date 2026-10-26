// One place for the site's settings. Pages read from here.

export const SITE = {
  name: "kardata",
  url: "https://kardata.co",
  description:
    "I audit a D2C brand's own data to find where time and money leak between its systems.",
  email: "karthik@kardata.co",
  linkedin: "https://www.linkedin.com/in/sai-karthik-804833154",
};

// Booking: Cal.com (owner's choice, 2026-10-27; free plan). `calLink` is the URL path after cal.com/.
export const BOOKING = {
  url: "https://cal.com/karthik-kardata-iaygkj/30min",
  calLink: "karthik-kardata-iaygkj/30min",
  minutes: 20,
};

// Analytics tool: the owner chooses (plan, "Analytics tool"). Empty means no script is loaded.
export const ANALYTICS = {
  provider: "" as "" | "plausible" | "umami",
  domain: "kardata.co",
};

export const NAV = [
  { href: "/audit/", label: "The audit" },
  { href: "/blog/", label: "Blog" },
  { href: "/about/", label: "About" },
];
