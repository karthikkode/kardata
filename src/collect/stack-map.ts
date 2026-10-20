// Tool → signal map for the stack collector. Each `match` is a lowercase
// substring tested against Apollo technology strings and homepage script URLs.
// Coverage: every marketing/commerce Apollo name with ≥10 companies in the
// dev census is either matched here or listed in IGNORED_TECHNOLOGIES.

export type StackGroup =
  | "subscriptions"
  | "loyalty"
  | "email_sms"
  | "ad_pixels"
  | "affiliate"
  | "support"
  | "bnpl"
  | "wholesale"
  | "attribution"
  | "review_apps"
  | "upsell"
  | "marketplace";

export interface StackTool {
  match: string;
  name: string;
  // Marketing channels this tool evidences (for marketing.channel_active).
  channels?: string[];
}

export interface StackSignal {
  group: StackGroup;
  label: string;
  area: "marketing" | "business_model";
  tools: StackTool[];
}

// Apollo display names that must never match, checked as exact lowercased
// technology lines before matching. Bare "Facebook" variants are social
// plugins, not ad spend; "Google AdSense" contains the "google ads" needle;
// "Bing Webmaster Tools" (SEO) contains the "bing" needle.
export const IGNORED_TECHNOLOGIES: ReadonlySet<string> = new Set([
  "facebook",
  "facebook login",
  "facebook sdk",
  "facebook like button",
  "facebook groups",
  "facebook social plugins",
  "google adsense",
  "bing webmaster tools",
]);

