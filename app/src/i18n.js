// Translation (house standard #20): the app is written in English and the English text IS the key —
// t('Saved {n} songs', { n }), plurals with t.n('{n} song', '{n} songs', n). font.js loads this
// language's locales/<lang>.json and provides window.t; main.jsx waits for it before rendering, so
// module-level labels are translated too. Outside the browser (tests) this is plain English.
const interp = (s, p) => (p ? String(s).replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(p, k) ? String(p[k]) : m)) : String(s));
const host = () => (typeof window !== 'undefined' && typeof window.appFont?.t === 'function' ? window.appFont.t : null);

export function t(key, params) { const h = host(); return h ? h(key, params) : interp(key, params); }
t.n = (one, other, n, params) => { const h = host(); return h?.n ? h.n(one, other, n, params) : interp(n === 1 ? one : other, { n, ...params }); };

// Numbers, dates and money in the reader's shared locale (font.js appFont.fmt / locale()).
const loc = () => (typeof window !== 'undefined' && window.appFont?.locale?.()) || undefined;
export const fmtNum = (n, max = 2) => { try { return new Intl.NumberFormat(loc(), { maximumFractionDigits: max }).format(n); } catch { return String(n); } };
export const fmtDate = (d) => { try { return new Intl.DateTimeFormat(loc(), { dateStyle: 'medium' }).format(d instanceof Date ? d : new Date(d)); } catch { return ''; } };
export const fmtDateTime = (d) => { try { return new Intl.DateTimeFormat(loc(), { dateStyle: 'medium', timeStyle: 'short', hourCycle: window.appFont?.clock?.() === '12' ? 'h12' : 'h23' }).format(d instanceof Date ? d : new Date(d)); } catch { return ''; } };
