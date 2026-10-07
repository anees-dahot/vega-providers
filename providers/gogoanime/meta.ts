import { Info, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { anilist, titleOf } from "./common";

const QUERY = `query($id:Int){
  Media(id:$id,type:ANIME){
    idMal title{english romaji native} description(asHtml:false) format status
    episodes nextAiringEpisode{episode} genres averageScore
    coverImage{extraLarge large} bannerImage
  }
}`;

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  try {
    const data = await anilist(providerContext, QUERY, { id: Number(link) });
    const m = data?.Media;
    if (!m?.idMal) throw new Error("This title has no MyAnimeList id to stream from");

    const isMovie = m.format === "MOVIE";
    // Airing shows: only the episodes already out.
    const count = isMovie
      ? 1
      : m.nextAiringEpisode?.episode
        ? m.nextAiringEpisode.episode - 1
        : m.episodes || 0;
    const directLinks = Array.from({ length: count }, (_, i) => ({
      title: isMovie ? "Movie" : `Episode ${i + 1}`,
      link: `${m.idMal}:${i + 1}`,
      type: (isMovie ? "movie" : "series") as "movie" | "series",
    }));

    return {
      title: titleOf(m),
      synopsis: String(m.description || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .trim(),
      image: m.coverImage?.extraLarge || m.coverImage?.large || "",
      ...(m.bannerImage ? { poster: m.bannerImage } : {}),
      imdbId: "",
      type: isMovie ? "movie" : "series",
      tags: m.genres || [],
      ...(m.averageScore ? { rating: (m.averageScore / 10).toFixed(1) } : {}),
      linkList: [{ title: isMovie ? "Movie" : "Episodes", directLinks }],
    };
  } catch (err) {
    throwProviderError("Gogoanime", "metadata", err);
  }
};
