import { Stream, ProviderContext, TextTracks } from "../types";
import { throwProviderError } from "../providerErrors";
import { api } from "./common";

const TRACK_LABEL: Record<string, string> = { sub: "SUB", ssub: "SUB", dub: "DUB", raw: "RAW" };

// AnimePahe's CDN sits behind a Cloudflare check that apps can't pass: every
// request gets a 403 page, so its servers are left out.
const BLOCKED_PROVIDERS = new Set(["animepahe"]);

// Some hosts (KickAssAnime) refuse segments without an Origin matching the
// Referer, which the API doesn't send.
const withOrigin = (headers: Record<string, string> | undefined) => {
  if (!headers?.Referer || headers.Origin) return headers || undefined;
  try {
    return { ...headers, Origin: new URL(headers.Referer).origin };
  } catch {
    return headers;
  }
};

// `link` is "<animeId>:<episode>". The play endpoint returns ready-made
// streams from several upstream sites, grouped by sub/dub track.
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
    const sep = link.lastIndexOf(":");
    const id = link.slice(0, sep);
    const episode = link.slice(sep + 1);
    const data = await api(
      providerContext,
      `anime/${encodeURIComponent(id)}/episodes/${encodeURIComponent(episode)}/play`,
      signal,
    );

    const out: Stream[] = [];
    for (const track of data?.tracks || []) {
      const label = TRACK_LABEL[track.track] || String(track.track || "").toUpperCase();
      for (const provider of track.providers || []) {
        if (BLOCKED_PROVIDERS.has(String(provider.provider || "").toLowerCase())) continue;
        // Subtitle hosts check the same headers as the provider's streams.
        const subtitleHeaders = withOrigin(provider.servers?.[0]?.headers);
        const subtitles: TextTracks = (provider.subtitles || [])
          .filter((s: any) => typeof s?.file === "string" && (s.format || "vtt") === "vtt")
          .map((s: any) => ({
            title: s.label || s.language || "Subtitle",
            language: s.language || "und",
            type: "text/vtt" as const,
            uri: s.file,
            ...(subtitleHeaders ? { headers: subtitleHeaders } : {}),
          }));
        for (const server of provider.servers || []) {
          for (const s of server.streams || []) {
            if (typeof s?.url !== "string") continue;
            const height = s.resolution?.height || parseInt(String(s.quality || ""), 10);
            out.push({
              server: `${provider.provider} · ${server.server} (${label})`,
              link: s.url,
              type: s.format === "hls" ? "m3u8" : s.format || "mp4",
              ...(height ? { quality: String(height) } : {}),
              headers: withOrigin(server.headers),
              ...(subtitles.length ? { subtitles } : {}),
            });
          }
        }
      }
    }
    if (out.length === 0) throw new Error("No streams for this episode yet");
    return out;
  } catch (err) {
    throwProviderError("Miruro", "stream", err);
  }
};
