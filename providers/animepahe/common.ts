import { ProviderContext } from "../types";

export const DEFAULT_BASE = "https://animepahe.pw";

export async function getBase(
  providerContext: ProviderContext,
): Promise<string> {
  const override = await providerContext.kvStore?.get<string>("baseUrlOverride");
  return (override || DEFAULT_BASE).trim().replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// Persistent cache (kvStore). Every WebView round trip shows a dialog, so
// results are reused for a while instead of being fetched on each screen.
// ---------------------------------------------------------------------------
const INDEX_KEY = "cache:index";
type CacheIndex = Record<string, number>;

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;

export async function peekCache<T>(
  providerContext: ProviderContext,
  key: string,
  ttlMs = Infinity,
): Promise<T | undefined> {
  try {
    const hit = await providerContext.kvStore?.get<{ at: number; value: T }>(
      `cache:${key}`,
    );
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  } catch {
    // ignore cache read failures
  }
  return undefined;
}

export async function putCache(
  providerContext: ProviderContext,
  key: string,
  ttlMs: number,
  value: unknown,
): Promise<void> {
  const kv = providerContext.kvStore;
  if (!kv) return;
  try {
    const storeKey = `cache:${key}`;
    const now = Date.now();
    await kv.set(storeKey, { at: now, value });
    const index = (await kv.get<CacheIndex>(INDEX_KEY)) || {};
    index[storeKey] = now + Math.max(ttlMs, 24 * HOUR);
    for (const k of Object.keys(index)) {
      if (index[k] < now) {
        delete index[k];
        await kv.delete(k);
      }
    }
    await kv.set(INDEX_KEY, index);
  } catch {
    // ignore cache write failures
  }
}

export async function cached<T>(
  providerContext: ProviderContext,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const hit = await peekCache<T>(providerContext, key, ttlMs);
  if (hit !== undefined) return hit;
  const value = await loader();
  await putCache(providerContext, key, ttlMs, value);
  return value;
}

// ---------------------------------------------------------------------------
// WebView transport
// ---------------------------------------------------------------------------

// openWebView resolves one pending request per host, so concurrent calls would
// receive each other's results. Run WebView fetches strictly one at a time.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

// Runs inside the page once Cloudflare has let it through: fetch every URL
// same-origin (the WebView is the client Cloudflare already trusts) and post
// the raw responses back to the app. When `releasePath` is set, the first
// response is a paged release list; the remaining pages are fetched too.
function fetchScript(urls: string[], releasePath?: string): string {
  return `(function(){
  if (window.__apRun) return; window.__apRun = true;
  var urls = ${JSON.stringify(urls)};
  var releasePath = ${JSON.stringify(releasePath || "")};
  function get(u){
    return fetch(u, {credentials:'include'})
      .then(function(r){ return r.text().then(function(t){ return {status:r.status, text:t}; }); })
      .catch(function(e){ return {status:0, text:String(e)}; });
  }
  var told = false;
  var timer = setInterval(function(){
    if (!document.body) return;
    if (document.title.indexOf('Just a moment') === 0 || document.querySelector('#challenge-form, .cf-turnstile, #cf-wrapper')) {
      // Ask the app to show the (hidden) WebView so the user can solve it.
      if (!told) { told = true; window.ReactNativeWebView.postMessage(JSON.stringify({__waf:true, challenge:true})); }
      return;
    }
    clearInterval(timer);
    Promise.all(urls.map(get)).then(function(res){
      if (!releasePath) return res;
      var first;
      try { first = JSON.parse(res[res.length - 1].text); } catch(e) { return res; }
      var last = first && first.last_page ? first.last_page : 1;
      var more = [];
      for (var p = 2; p <= last; p++) more.push(get(releasePath + p));
      return Promise.all(more).then(function(rest){ return res.concat(rest); });
    }).then(function(res){
      window.ReactNativeWebView.postMessage(JSON.stringify({__waf:true, data:JSON.stringify(res)}));
    });
  }, 300);
})(); true;`;
}

type Raw = { status: number; text: string };

async function viaWebView(
  providerContext: ProviderContext,
  origin: string,
  urls: string[],
  releasePath?: string,
): Promise<Raw[]> {
  const { openWebView, commonHeaders } = providerContext;
  return serial(async () => {
    const result = await openWebView(urls[0], {
      title: "AnimePahe verification",
      description: "Complete the check below. This closes by itself.",
      silent: true,
      headers: { ...commonHeaders, Referer: `${origin}/` },
      injectedJavaScript: fetchScript(urls, releasePath),
      timeoutMs: 90000,
    });
    try {
      const parsed = JSON.parse(result.data);
      if (Array.isArray(parsed)) return parsed as Raw[];
    } catch {
      // fall through
    }
    throw new Error(
      "The verification was closed before the page finished loading. Try again and wait for it to close by itself.",
    );
  });
}

const originOf = (u: string) => u.match(/^https?:\/\/[^/]+/i)?.[0] || "";

function snippet(text: string): string {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

async function rawMany(
  providerContext: ProviderContext,
  urls: string[],
  releasePath?: string,
): Promise<Raw[]> {
  const { axios, openWebView, commonHeaders } = providerContext;
  if (typeof openWebView === "function") {
    return viaWebView(providerContext, originOf(urls[0]), urls, releasePath);
  }
  // No WebView (test runner): plain requests, no paging helper.
  return Promise.all(
    urls.map(async (u) => {
      const res = await axios.get(u, {
        headers: { ...commonHeaders, Referer: `${originOf(u)}/` },
        validateStatus: () => true,
        responseType: "text",
        transformResponse: (d: any) => d,
      });
      return { status: res.status, text: String(res.data) };
    }),
  );
}

function check(raws: Raw[], urls: string[], json: boolean): any[] {
  return raws.map((r, i) => {
    if (r.status < 200 || r.status >= 300) {
      throw new Error(
        `${urls[i] || "page"} returned HTTP ${r.status}: ${snippet(r.text)}`,
      );
    }
    return json ? JSON.parse(r.text) : r.text;
  });
}

// Fetches AnimePahe paths in one WebView round trip. Cloudflare rejects the
// app's native HTTP client even with a valid cf_clearance cookie.
export async function requestMany(
  providerContext: ProviderContext,
  paths: string[],
  json = false,
): Promise<any[]> {
  const base = await getBase(providerContext);
  const urls = paths.map((p) => (p.startsWith("http") ? p : `${base}${p}`));
  return check(await rawMany(providerContext, urls), urls, json);
}

export async function request(
  providerContext: ProviderContext,
  path: string,
  _signal?: AbortSignal,
  json = false,
): Promise<any> {
  return (await requestMany(providerContext, [path], json))[0];
}

// A paged JSON API (`last_page`) fetched completely in one WebView round trip.
export async function requestPaged(
  providerContext: ProviderContext,
  pagePrefix: string,
): Promise<any[]> {
  const base = await getBase(providerContext);
  const prefix = `${base}${pagePrefix}`;
  const urls = [`${prefix}1`];
  if (typeof providerContext.openWebView !== "function") {
    return check(await rawMany(providerContext, urls), urls, true);
  }
  const raws = await rawMany(providerContext, urls, prefix);
  return check(raws, raws.map((_, i) => `${prefix}${i + 1}`), true);
}

// Show page plus its whole episode list in a single WebView round trip.
export async function requestShow(
  providerContext: ProviderContext,
  session: string,
): Promise<{ html: string; pages: any[] }> {
  const base = await getBase(providerContext);
  const releasePath = `/api?m=release&id=${session}&sort=episode_asc&page=`;
  const urls = [`${base}/anime/${session}`, `${base}${releasePath}1`];
  if (typeof providerContext.openWebView !== "function") {
    const [html, first] = check(await rawMany(providerContext, urls), urls, false);
    return { html, pages: [JSON.parse(first)] };
  }
  // The script pages through the release list (`page=2…`) after the first fetch.
  const raws = await rawMany(providerContext, urls, `${base}${releasePath}`);
  const checked = check(raws, urls.concat(raws.slice(2).map(() => "release page")), false);
  return {
    html: checked[0],
    pages: checked.slice(1).map((t: string) => JSON.parse(t)),
  };
}

// ---------------------------------------------------------------------------
// Posters. AnimePahe's image host sits behind the same Cloudflare challenge,
// which the app's image loader can't pass, so covers come from AniList.
// ---------------------------------------------------------------------------
const ANILIST = "https://graphql.anilist.co";

async function anilist(providerContext: ProviderContext, query: string) {
  const res = await providerContext.axios.post(
    ANILIST,
    { query },
    { headers: { "Content-Type": "application/json", Accept: "application/json" } },
  );
  return res.data?.data || {};
}

const coverOf = (m: any): string =>
  m?.coverImage?.extraLarge || m?.coverImage?.large || "";

// Cover URLs for several titles with one request; cached for a week per title.
export async function coversByTitle(
  providerContext: ProviderContext,
  titles: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const t of titles) {
    const hit = await providerContext.kvStore?.get<{ at: number; url: string }>(
      `cover:${t.toLowerCase()}`,
    );
    if (hit && Date.now() - hit.at < 7 * 24 * HOUR && hit.url) out[t] = hit.url;
    else if (!(t in out)) missing.push(t);
  }
  if (missing.length) {
    try {
      const body = missing
        .map(
          (t, i) =>
            `a${i}: Media(search: ${JSON.stringify(t)}, type: ANIME) { coverImage { extraLarge large } }`,
        )
        .join(" ");
      const data = await anilist(providerContext, `query { ${body} }`);
      for (let i = 0; i < missing.length; i++) {
        const url = coverOf(data[`a${i}`]);
        if (url) {
          out[missing[i]] = url;
          await providerContext.kvStore?.set(
            `cover:${missing[i].toLowerCase()}`,
            { at: Date.now(), url },
          );
        }
      }
    } catch {
      // posters are optional
    }
  }
  return out;
}

// Poster and banner for one show, by AniList id when AnimePahe links it.
export async function coverForShow(
  providerContext: ProviderContext,
  anilistId: string | undefined,
  title: string,
): Promise<string> {
  try {
    const arg = anilistId
      ? `id: ${Number(anilistId)}`
      : `search: ${JSON.stringify(title)}`;
    const data = await anilist(
      providerContext,
      `query { Media(${arg}, type: ANIME) { coverImage { extraLarge large } } }`,
    );
    return coverOf(data.Media);
  } catch {
    return "";
  }
}

// Decodes every Dean Edwards p.a.c.k.e.r. payload in a page (Kwik embeds
// contain several) and returns the decoded scripts joined together.
export function unpack(source: string): string {
  const re =
    /\}\('((?:[^'\\]|\\[\s\S])*)',\s*(\d+),\s*(\d+),\s*'((?:[^'\\]|\\[\s\S])*)'\.split\('\|'\)/g;
  const digits =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const payload = m[1].replace(/\\(['\\])/g, "$1");
    const radix = parseInt(m[2], 10);
    const words = m[4].split("|");
    const decode = (w: string) => {
      let n = 0;
      for (const ch of w) n = n * radix + digits.indexOf(ch);
      return n;
    };
    out.push(
      payload.replace(/\b\w+\b/g, (w) => {
        const idx = decode(w);
        return words[idx] ? words[idx] : w;
      }),
    );
  }
  return out.join("\n");
}
