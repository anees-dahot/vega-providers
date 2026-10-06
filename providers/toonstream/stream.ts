import { Stream, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { getBase, getHtml, unpack } from "./common";

const VIDEO = /https?:\/\/[^'"\s\\]+\.(?:m3u8|mp4)(?:\?[^'"\s\\]*)?/;

// Most players on the site either state the stream in a `file:` option or
// hide it in a packed script; this reads both.
function findVideo(html: string): { url: string; type: "m3u8" | "mp4" } | null {
  const sources = [html, unpack(html)];
  for (const text of sources) {
    const file =
      text.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/)?.[1] ||
      text.match(/["']?src["']?\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/)?.[1] ||
      text.match(VIDEO)?.[0];
    if (file) {
      const url = file.replace(/\\\//g, "/");
      return { url, type: /\.m3u8/i.test(url) ? "m3u8" : "mp4" };
    }
  }
  return null;
}

const hostLabel = (url: string): string =>
  (url.match(/^https?:\/\/(?:www\.)?([^/.]+)/)?.[1] || "server").replace(/^./, (c) =>
    c.toUpperCase(),
  );

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

    // Server names ("Moly", "Ruby"…) come from the tab buttons; they are in
    // the same order as the players.
    const tabNames = $("aside#aa-options")
      .parent()
      .find("a.btn .server")
      .map((_, el) => $(el).text().trim())
      .get();
    const embeds = $("#aa-options iframe")
      .map((_, el) => $(el).attr("data-src") || $(el).attr("src") || "")
      .get()
      .map((url: string, i: number) => ({ url, name: tabNames[i] || hostLabel(url) }))
      .filter((e: { url: string }) => /^https?:\/\//.test(e.url));
    if (embeds.length === 0) throw new Error("This page lists no servers");

    const failures: string[] = [];
    const results = await Promise.all(
      embeds.map(async (embed: { url: string; name: string }): Promise<Stream | null> => {
        try {
          // A dead host must not hold the others up.
          const page = await getHtml(providerContext, embed.url, signal, `${base}/`, 10000);
          const video = findVideo(page);
          if (!video) {
            failures.push(`${embed.name}: no video found`);
            return null;
          }
          const origin = embed.url.match(/^https?:\/\/[^/]+/)?.[0] || "";
          return {
            server: `${embed.name} (${hostLabel(embed.url)})`,
            link: video.url,
            type: video.type,
            headers: { Referer: `${origin}/` },
          };
        } catch (e: any) {
          failures.push(`${embed.name}: ${e?.response?.status || e?.message || "failed"}`);
          return null;
        }
      }),
    );

    const streams = results.filter((s): s is Stream => s !== null);
    // Same video from two mirrors counts once.
    const unique = streams.filter((s, i) => streams.findIndex((x) => x.link === s.link) === i);
    if (unique.length === 0) {
      throw new Error(
        `None of this episode's ${embeds.length} servers could be opened. ${failures.slice(0, 4).join("; ")}`,
      );
    }
    return unique;
  } catch (err) {
    throwProviderError("ToonStream", "stream", err);
  }
};
