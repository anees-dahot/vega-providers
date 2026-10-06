import { Stream, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { MINUTE, cached, getBase, request, requestMany, unpack } from "./common";

type Source = {
  embed: string;
  resolution: string;
  audio: string;
  fansub: string;
  av1: boolean;
};

const M3U8 = /https?:\/\/[^'"\s]+\.m3u8[^'"\s]*/;

function extractM3u8(page: string): string | undefined {
  return unpack(page).match(M3U8)?.[0] || page.match(M3U8)?.[0];
}

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

    // The play page needs the WebView; keep the source list for a while so
    // streaming and downloading the same episode don't each open it.
    const sources = await cached<Source[]>(
      providerContext,
      `play:${link}`,
      10 * MINUTE,
      async () => {
        const html = await request(providerContext, `/play/${link}`, signal);
        const $ = cheerio.load(html);
        return $("#resolutionMenu button, button[data-src]")
          .map((_, el) => ({
            embed: $(el).attr("data-src") || "",
            resolution: $(el).attr("data-resolution") || "",
            audio: $(el).attr("data-audio") || "jpn",
            fansub: $(el).attr("data-fansub") || "",
            av1: $(el).attr("data-av1") === "1",
          }))
          .get()
          .filter((s: Source) => s.embed);
      },
    );
    if (sources.length === 0) {
      throw new Error("The episode page listed no sources");
    }

    const failures: string[] = [];
    const pages: Record<string, string> = {};

    // Native requests first, retrying once; they work for most Kwik embeds.
    const blocked: Source[] = [];
    await Promise.all(
      sources.map(async (s) => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await axios.get(s.embed, {
              signal,
              headers: { ...commonHeaders, Referer: `${base}/` },
            });
            pages[s.embed] = String(res.data);
            return;
          } catch (e: any) {
            const status = e?.response?.status;
            if (status === 403) {
              blocked.push(s);
              return;
            }
            if (attempt === 1) failures.push(`${s.resolution}p: ${status || e?.message}`);
          }
        }
      }),
    );

    // Anything Cloudflare blocked is fetched through the WebView instead.
    if (blocked.length > 0 && typeof providerContext.openWebView === "function") {
      try {
        const texts = await requestMany(
          providerContext,
          blocked.map((s) => s.embed),
        );
        blocked.forEach((s, i) => (pages[s.embed] = texts[i]));
      } catch (e: any) {
        failures.push(`kwik via WebView: ${e?.message}`);
      }
    }

    const out: Stream[] = [];
    for (const s of sources) {
      const page = pages[s.embed];
      const m3u8 = page ? extractM3u8(page) : undefined;
      if (!m3u8) {
        if (page) failures.push(`${s.resolution}p: no playlist in embed`);
        continue;
      }
      const dub = s.audio.toLowerCase() === "eng";
      out.push({
        server: `${s.fansub || "Kwik"} ${s.resolution}p (${dub ? "Dub" : "Sub"})${s.av1 ? " AV1" : ""}`,
        link: m3u8,
        type: "m3u8",
        quality: s.resolution,
        headers: { Referer: "https://kwik.cx/" },
      });
    }

    if (out.length === 0) {
      throw new Error(`No playable source resolved. ${failures.join("; ")}`);
    }
    // Highest quality first, dub after sub of the same quality.
    out.sort((a, b) => Number(b.quality) - Number(a.quality));
    return out;
  } catch (err) {
    throwProviderError("AnimePahe", "stream", err);
  }
};