export const STACK_MAP: StackSignal[] = [
  {
    group: "subscriptions",
    label: "Subscriptions",
    area: "business_model",
    tools: [
      { match: "recharge", name: "ReCharge" },
      { match: "skio", name: "Skio" },
      { match: "stay.ai", name: "Stay.ai" },
      { match: "stayai", name: "Stay.ai" },
      { match: "ordergroove", name: "Ordergroove" },
      { match: "smartrr", name: "Smartrr" },
      { match: "seal subscriptions", name: "Seal Subscriptions" },
      { match: "bold commerce", name: "Bold Commerce" },
    ],
  },
  {
    group: "loyalty",
    label: "Loyalty",
    area: "business_model",
    tools: [
      { match: "smile.io", name: "Smile.io", channels: ["loyalty"] },
      { match: "loyaltylion", name: "LoyaltyLion", channels: ["loyalty"] },
      { match: "yotpo loyalty", name: "Yotpo Loyalty", channels: ["loyalty"] },
      { match: "stamped loyalty", name: "Stamped Loyalty", channels: ["loyalty"] },
      { match: "rise.ai", name: "Rise.ai", channels: ["loyalty"] },
      { match: "riseai", name: "Rise.ai", channels: ["loyalty"] },
      { match: "swell rewards", name: "Swell Rewards", channels: ["loyalty"] },
    ],
  },
  {
    group: "email_sms",
    label: "Email / SMS",
    area: "marketing",
    tools: [
      { match: "klaviyo", name: "Klaviyo", channels: ["email", "sms"] },
      { match: "attentive", name: "Attentive", channels: ["sms"] },
      { match: "postscript", name: "Postscript", channels: ["sms"] },
      { match: "omnisend", name: "Omnisend", channels: ["email", "sms"] },
      { match: "mailchimp", name: "Mailchimp", channels: ["email"] },
      { match: "smsbump", name: "SMSBump", channels: ["sms"] },
      { match: "sendgrid", name: "SendGrid", channels: ["email"] },
      { match: "mailgun", name: "Mailgun", channels: ["email"] },
      { match: "amazon ses", name: "Amazon SES", channels: ["email"] },
      { match: "amazon simple email service", name: "Amazon SES", channels: ["email"] },
      { match: "mailchannels", name: "MailChannels", channels: ["email"] },
      { match: "elasticemail", name: "ElasticEmail", channels: ["email"] },
      { match: "mailjet", name: "Mailjet", channels: ["email"] },
      { match: "smtp2go", name: "smtp2go", channels: ["email"] },
      { match: "postmark", name: "Postmark", channels: ["email"] },
      { match: "constant contact", name: "Constant Contact", channels: ["email"] },
      { match: "brevo", name: "Brevo", channels: ["email"] },
      { match: "dotdigital", name: "Dotdigital", channels: ["email"] },
      { match: "mailerlite", name: "MailerLite", channels: ["email"] },
      { match: "mailshake", name: "Mailshake", channels: ["email"] },
      { match: "campaignmonitor", name: "Campaign Monitor", channels: ["email"] },
      { match: "listrak", name: "Listrak", channels: ["email"] },
      { match: "active campaign", name: "ActiveCampaign", channels: ["email"] },
      { match: "flodesk", name: "Flodesk", channels: ["email"] },
      { match: "privy", name: "Privy", channels: ["email"] },
      { match: "hubspot", name: "HubSpot", channels: ["email"] },
      { match: "wunderkind", name: "Wunderkind", channels: ["email"] },
    ],
  },
  {
    group: "ad_pixels",
    label: "Ad pixels",
    area: "marketing",
    tools: [
      { match: "facebook pixel", name: "Meta pixel", channels: ["meta"] },
      { match: "fbevents", name: "Meta pixel", channels: ["meta"] },
      { match: "connect.facebook.net", name: "Meta pixel", channels: ["meta"] },
      { match: "meta audience network", name: "Meta Audience Network", channels: ["meta"] },
      { match: "tiktok pixel", name: "TikTok pixel", channels: ["tiktok"] },
      { match: "analytics.tiktok.com", name: "TikTok pixel", channels: ["tiktok"] },
      { match: "tiktok", name: "TikTok pixel", channels: ["tiktok"] },
      { match: "google ads", name: "Google Ads", channels: ["google"] },
      { match: "googletagmanager", name: "Google tag", channels: ["google"] },
      { match: "googleadservices", name: "Google Ads", channels: ["google"] },
      { match: "doubleclick", name: "DoubleClick", channels: ["google"] },
      { match: "google remarketing", name: "Google Remarketing", channels: ["google"] },
      { match: "google ad manager", name: "Google Ad Manager", channels: ["google"] },
      { match: "google publisher tag", name: "Google Publisher Tag", channels: ["google"] },
      { match: "google marketing platform", name: "Google Marketing Platform", channels: ["google"] },
      { match: "dv360", name: "DV360", channels: ["google"] },
      { match: "pinterest", name: "Pinterest tag", channels: ["pinterest"] },
      { match: "ct.pinterest.com", name: "Pinterest tag", channels: ["pinterest"] },
      { match: "snap pixel", name: "Snap pixel", channels: ["snap"] },
      { match: "sc-static.net", name: "Snap pixel", channels: ["snap"] },
      // Bare "snap" also matches SnapWidget-style names; no such Apollo name
      // reaches 10 companies, so the false-positive surface is tiny.
      { match: "snap", name: "Snap pixel", channels: ["snap"] },
      { match: "bing", name: "Microsoft Ads", channels: ["microsoft ads"] },
      { match: "microsoft advertising", name: "Microsoft Ads", channels: ["microsoft ads"] },
      { match: "linkedin ads", name: "LinkedIn ads", channels: ["linkedin"] },
      { match: "linkedin insight tag", name: "LinkedIn Insight Tag", channels: ["linkedin"] },
      { match: "linkedin marketing solutions", name: "LinkedIn Marketing Solutions", channels: ["linkedin"] },
      { match: "licdn", name: "LinkedIn Insight Tag", channels: ["linkedin"] },
      { match: "twitter ads", name: "Twitter ads", channels: ["twitter"] },
      { match: "ads-twitter", name: "Twitter ads", channels: ["twitter"] },
      { match: "youtube advertising", name: "YouTube ads", channels: ["youtube"] },
      { match: "amazon advertising", name: "Amazon ads", channels: ["amazon"] },
      { match: "amazon ams", name: "Amazon ads", channels: ["amazon"] },
      { match: "reddit", name: "Reddit", channels: ["reddit"] },
      { match: "adroll", name: "AdRoll", channels: ["adroll"] },
      { match: "criteo", name: "Criteo", channels: ["criteo"] },
      { match: "taboola", name: "Taboola", channels: ["taboola"] },
      { match: "outbrain", name: "Outbrain", channels: ["outbrain"] },
      { match: "the trade desk", name: "The Trade Desk", channels: ["the trade desk"] },
      { match: "xandr", name: "Xandr", channels: ["xandr"] },
      { match: "24-7 media", name: "24-7 Media", channels: ["24-7 media"] },
      { match: "stackadapt", name: "StackAdapt", channels: ["stackadapt"] },
      { match: "simpli.fi", name: "Simpli.fi", channels: ["simpli.fi"] },
      { match: "triplelift", name: "TripleLift", channels: ["triplelift"] },
      { match: "media.net", name: "Media.net", channels: ["media.net"] },
      { match: "content.ad", name: "Content.ad", channels: ["content.ad"] },
      { match: "open adstream", name: "Open AdStream", channels: ["open adstream"] },
      { match: "adobe advertising cloud", name: "Adobe Advertising Cloud", channels: ["adobe"] },
      { match: "wider planet", name: "Wider Planet", channels: ["wider planet"] },
      { match: "quantcast", name: "Quantcast", channels: ["quantcast"] },
      { match: "tapad", name: "Tapad", channels: ["tapad"] },
      { match: "pixelyoursite", name: "PixelYourSite" },
      { match: "adnabu", name: "AdNabu" },
    ],
  },
  {
    group: "affiliate",
    label: "Affiliate / creator",
    area: "marketing",
    tools: [
      { match: "impact.com", name: "Impact", channels: ["affiliate"] },
      { match: "impact radius", name: "Impact", channels: ["affiliate"] },
      { match: "refersion", name: "Refersion", channels: ["affiliate"] },
      { match: "grin", name: "Grin", channels: ["creator"] },
      { match: "aspire", name: "Aspire", channels: ["creator"] },
      { match: "gocollab", name: "GoCollab", channels: ["creator"] },
      { match: "shareasale", name: "ShareASale", channels: ["affiliate"] },
      { match: "awin", name: "Awin", channels: ["affiliate"] },
      { match: "skimlinks", name: "SkimLinks", channels: ["affiliate"] },
      { match: "linkshare", name: "LinkShare", channels: ["affiliate"] },
      { match: "avantlink", name: "AvantLink", channels: ["affiliate"] },
      { match: "everflow", name: "Everflow", channels: ["affiliate"] },
      { match: "amazon associates", name: "Amazon Associates", channels: ["affiliate"] },
      { match: "curebit", name: "Curebit", channels: ["referral"] },
      { match: "referralcandy", name: "ReferralCandy", channels: ["referral"] },
      { match: "friendbuy", name: "Friendbuy", channels: ["referral"] },
      { match: "addshoppers", name: "AddShoppers", channels: ["referral"] },
      { match: "foursixty", name: "Foursixty", channels: ["creator"] },
      { match: "curalate", name: "Curalate", channels: ["creator"] },
      { match: "moast", name: "Moast", channels: ["creator"] },
      { match: "tolstoy", name: "Tolstoy", channels: ["creator"] },
    ],
  },
  {
    group: "support",
    label: "Support",
    area: "business_model",
    tools: [
      { match: "gorgias", name: "Gorgias" },
      { match: "zendesk", name: "Zendesk" },
      { match: "intercom", name: "Intercom" },
      { match: "tidio", name: "Tidio" },
      { match: "helpscout", name: "Help Scout" },
      { match: "reamaze", name: "Reamaze" },
      { match: "livechat", name: "LiveChat" },
    ],
  },
  {
    group: "bnpl",
    label: "Buy now, pay later",
    area: "business_model",
    tools: [
      { match: "afterpay", name: "Afterpay" },
      { match: "klarna", name: "Klarna" },
      { match: "affirm", name: "Affirm" },
      { match: "shop pay installments", name: "Shop Pay Installments" },
      { match: "sezzle", name: "Sezzle" },
    ],
  },
  {
    group: "wholesale",
    label: "Wholesale",
    area: "business_model",
    tools: [
      { match: "faire", name: "Faire" },
      { match: "stockist", name: "Stockist" },
      { match: "storeify", name: "Storeify" },
    ],
  },
  {
    group: "attribution",
    label: "Attribution",
    area: "marketing",
    tools: [
      { match: "triple whale", name: "Triple Whale" },
      { match: "northbeam", name: "Northbeam" },
      { match: "black crow", name: "Black Crow" },
    ],
  },
  {
    group: "review_apps",
    label: "Review apps",
    area: "marketing",
    tools: [
      { match: "yotpo", name: "Yotpo" },
      { match: "judge.me", name: "Judge.me" },
      { match: "shopify product reviews", name: "Shopify Product Reviews" },
      { match: "trustpilot", name: "Trustpilot" },
      { match: "stamped", name: "Stamped" },
      { match: "loox", name: "Loox" },
      { match: "reviews.io", name: "Reviews.io" },
      { match: "junip", name: "Junip" },
      { match: "bazaarvoice", name: "Bazaarvoice" },
      { match: "powerreviews", name: "PowerReviews" },
      { match: "google customer reviews", name: "Google Customer Reviews" },
      { match: "reviews.co.uk", name: "Reviews.co.uk" },
      { match: "podium", name: "Podium" },
    ],
  },
  {
    group: "upsell",
    label: "Upsell",
    area: "business_model",
    tools: [
      { match: "rebuy", name: "Rebuy" },
      { match: "bogos", name: "BOGOS" },
      { match: "upsellit", name: "Upsellit" },
      { match: "optimonk", name: "OptiMonk" },
      { match: "nosto", name: "Nosto" },
    ],
  },
  {
    group: "marketplace",
    label: "Marketplace",
    area: "business_model",
    tools: [
      { match: "amazon pay", name: "Amazon Pay" },
      { match: "walmart", name: "Walmart" },
      { match: "ebay", name: "eBay" },
      { match: "buy with prime", name: "Buy with Prime" },
      { match: "helium 10", name: "Helium 10" },
    ],
  },
];
