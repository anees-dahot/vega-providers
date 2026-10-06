import { Info, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { getBase, request } from "./common";

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
    const html = await request(providerContext, `/anime/${link}`);
    const $ = cheerio.load(html);

    const title =
      $(".title-wrapper h1 span").first().text().trim() ||
      $(".title-wrapper h1").first().text().trim();
    const image =
      $(".title-wrapper .anime-poster a").attr("href") ||
      $(".title-wrapper .anime-poster img").attr("src") ||
      "";
    $(".anime-synopsis br").replaceWith("\n");
    const synopsis = $(".anime-synopsis").text().trim();
    const tags = $(".anime-genre a, .anime-info a[href^='/anime/theme/']")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    const isMovie = /^movie$/i.test(
      $(".anime-info a[href^='/anime/type/']").first().text().trim(),
    );

    return {
      title,
      synopsis,
      image,
      imdbId: "",
      type: isMovie ? "movie" : "series",
      tags,
      webUrl: `${base}/anime/${link}`,
      // Episodes are paginated by the release API, so load them in episodes.ts.
      linkList: [{ title: "Episodes", episodesLink: link }],
    };
  } catch (err) {
    throwProviderError("AnimePahe", "metadata", err);
  }
};
