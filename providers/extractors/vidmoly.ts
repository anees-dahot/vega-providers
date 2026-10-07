import { ProviderContext, Stream } from "../types";

/** Vidmoly embed → direct HLS master playlist (the embed names it in `file:`). */
export async function vidmolyExtractor(
  providerContext: ProviderContext,
  embedUrl: string,
  referer: string,
  signal?: AbortSignal,
): Promise<Stream | null> {
  const { axios, commonHeaders } = providerContext;
  const res = await axios.get(embedUrl, {
    signal,
    timeout: 15000,
    headers: { ...commonHeaders, Referer: referer },
  });
  const html = String(res.data);
  const master =
    html.match(/file:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/)?.[1] ||
    html.match(/https?:\/\/[^'"\s\\]+\.m3u8[^'"\s\\]*/)?.[0];
  if (!master) return null;
  const origin = embedUrl.match(/^https?:\/\/[^/]+/)?.[0] || "";
  return {
    server: "Vidmoly",
    link: master,
    type: "m3u8",
    headers: { Referer: `${origin}/` },
  };
}
