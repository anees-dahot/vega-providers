import { Info, Stream, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import {
  HOUR,
  getBase,
  peekCache,
  putCache,
  requestMany,
  unpack,
} from "./common";

type Source = {
  embed: string;
  resolution: string;
  audio: string;
  fansub: string;
  av1: boolean;
};

const M3U8 = /https?:\/\/[^'"\s]+\.m3u8[^'"\s]*/;

const PLAY_TTL = 7 * 24 * HOUR; // Kwik embed links on a play page don't change
const PREFETCH = 12;
const M3U8_TTL = 3 * HOUR;

function parseSources(cheerio: ProviderContext["cheerio"], html: string): Source[] {
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
}

// Source lists for this episode and the next few, in one WebView round trip,
// so watching or bulk-downloading a series doesn't need one per episode.
async function loadSources(
  providerContext: ProviderContext,
  link: string,
  fresh: boolean,
): Promise<Source[]> {
  if (!fresh) {
    const hit = await peekCache<Source[]>(providerContext, `play:${link}`, PLAY_TTL);
    if (hit && hit.length) return hit;
  }
  const anime = link.split("/")[0];
  const meta = await peekCache<Info>(providerContext, `meta:${anime}`);
  const all = (meta?.linkList || []).flatMap((l) =>
    (l.directLinks || []).map((d) => d.link),
  );
  const batch = [link];
  for (let i = all.indexOf(link) + 1; i > 0 && i < all.length && batch.length < PREFETCH; i++) {
    if (!(await peekCache(providerContext, `play:${all[i]}`, PLAY_TTL))) batch.push(all[i]);
  }
  const texts = await requestMany(
    providerContext,
    batch.map((l) => `/play/${l}`),
  );
  let mine: Source[] = [];
  for (let i = 0; i < batch.length; i++) {
    const sources = parseSources(providerContext.cheerio, texts[i]);
    if (sources.length) await putCache(providerContext, `play:${batch[i]}`, PLAY_TTL, sources);
    if (i === 0) mine = sources;
  }
  return mine;
}

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
    const { axios, commonHeaders } = providerContext;
    const base = await getBase(providerContext);

    let sources = await loadSources(providerContext, link, false);
    if (sources.length === 0) {
      throw new Error("The episode page listed no sources");
    }

    const resolve = async (list: Source[]) => {
      const failures: string[] = [];
      const pages: Record<string, string> = {};

      // Reuse playlists resolved in the last few hours: Kwik blocks networks
      // that request it too often.
      const known: Record<string, string> = {};
      for (const s of list) {
        const hit = await peekCache<string>(providerContext, `m3u8:${s.embed}`, M3U8_TTL);
        if (hit) known[s.embed] = hit;
      }

      // Native requests first, retrying once on network errors only.
      const blocked: Source[] = [];
      await Promise.all(
        list.filter((s) => !known[s.embed]).map(async (s) => {
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
              if (status || attempt === 1) {
              failures.push(`${s.resolution}p: ${status || e?.message}`);
              return;
            }
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
      for (const s of list) {
        const page = pages[s.embed];
        const m3u8 = known[s.embed] || (page ? extractM3u8(page) : undefined);
        if (!m3u8) {
          if (page) failures.push(`${s.resolution}p: no playlist in embed`);
          continue;
        }
        if (!known[s.embed]) {
          await putCache(providerContext, `m3u8:${s.embed}`, M3U8_TTL, m3u8);
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

      return { out, failures };
    };

    let { out, failures } = await resolve(sources);
    if (out.length === 0) {
      // Cached links may have gone stale: reload the episode page once.
      sources = await loadSources(providerContext, link, true);
      ({ out, failures } = await resolve(sources));
    }
    if (out.length === 0) {
      const hint = failures.some((f) => /403/.test(f))
        ? " Kwik (the video host) is refusing this network; try mobile data or wait a while."
        : "";
      throw new Error(`No playable source resolved.${hint} ${failures.join("; ")}`);
    }
    // Highest quality first, dub after sub of the same quality.
    out.sort((a, b) => Number(b.quality) - Number(a.quality));
    return out;
  } catch (err) {
    throwProviderError("AnimePahe", "stream", err);
  }
};
