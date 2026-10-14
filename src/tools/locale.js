/**
 * Locale mapping between the different language codes jw.org uses.
 *
 * - wol: path segment on wol.jw.org (/pt/wol/...)
 * - r / lp: "resource" and "language pack" segments of WOL URLs (r5/lp-t)
 * - meps: language code used by jw-cdn APIs (langwritten / wtlocale)
 * - read: word that precedes a "read this scripture" link in study articles
 */
export const LOCALES = {
  pt: { code: 'pt', wol: 'pt', r: 'r5', lp: 'lp-t', meps: 'T', accept: 'pt-BR,pt;q=0.9,en;q=0.5', read: ['leia'] },
  en: { code: 'en', wol: 'en', r: 'r1', lp: 'lp-e', meps: 'E', accept: 'en-US,en;q=0.9', read: ['read'] },
  es: { code: 'es', wol: 'es', r: 'r4', lp: 'lp-s', meps: 'S', accept: 'es-ES,es;q=0.9,en;q=0.5', read: ['lea'] },
};

const ALIASES = {
  pt: 'pt', 'pt-br': 'pt', t: 'pt', portugues: 'pt', 'português': 'pt',
  en: 'en', 'en-us': 'en', e: 'en', english: 'en',
  es: 'es', s: 'es', espanol: 'es', 'español': 'es',
};

export const DEFAULT_LANG = ALIASES[(process.env.JW_DEFAULT_LANG || 'pt').toLowerCase()] || 'pt';

export const LANG_SCHEMA = {
  type: 'string',
  enum: ['pt', 'en', 'es'],
  description: `Idioma do conteúdo: "pt" (português, padrão), "en" ou "es". Também aceita os códigos do jw.org (T, E, S).`,
  default: DEFAULT_LANG,
};

/** Resolve any accepted language identifier ("pt", "T", "pt-BR"...) to a locale. */
export function getLocale(lang) {
  if (!lang) return LOCALES[DEFAULT_LANG];
  const key = ALIASES[String(lang).trim().toLowerCase()];
  if (!key) throw new Error(`Idioma não suportado: "${lang}". Use pt, en ou es.`);
  return LOCALES[key];
}

/** Build a WOL URL: wolUrl(loc, 'b', 'nwtsty', 40, 6) -> https://wol.jw.org/pt/wol/b/r5/lp-t/nwtsty/40/6 */
export function wolUrl(loc, kind, ...rest) {
  const tail = rest.length ? '/' + rest.map(String).join('/') : '';
  return `https://wol.jw.org/${loc.wol}/wol/${kind}/${loc.r}/${loc.lp}${tail}`;
}

/** Make a WOL href absolute. */
export function absUrl(href) {
  if (!href) return null;
  if (/^https?:\/\//.test(href)) return href;
  return `https://wol.jw.org${href.startsWith('/') ? '' : '/'}${href}`;
}

/** Only allow fetching wol.jw.org pages (the tools accept URLs from the model). */
export function assertWolUrl(url) {
  let parsed;
  try {
    parsed = new URL(absUrl(url));
  } catch {
    throw new Error(`URL inválida: ${url}`);
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'wol.jw.org') {
    throw new Error(`Só são aceitas URLs de https://wol.jw.org (recebido: ${parsed.hostname})`);
  }
  return parsed.toString();
}
