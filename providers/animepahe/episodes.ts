import { EpisodeLink, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { request } from "./common";

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

    const rest = await Promise.all(
      Array.from({ length: Math.max(lastPage - 1, 0) }, (_, i) =>
        request(providerContext, path(i + 2), undefined, true),
      ),
    );

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
