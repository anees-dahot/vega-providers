import { ProviderContext } from "../types";

export const DEFAULT_BASE = "https://flixbaba.org.uk";
export const IMG = "https://image.tmdb.org/t/p/";

export async function getBase(
  providerContext: ProviderContext,
): Promise<string> {
  const override = await providerContext.kvStore?.get<string>("baseUrlOverride");
  return (override || DEFAULT_BASE).trim().replace(/\/+$/, "");
}

// The site proxies TMDB at /api/tmdb, so no API key is needed.
export async function tmdb(
  providerContext: ProviderContext,
  path: string,
  params: Record<string, string | number> = {},
  signal?: AbortSignal,
): Promise<any> {
  const { axios, commonHeaders } = providerContext;
  const base = await getBase(providerContext);
  const query = new URLSearchParams({ language: "en-US" });
  Object.entries(params).forEach(([k, v]) => query.set(k, String(v)));
  const sep = path.includes("?") ? "&" : "?";
  const res = await axios.get(`${base}/api/tmdb${path}${sep}${query}`, {
    signal,
    headers: { ...commonHeaders, Referer: `${base}/` },
  });
  return res.data;
}

export function img(path: string | null | undefined, size = "w500"): string {
  return path ? `${IMG}${size}${path}` : "";
}

// Post links look like ".../details/movie/550" or ".../details/tv/1399".
export function parseLink(link: string): { type: "movie" | "tv"; id: string } {
  const m = link.match(/(movie|tv)\/(\d+)/);
  if (!m) throw new Error(`Unrecognised Flixbaba link: ${link}`);
  return { type: m[1] as "movie" | "tv", id: m[2] };
}
