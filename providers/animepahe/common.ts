import { ProviderContext } from "../types";

export const DEFAULT_BASE = "https://animepahe.pw";
const SESSION_KEY = "cfSession";

type CfSession = { cookies: string; userAgent: string };

export async function getBase(
  providerContext: ProviderContext,
): Promise<string> {
  const override = await providerContext.kvStore?.get<string>("baseUrlOverride");
  return (override || DEFAULT_BASE).trim().replace(/\/+$/, "");
}

// GET with Cloudflare handling: reuse the saved cf_clearance session, and on a
// 403 challenge ask the user to solve it once in a WebView, then retry. The
// clearance cookie is bound to the WebView's User-Agent, so both are stored
// and sent together.
export async function request(
  providerContext: ProviderContext,
  path: string,
  signal?: AbortSignal,
  json = false,
): Promise<any> {
  const { axios, openWebView, commonHeaders, kvStore } = providerContext;
  const base = await getBase(providerContext);
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const headers = (session?: CfSession) => ({
    ...commonHeaders,
    Referer: base,
    ...(json ? { Accept: "application/json, text/plain, */*" } : {}),
    ...(session
      ? { Cookie: session.cookies, "User-Agent": session.userAgent }
      : {}),
  });

  const saved = await kvStore?.get<CfSession>(SESSION_KEY);
  try {
    const res = await axios.get(url, { signal, headers: headers(saved) });
    return res.data;
  } catch (error: any) {
    if (error.response?.status !== 403) throw error;
    if (!openWebView) {
      throw new Error(
        "AnimePahe is behind a Cloudflare challenge (403) and this environment cannot open a WebView to solve it. Test inside the app.",
      );
    }
    if (saved) await kvStore?.delete(SESSION_KEY);
    const solved = await openWebView(base, {
      title: "Solve the captcha below and click done",
      description: "Required to bypass AnimePahe anti-bot protection.",
      headers: { ...commonHeaders, Referer: base },
      force: true,
      waitForCookie: "cf_clearance",
    });
    const session: CfSession = {
      cookies: solved.cookies,
      userAgent: solved.userAgent || commonHeaders["User-Agent"],
    };
    await kvStore?.set(SESSION_KEY, session);
    const res = await axios.get(url, { signal, headers: headers(session) });
    return res.data;
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
