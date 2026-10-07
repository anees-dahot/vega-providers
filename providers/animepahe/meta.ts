import { EpisodeLink, Info, Link, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { HOUR, MINUTE, cached, coverForShow, getBase, requestShow } from "./common";

// AnimePahe rarely marks fillers, so they come from MyAnimeList (via the
// Jikan API) using the MAL id the show page links to. Cached for a week.
async function fillerEpisodes(
  providerContext: ProviderContext,
  malId: string | undefined,
): Promise<Set<number>> {
  if (!malId) return new Set();
  try {
    const list = await cached<number[]>(providerContext, `fillers:${malId}`, 7 * 24 * HOUR, async () => {
      const { axios } = providerContext;
      const out: number[] = [];
      for (let page = 1; page <= 20; page++) {
        const res = await axios.get(
          `https://api.jikan.moe/v4/anime/${malId}/episodes?page=${page}`,
          { headers: { Accept: "application/json" }, timeout: 15000 },
        );
        for (const ep of res.data?.data || []) {
          if (ep?.filler) out.push(Number(ep.mal_id));
        }
        if (!res.data?.pagination?.has_next_page) break;
        // Jikan allows about 3 requests a second.
        await new Promise((r) => setTimeout(r, 400));
      }
      return out;
    });
    return new Set(list);
  } catch {
    return new Set();
  }
}

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
      const malId = (
        $(".external-links a[href*='myanimelist.net/anime/']").attr("href") || ""
      ).match(/anime\/(\d+)/)?.[1];
      const fillers = await fillerEpisodes(providerContext, malId);
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
            ...(ep.filler || fillers.has(Math.floor(Number(ep.episode)))
              ? { filler: true }
              : {}),
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
