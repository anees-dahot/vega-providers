import { Stream, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { decodeEntities, embedHeaders, getBase } from "./common";

// Episode link → /player/?file_id=… (302) → page naming the embed host →
// embed host (302 to ?eid=…) → page with a direct video URL.
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

    const player = await axios.get(link, {
      signal,
      headers: { ...commonHeaders, Referer: `${base}/` },
    });
    const playerHtml = String(player.data);
    const embedUrl = playerHtml.match(
      /targetStreamUrl\s*=\s*["']([^"']+)["']/,
    )?.[1];
    if (!embedUrl) throw new Error("The player page did not name a video host");

    const embed = await axios.get(embedUrl, {
      signal,
      headers: embedHeaders(providerContext, `${base}/`),
    });
    const embedHtml = String(embed.data);
    const src =
      embedHtml.match(/<source[^>]*\ssrc="([^"]+)"/)?.[1] ||
      embedHtml.match(/proxyDownloadUrl\s*=\s*['"]([^'"]+)['"]/)?.[1];
    if (!src) {
      throw new Error(
        /access denied/i.test(embedHtml)
          ? "The video host refused the request (access denied)"
          : "The video page had no source",
      );
    }
    const videoUrl = decodeEntities(src);
    const embedOrigin = embedUrl.match(/^https?:\/\/[^/]+/)?.[0] || "";
    const title = embedHtml.match(/<title>([^<]*)<\/title>/)?.[1] || "";
    const quality = title.match(/\b(2160|1440|1080|720|480|360)p?\b/)?.[1] || "1080";

    return [
      {
        server: "AnimaHD",
        link: videoUrl,
        type: "mkv",
        quality,
        headers: { Referer: `${embedOrigin}/` },
      },
    ];
  } catch (err) {
    throwProviderError("AnimaHD", "stream", err);
  }
};
