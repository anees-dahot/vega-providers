import { Info, Link, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { img, parseLink, tmdb } from "./common";

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  try {
    const { type, id } = parseLink(link);
    const d = await tmdb(providerContext, `/${type}/${id}`, {
      append_to_response: "external_ids,credits",
    });
    const title = d.title || d.name || "";
    const year = (d.release_date || d.first_air_date || "").slice(0, 4);

    let linkList: Link[];
    if (type === "movie") {
      linkList = [
        {
          title: year ? `${title} (${year})` : title,
          directLinks: [{ title: "Movie", link: `movie/${id}`, type: "movie" }],
        },
      ];
    } else {
      // Season 0 ("Specials") is skipped, matching the site's season picker.
      linkList = (d.seasons || [])
        .filter((s: any) => s.season_number > 0 && s.episode_count > 0)
        .map((s: any) => ({
          title: s.name || `Season ${s.season_number}`,
          episodesLink: `${id}/${s.season_number}`,
        }));
    }

    return {
      title,
      synopsis: d.overview || "",
      image: img(d.backdrop_path, "original") || img(d.poster_path),
      poster: img(d.poster_path),
      imdbId: d.external_ids?.imdb_id || d.imdb_id || "",
      tmdbId: String(id),
      type: type === "movie" ? "movie" : "series",
      tags: (d.genres || []).map((g: any) => g.name),
      cast: (d.credits?.cast || []).slice(0, 10).map((c: any) => c.name),
      rating: d.vote_average ? d.vote_average.toFixed(1) : undefined,
      webUrl: link,
      linkList,
    };
  } catch (err) {
    throwProviderError("Flixbaba", "metadata", err);
  }
};
