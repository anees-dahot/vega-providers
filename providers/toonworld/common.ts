import { ProviderContext } from "../types";

export const DEFAULT_BASE = "https://toonworld4all.me";

export async function getBase(
  providerContext: ProviderContext,
): Promise<string> {
  const override = await providerContext.kvStore?.get<string>("baseUrlOverride");
  return (override || DEFAULT_BASE).trim().replace(/\/+$/, "");
}

export async function getHtml(
  providerContext: ProviderContext,
  url: string,
  signal?: AbortSignal,
  referer?: string,
): Promise<string> {
  const { axios, commonHeaders } = providerContext;
  const res = await axios.get(url, {
    signal,
    headers: { ...commonHeaders, ...(referer ? { Referer: referer } : {}) },
  });
  return String(res.data);
}

// The archive and redirect pages ship their data as `window.__PROPS__ = {…}`.
export function parseProps(html: string): any {
  const m = html.match(
    /window\.__PROPS__\s*=\s*(\{[\s\S]*?\});?\s*(?:window\.|<\/script>)/,
  );
  if (!m) throw new Error("Page had no embedded data");
  return JSON.parse(m[1]);
}

// "Black Torch Season 1 Multi Audio [Hindi-Eng-Jap] 480p, 720p & 1080p …"
// → { title: "Black Torch Season 1", audio: "Hindi-Eng-Jap" }
export function cleanTitle(raw: string): { title: string; audio: string } {
  const text = raw
    .replace(/&#0?38;|&amp;/g, "&")
    .replace(/&#8217;|&#8216;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const audio = text.match(/\[([^\]]*(?:Hindi|Eng|Jap|Tamil|Telugu)[^\]]*)\]/i)?.[1] || "";
  const title = text
    .replace(/\s*(?:Multi Audio|Dual Audio|BluRay|WEB-DL|\[|\d{3,4}p\b|Episodes?\b|Hindi\b).*$/i, "")
    .trim();
  return { title: title || text, audio };
}
