import { ProviderContext } from "../types";

export const DEFAULT_BASE = "https://www.miruro.tv";

export async function getBase(providerContext: ProviderContext): Promise<string> {
  const override = await providerContext.kvStore?.get<string>("baseUrlOverride");
  return (override || DEFAULT_BASE).trim().replace(/\/+$/, "");
}

const KEY = new TextEncoder().encode("miruro/catalog");

// API bodies are gzip, XORed with "miruro/catalog" (application/octet-stream).
async function decode(bytes: Uint8Array): Promise<any> {
  const data = bytes.slice();
  for (let i = 0; i < data.length; i++) data[i] ^= KEY[i % KEY.length];
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

export async function api(
  providerContext: ProviderContext,
  path: string,
  signal?: AbortSignal,
): Promise<any> {
  const base = await getBase(providerContext);
  const res = await providerContext.axios.get(`${base}/api/v1/${path}`, {
    signal,
    timeout: 20000,
    responseType: "arraybuffer",
    headers: { ...providerContext.commonHeaders, Referer: `${base}/` },
    validateStatus: () => true,
  });
  const bytes = new Uint8Array(res.data as ArrayBuffer);
  const type = String(res.headers?.["content-type"] || "");
  if (res.status >= 400) {
    let detail = "";
    try {
      detail = JSON.parse(new TextDecoder().decode(bytes))?.detail || "";
    } catch {
      // not JSON
    }
    throw new Error(`Miruro API ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return type.includes("octet-stream")
    ? decode(bytes)
    : JSON.parse(new TextDecoder().decode(bytes));
}

export const titleOf = (m: any): string =>
  m?.title?.english || m?.title?.romaji || m?.title?.native || "";
