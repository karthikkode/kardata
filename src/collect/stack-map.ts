// Tool → signal map for the stack collector. Each `match` is a lowercase
// substring tested against Apollo technology strings and homepage script URLs.

export type StackGroup =
  | "subscriptions"
  | "loyalty"
  | "email_sms"
  | "ad_pixels"
  | "affiliate"
  | "support"
  | "bnpl"
  | "wholesale";

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
      { match: "tiktok pixel", name: "TikTok pixel", channels: ["tiktok"] },
      { match: "analytics.tiktok.com", name: "TikTok pixel", channels: ["tiktok"] },
      { match: "google ads", name: "Google Ads", channels: ["google"] },
      { match: "googletagmanager", name: "Google tag", channels: ["google"] },
      { match: "googleadservices", name: "Google Ads", channels: ["google"] },
      { match: "pinterest", name: "Pinterest tag", channels: ["pinterest"] },
      { match: "ct.pinterest.com", name: "Pinterest tag", channels: ["pinterest"] },
      { match: "snap pixel", name: "Snap pixel", channels: ["snap"] },
      { match: "sc-static.net", name: "Snap pixel", channels: ["snap"] },
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
    ],
  },
  {
    group: "wholesale",
    label: "Wholesale",
    area: "business_model",
    tools: [{ match: "faire", name: "Faire" }],
  },
];
