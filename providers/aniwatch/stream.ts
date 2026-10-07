import { Stream, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { vidmolyExtractor } from "../extractors/vidmoly";
import { megaplayExtractor } from "../extractors/megaplay";
import { getBase, getJson, restUrl } from "./common";

// Resolve one embed: known hosts by extractor, otherwise a playlist written
// in the page, or a single nested iframe followed once.
async function resolveEmbed(
  providerContext: ProviderContext,
  url: string,
  audio: string,
  referer: string,
  signal?: AbortSignal,
  depth = 0,
): Promise<Stream | null> {
  if (/vidmoly\./i.test(url)) {
    return vidmolyExtractor(providerContext, url, referer, signal);
  }
  if (/megaplay\.[a-z]+\/stream\//i.test(url)) {
    return megaplayExtractor(providerContext, url, audio, referer, signal);
  }
  const { axios, commonHeaders } = providerContext;
  const res = await axios.get(url, {
    signal,
    timeout: 12000,
    headers: { ...commonHeaders, Referer: referer },
  });
  const html = String(res.data);
  const origin = url.match(/^https?:\/\/[^/]+/)?.[0] || "";
  const playlist = html.match(/https?:\/\/[^'"\s<\\]+\.m3u8[^'"\s<\\]*/)?.[0];
  if (playlist) {
    return { server: "Direct", link: playlist, type: "m3u8", headers: { Referer: `${origin}/` } };
  }
  const iframe = html.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1];
  if (iframe && depth < 1) {
    const next = iframe.startsWith("//") ? `https:${iframe}` : iframe;
    return resolveEmbed(providerContext, next, audio, url, signal, depth + 1);
  }
  return null;
}

// `link` is the episode id. The servers endpoint lists each server with its
// embed URL base64-encoded in data-hash.
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
    const data = await getJson(
      providerContext,
      `${restUrl(base)}/episode/servers?episodeId=${encodeURIComponent(link)}`,
      signal,
    );
    const $ = cheerio.load(String(data?.html || ""));
    const servers = $(".server-item")
      .map((_, el) => {
        let url = "";
        try {
          url = atob($(el).attr("data-hash") || "");
        } catch {
          url = "";
        }
        return {
          url,
          name: $(el).attr("data-server-name") || $(el).text().trim(),
          type: ($(el).attr("data-type") || "sub").toUpperCase(),
        };
      })
      .get()
      .filter((s: { url: string }) => /^https?:\/\//.test(s.url));
    if (servers.length === 0) throw new Error("This episode lists no servers");

    const failures: string[] = [];
    const results = await Promise.all(
      servers.map(async (s: { url: string; name: string; type: string }) => {
        try {
          const stream = await resolveEmbed(providerContext, s.url, s.type, `${base}/`, signal);
          if (!stream) failures.push(`${s.name} ${s.type}: no video found`);
          return stream ? { ...stream, server: `${s.name} (${s.type})` } : null;
        } catch (e: any) {
          failures.push(`${s.name} ${s.type}: ${e?.message}`);
          return null;
        }
      }),
    );
    const all = results.filter((s): s is Stream => s !== null);
    // Several MegaPlay servers often hand out the same playlist.
    const streams = all.filter((s, i) => all.findIndex((x) => x.link === s.link) === i);
    if (streams.length === 0) {
      throw new Error(`No playable source resolved. ${failures.join("; ")}`);
    }
    return streams;
  } catch (err) {
    throwProviderError("AniWatch", "stream", err);
  }
};
