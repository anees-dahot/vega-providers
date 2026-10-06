import { ProviderContext } from "../types";

export const DEFAULT_BASE = "https://toonstream.us";

export async function getBase(
  providerContext: ProviderContext,
): Promise<string> {
  const override = await providerContext.kvStore?.get<string>("baseUrlOverride");
  return (override || DEFAULT_BASE).trim().replace(/\/+$/, "");
}

export function absolute(base: string, href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("//")) return `https:${href}`;
  return `${base}${href.startsWith("/") ? "" : "/"}${href}`;
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
