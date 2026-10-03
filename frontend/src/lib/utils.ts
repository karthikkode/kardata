import { createCn } from "cn/config"

// Single configured class merger for the app: the default tables do not
// know our @theme font sizes, so a bare `cn` misfiles `text-ui` as a text
// color and silently drops real colors merged after it (e.g. Button sm lost
// `text-primary-foreground`, rendering dark text on the indigo fill).
// Import { cn } from '@/lib/utils' everywhere; never from 'cn' directly.
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["2xs", "ui", "md", "display"] }] } },
})
