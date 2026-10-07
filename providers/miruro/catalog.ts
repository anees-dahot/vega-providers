// The API only accepts the exact catalog queries the site itself makes.
export const catalog = [
  { title: "Most Popular", filter: "sort=-popularity&limit=12" },
  { title: "Top Rated", filter: "sort=-score&limit=18" },
  { title: "Just Finished", filter: "status=FINISHED&format=TV,TV_SHORT,ONA,OVA&sort=-popularity&limit=12" },
  { title: "Top Movies", filter: "format=MOVIE&sort=-score&limit=12" },
  { title: "Upcoming", filter: "status=NOT_YET_RELEASED&sort=-popularity&limit=12" },
];

export const genres = [];
