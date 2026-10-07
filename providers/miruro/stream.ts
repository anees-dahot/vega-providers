import { Stream, ProviderContext, TextTracks } from "../types";
import { throwProviderError } from "../providerErrors";
import { api } from "./common";

const TRACK_LABEL: Record<string, string> = { sub: "SUB", ssub: "SUB", dub: "DUB", raw: "RAW" };

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
        const subtitles: TextTracks = (provider.subtitles || [])
          .filter((s: any) => typeof s?.file === "string" && (s.format || "vtt") === "vtt")
          .map((s: any) => ({
            title: s.label || s.language || "Subtitle",
            language: s.language || "und",
            type: "text/vtt" as const,
            uri: s.file,
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
              headers: server.headers || undefined,
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
