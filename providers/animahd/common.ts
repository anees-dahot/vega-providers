import { ProviderContext } from "../types";

export const DEFAULT_BASE = "https://animahd.com";

export async function getBase(
  providerContext: ProviderContext,
): Promise<string> {
  const override = await providerContext.kvStore?.get<string>("baseUrlOverride");
  return (override || DEFAULT_BASE).trim().replace(/\/+$/, "");
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#0?38;|&amp;/g, "&")
    .replace(/&#8217;|&#8216;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");
}

// "Bleach: Thousand-Year Blood War S1-S3 [Hindi-Eng-Jap] Triple Audio [Complete]"
// → { title: "Bleach: Thousand-Year Blood War", audio: "Hindi-Eng-Jap" }
export function cleanTitle(raw: string): { title: string; audio: string } {
  const text = decodeEntities(raw).replace(/\s+/g, " ").trim();
  const audio =
    text.match(/\[([^\]]*(?:Hindi|Eng|Jap|Tamil|Telugu)[^\]]*)\]/i)?.[1] || "";
  const title = text
    .replace(
      /\s*(?:\bS\d+(?:-S\d+)?\b|Season\s*\d+|Seasons|\[|(?:Multi|Dual|Triple) Audio|BluRay|Episodes?\b).*$/i,
      "",
    )
    .trim();
  return { title: title || text, audio };
}

// The player hosts only answer requests that look like an embed on the site.
export function embedHeaders(
  providerContext: ProviderContext,
  referer: string,
): Record<string, string> {
  return {
    ...providerContext.commonHeaders,
    Referer: referer,
    "Sec-Fetch-Dest": "iframe",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
  };
}
