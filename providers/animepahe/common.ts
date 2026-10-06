import { ProviderContext } from "../types";

export const DEFAULT_BASE = "https://animepahe.pw";

export async function getBase(
  providerContext: ProviderContext,
): Promise<string> {
  const override = await providerContext.kvStore?.get<string>("baseUrlOverride");
  return (override || DEFAULT_BASE).trim().replace(/\/+$/, "");
}

// openWebView resolves one pending request per host, so concurrent calls would
// receive each other's results. Run WebView fetches strictly one at a time.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

// Runs inside the page once Cloudflare has let it through: fetch every path
// same-origin (the WebView is the client Cloudflare already trusts) and post
// the raw responses back to the app.
function fetchScript(paths: string[]): string {
  return `(function(){
  if (window.__apRun) return; window.__apRun = true;
  var paths = ${JSON.stringify(paths)};
  var timer = setInterval(function(){
    if (!document.body || document.title.indexOf('Just a moment') === 0) return;
    clearInterval(timer);
    Promise.all(paths.map(function(u){
      return fetch(u, {credentials:'include'})
        .then(function(r){ return r.text().then(function(t){ return {status:r.status, text:t}; }); })
        .catch(function(e){ return {status:0, text:String(e)}; });
    })).then(function(res){
      window.ReactNativeWebView.postMessage(JSON.stringify({__waf:true, data:JSON.stringify(res)}));
    });
  }, 300);
})(); true;`;
}

type Raw = { status: number; text: string };

async function viaWebView(
  providerContext: ProviderContext,
  base: string,
  paths: string[],
): Promise<Raw[]> {
  const { openWebView, commonHeaders } = providerContext;
  return serial(async () => {
    const result = await openWebView(`${base}${paths[0]}`, {
      title: "Loading AnimePahe",
      description:
        "If a verification appears, complete it. This closes by itself.",
      headers: { ...commonHeaders, Referer: base },
      injectedJavaScript: fetchScript(paths),
      timeoutMs: 90000,
    });
    try {
      const parsed = JSON.parse(result.data);
      if (Array.isArray(parsed)) return parsed as Raw[];
    } catch {
      // fall through
    }
    throw new Error(
      "AnimePahe verification was closed before the page finished loading. Try again and wait for it to close by itself.",
    );
  });
}

// Fetches several AnimePahe paths. In the app this goes through the WebView,
// because Cloudflare rejects the app's native HTTP client even with a valid
// cf_clearance cookie. Without a WebView (test runner) it uses axios.
export async function requestMany(
  providerContext: ProviderContext,
  paths: string[],
  json = false,
): Promise<any[]> {
  const { axios, openWebView, commonHeaders } = providerContext;
  const base = await getBase(providerContext);

  let raws: Raw[];
  if (typeof openWebView === "function") {
    raws = await viaWebView(providerContext, base, paths);
  } else {
    raws = await Promise.all(
      paths.map(async (p) => {
        const res = await axios.get(`${base}${p}`, {
          headers: { ...commonHeaders, Referer: base },
          validateStatus: () => true,
          responseType: "text",
          transformResponse: (d: any) => d,
        });
        return { status: res.status, text: String(res.data) };
      }),
    );
  }

  return raws.map((r, i) => {
    if (r.status < 200 || r.status >= 300) {
      const snippet = r.text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      throw new Error(
        `AnimePahe ${paths[i]} returned HTTP ${r.status}: ${snippet.slice(0, 120)}`,
      );
    }
    return json ? JSON.parse(r.text) : r.text;
  });
}

export async function request(
  providerContext: ProviderContext,
  path: string,
  _signal?: AbortSignal,
  json = false,
): Promise<any> {
  return (await requestMany(providerContext, [path], json))[0];
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
