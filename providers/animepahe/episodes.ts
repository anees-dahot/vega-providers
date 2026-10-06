import { EpisodeLink, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { request, requestMany } from "./common";

export const getEpisodes = async function ({
  url,
  providerContext,
}: {
  url: string;
  providerContext: ProviderContext;
}): Promise<EpisodeLink[]> {
  try {
    const path = (p: number) =>
      `/api?m=release&id=${url}&sort=episode_asc&page=${p}`;
    const first = await request(providerContext, path(1), undefined, true);
    const lastPage: number = first?.last_page || 1;

    // One WebView round trip for all remaining pages.
    const rest =
      lastPage > 1
        ? await requestMany(
            providerContext,
            Array.from({ length: lastPage - 1 }, (_, i) => path(i + 2)),
            true,
          )
        : [];

    const episodes: EpisodeLink[] = [];
    for (const pageData of [first, ...rest]) {
      for (const ep of pageData?.data || []) {
        if (!ep.session) continue;
        episodes.push({
          title: `Episode ${ep.episode}`,
          // stream.ts expects "<animeSession>/<episodeSession>"
          link: `${url}/${ep.session}`,
          image: ep.snapshot || undefined,
        });
      }
    }
    return episodes;
  } catch (err) {
    throwProviderError("AnimePahe", "episodes", err);
  }
};
