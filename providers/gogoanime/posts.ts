import { Post, ProviderContext } from "../types";
import { throwProviderError } from "../providerErrors";
import { anilist, titleOf } from "./common";

const QUERY = `query($page:Int,$sort:[MediaSort],$search:String,$status:MediaStatus,$format:MediaFormat,$genre:String){
  Page(page:$page,perPage:24){
    media(type:ANIME,isAdult:false,sort:$sort,search:$search,status:$status,format:$format,genre:$genre,idMal_not:null){
      id idMal title{english romaji native} coverImage{extraLarge large} format episodes
    }
  }
}`;

function toPosts(media: any[]): Post[] {
  return (media || [])
    .filter((m) => m?.idMal)
    .map((m) => ({
      title: titleOf(m),
      link: String(m.id),
      image: m.coverImage?.extraLarge || m.coverImage?.large || "",
      ...(m.format === "MOVIE" ? { cornerTag: "Movie" } : {}),
    }));
}

export const getPosts = async function ({
  filter,
  page,
  signal,
  providerContext,
}: {
  filter: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  try {
    // filter: "SORT", "airing:SORT", "movie:SORT" or "genre:Name"
    const [kind, value] = filter.includes(":") ? filter.split(":") : ["", filter];
    const vars: Record<string, unknown> = {
      page: page || 1,
      sort: [kind === "genre" ? "POPULARITY_DESC" : value || "TRENDING_DESC"],
    };
    if (kind === "airing") vars.status = "RELEASING";
    if (kind === "movie") vars.format = "MOVIE";
    if (kind === "genre") vars.genre = value;
    const data = await anilist(providerContext, QUERY, vars, signal);
    return toPosts(data?.Page?.media);
  } catch (err) {
    throwProviderError("Gogoanime", "posts", err);
  }
};

export const getSearchPosts = async function ({
  searchQuery,
  page,
  signal,
  providerContext,
}: {
  searchQuery: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  try {
    const data = await anilist(
      providerContext,
      QUERY,
      { page: page || 1, sort: ["SEARCH_MATCH"], search: searchQuery },
      signal,
    );
    return toPosts(data?.Page?.media);
  } catch (err) {
    throwProviderError("Gogoanime", "search posts", err);
  }
};
