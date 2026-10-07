import { ProviderContext } from "../types";

export const DEFAULT_BASE = "https://aniwatchtv.ro";

export async function getBase(
  providerContext: ProviderContext,
): Promise<string> {
  const override = await providerContext.kvStore?.get<string>("baseUrlOverride");
  return (override || DEFAULT_BASE).trim().replace(/\/+$/, "");
}

export const restUrl = (base: string) => `${base}/wp-json/v1/otakuthemes`;

export function decodeEntities(text: string): string {
  return text
    .replace(/&#0?38;|&amp;/g, "&")
    .replace(/&#8217;|&#8216;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export async function getHtml(
  providerContext: ProviderContext,
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  const { axios, commonHeaders } = providerContext;
  const res = await axios.get(url, { signal, headers: commonHeaders });
  return String(res.data);
}

export async function getJson(
  providerContext: ProviderContext,
  url: string,
  signal?: AbortSignal,
): Promise<any> {
  const { axios, commonHeaders } = providerContext;
  const res = await axios.get(url, {
    signal,
    headers: { ...commonHeaders, Accept: "application/json" },
  });
  return res.data;
}
