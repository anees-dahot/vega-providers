import { Stream, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";

const VIX = "https://vixsrc.to";

// Flixbaba only iframes third-party players; VixSrc is the one that yields a
// plain HLS playlist: /api/<path> → /embed/…?token → window.masterPlaylist.
export const getStream = async function ({
  link,
  signal,
  providerContext,
}: {
  link: string;
  type: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
  isDownload?: boolean;
}): Promise<Stream[]> {
  try {
    const { axios, commonHeaders } = providerContext;
    const headers = { ...commonHeaders, Referer: `${VIX}/` };

    const api = await axios.get(`${VIX}/api/${link}`, { signal, headers });
    const src = api.data?.src;
    if (!src) throw new Error("VixSrc has no source for this title");

    const embed = await axios.get(`${VIX}${src}`, { signal, headers });
    const html = String(embed.data);
    const at = html.indexOf("masterPlaylist");
    const block = at < 0 ? "" : html.slice(at, at + 800);
    const url = block.match(/url:\s*['"]([^'"]+)['"]/)?.[1];
    const token = block.match(/['"]token['"]:\s*['"]([^'"]+)['"]/)?.[1];
    const expires = block.match(/['"]expires['"]:\s*['"]([^'"]+)['"]/)?.[1];
    if (!url || !token || !expires) throw new Error("VixSrc page had no playlist");

    const fhd = /canPlayFHD\s*=\s*true/.test(html);
    const sep = url.includes("?") ? "&" : "?";
    const playlist = `${url}${sep}token=${token}&expires=${expires}${fhd ? "&h=1" : ""}&lang=en`;

    return [
      {
        server: "VixSrc",
        link: playlist,
        type: "m3u8",
        quality: fhd ? "1080" : "720",
        headers: { Referer: `${VIX}/` },
      },
    ];
  } catch (err) {
    throwProviderError("Flixbaba", "stream", err);
  }
};
