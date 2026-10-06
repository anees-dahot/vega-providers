import { Stream, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { getBase, getHtml } from "./common";

const VIDMOLY = /^https?:\/\/(?:www\.)?vidmoly\.[a-z]+\//i;

async function resolveVidmoly(
  providerContext: ProviderContext,
  embedUrl: string,
  referer: string,
  signal?: AbortSignal,
): Promise<Stream | null> {
  // The embed redirects between vidmoly mirrors; axios follows it.
  const html = await getHtml(providerContext, embedUrl, signal, referer);
  const master =
    html.match(/file:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/)?.[1] ||
    html.match(/https?:\/\/[^'"\s\\]+\.m3u8[^'"\s\\]*/)?.[0];
  if (!master) return null;
  const origin = embedUrl.match(/^https?:\/\/[^/]+/)?.[0] || "";
  return {
    server: "Vidmoly",
    link: master,
    type: "m3u8",
    quality: "720",
    headers: { Referer: `${origin}/` },
  };
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
    const { cheerio } = providerContext;
    const base = await getBase(providerContext);
    const html = await getHtml(providerContext, link, signal, `${base}/`);
    const $ = cheerio.load(html);

    const embeds = $("#aa-options iframe")
      .map((_, el) => $(el).attr("data-src") || $(el).attr("src") || "")
      .get()
      .filter((u: string) => VIDMOLY.test(u));
    if (embeds.length === 0) throw new Error("This episode has no Vidmoly server");

    const failures: string[] = [];
    const streams: Stream[] = [];
    for (const embed of embeds) {
      try {
        const s = await resolveVidmoly(providerContext, embed, `${base}/`, signal);
        if (s && !streams.some((x) => x.link === s.link)) streams.push(s);
      } catch (e: any) {
        failures.push(e?.message || String(e));
      }
    }
    if (streams.length === 0) {
      throw new Error(`No playable source resolved. ${failures.slice(0, 2).join("; ")}`);
    }
    return streams;
  } catch (err) {
    throwProviderError("ToonStream", "stream", err);
  }
};
