import { fetchWithTimeout } from './fetch-with-timeout.js';

// wol.jw.org (Akamai) stalls on requests that send a browser User-Agent without
// Accept-Language, so it is always sent (matching the requested locale).
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const TTL_MS = Number(process.env.JW_MCP_CACHE_TTL_MS) > 0 ? Number(process.env.JW_MCP_CACHE_TTL_MS) : 6 * 60 * 60 * 1000;
const MAX_ENTRIES = Number(process.env.JW_MCP_CACHE_MAX) > 0 ? Number(process.env.JW_MCP_CACHE_MAX) : 300;

const cache = new Map(); // url -> { at, value }

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  // refresh LRU position
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { at: Date.now(), value });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

export function clearWolCache() {
  cache.clear();
}

/**
 * Fetch an HTML page from wol.jw.org with locale headers, following redirects.
 * Returns { html, finalUrl }. Responses are cached in memory (default 6h).
 */
export async function fetchWolHtml(url, loc, { fresh = false } = {}) {
  const key = `${loc?.code || 'x'}|${url}`;
  if (!fresh) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }

  const response = await fetchWithTimeout(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': loc?.accept || 'pt-BR,pt;q=0.9',
    },
  });

  if (!response.ok) {
    throw new Error(`wol.jw.org respondeu HTTP ${response.status} para ${url}`);
  }

  const value = { html: await response.text(), finalUrl: response.url || url };
  cacheSet(key, value);
  return value;
}

/** Fetch JSON from the jw-cdn APIs (mediator, pub-media) with caching. */
export async function fetchJsonCached(url, { fresh = false } = {}) {
  const key = `json|${url}`;
  if (!fresh) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  const response = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status} para ${url}`);
  const value = await response.json();
  cacheSet(key, value);
  return value;
}
