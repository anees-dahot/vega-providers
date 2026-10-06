import { Stream, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { getBase, request, unpack } from "./common";

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
    const { cheerio, axios, commonHeaders } = providerContext;
    const base = await getBase(providerContext);
    const html = await request(providerContext, `/play/${link}`, signal);
    const $ = cheerio.load(html);

    const sources = $("#resolutionMenu button, button[data-src]")
      .map((_, el) => ({
        embed: $(el).attr("data-src") || "",
        resolution: $(el).attr("data-resolution") || "",
        audio: $(el).attr("data-audio") || "jpn",
        fansub: $(el).attr("data-fansub") || "",
        av1: $(el).attr("data-av1") === "1",
      }))
      .get()
      .filter((s) => s.embed);

    const streams = await Promise.all(
      sources.map(async (s): Promise<Stream | null> => {
        try {
          const res = await axios.get(s.embed, {
            signal,
            headers: { ...commonHeaders, Referer: `${base}/` },
          });
          const page: string = res.data;
          const unpacked = unpack(page);
          const m3u8 =
            unpacked.match(/https?:\/\/[^'"\s]+\.m3u8[^'"\s]*/)?.[0] ||
            page.match(/https?:\/\/[^'"\s]+\.m3u8[^'"\s]*/)?.[0];
          if (!m3u8) return null;
          const dub = s.audio.toLowerCase() === "eng";
          return {
            server: `${s.fansub || "Kwik"} ${s.resolution}p (${dub ? "Dub" : "Sub"})${s.av1 ? " AV1" : ""}`,
            link: m3u8,
            type: "m3u8",
            quality: s.resolution,
            headers: { Referer: "https://kwik.cx/" },
          };
        } catch {
          return null;
        }
      }),
    );

    const out = streams.filter((s): s is Stream => s !== null);
    // Highest quality first
    out.sort((a, b) => Number(b.quality) - Number(a.quality));
    return out;
  } catch (err) {
    throwProviderError("AnimePahe", "stream", err);
  }
};
