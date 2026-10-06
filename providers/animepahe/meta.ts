import { EpisodeLink, Info, Link, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { MINUTE, cached, coverForShow, getBase, requestShow } from "./common";

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  try {
    const { cheerio } = providerContext;
    const base = await getBase(providerContext);

    return await cached(providerContext, `meta:${link}`, 10 * MINUTE, async () => {
      // One WebView round trip: show page + every page of the episode list.
      const { html, pages } = await requestShow(providerContext, link);
      const $ = cheerio.load(html);

      const title =
        $(".title-wrapper h1 span").first().text().trim() ||
        $(".title-wrapper h1").first().text().trim();
      $(".anime-synopsis br").replaceWith("\n");
      const synopsis = $(".anime-synopsis").text().trim();
      const tags = $(".anime-genre a, .anime-info a[href^='/anime/theme/']")
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(Boolean);
      const isMovie = /^movie$/i.test(
        $(".anime-info a[href^='/anime/type/']").first().text().trim(),
      );
      const anilistId = (
        $(".external-links a[href*='anilist.co/anime/']").attr("href") || ""
      ).match(/anime\/(\d+)/)?.[1];

      // AnimePahe's own poster host is behind Cloudflare, so use AniList.
      const image =
        (await coverForShow(providerContext, anilistId, title)) ||
        $(".title-wrapper .anime-poster a").attr("href") ||
        "";

      const directLinks: NonNullable<Link["directLinks"]> = [];
      for (const pageData of pages) {
        for (const ep of pageData?.data || []) {
          if (!ep.session) continue;
          directLinks.push({
            title: `Episode ${ep.episode}`,
            // stream.ts expects "<animeSession>/<episodeSession>"
            link: `${link}/${ep.session}`,
            type: isMovie ? "movie" : "series",
          });
        }
      }

      const info: Info = {
        title,
        synopsis,
        image,
        imdbId: "",
        type: isMovie ? "movie" : "series",
        tags,
        webUrl: `${base}/anime/${link}`,
        linkList: [{ title: isMovie ? "Movie" : "Episodes", directLinks }],
      };
      return info;
    });
  } catch (err) {
    throwProviderError("AnimePahe", "metadata", err);
  }
};

export type { EpisodeLink };
