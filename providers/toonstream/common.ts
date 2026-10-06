import { ProviderContext } from "../types";

export const DEFAULT_BASE = "https://toonstream.us";

export async function getBase(
  providerContext: ProviderContext,
): Promise<string> {
  const override = await providerContext.kvStore?.get<string>("baseUrlOverride");
  return (override || DEFAULT_BASE).trim().replace(/\/+$/, "");
}

export function absolute(base: string, href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("//")) return `https:${href}`;
  return `${base}${href.startsWith("/") ? "" : "/"}${href}`;
}

export async function getHtml(
  providerContext: ProviderContext,
  url: string,
  signal?: AbortSignal,
  referer?: string,
  timeout = 20000,
): Promise<string> {
  const { axios, commonHeaders } = providerContext;
  const res = await axios.get(url, {
    signal,
    timeout,
    headers: { ...commonHeaders, ...(referer ? { Referer: referer } : {}) },
  });
  return String(res.data);
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
