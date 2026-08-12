// Per-group visual themes: each is a set of CSS-variable overrides on :root. Every theme defines the
// same keys, so applying one fully replaces the previous (no leftovers to clear). 'default' == the
// values in index.css. Applied when an album in that group is open.
export const THEMES = {
  default:  { label: 'Default (blue)', vars: { '--bg': '#14161a', '--panel': '#1c1f26', '--panel2': '#232732', '--line': '#2e333f', '--accent': '#6ea8fe', '--accent2': '#8b5cf6' } },
  midnight: { label: 'Midnight',       vars: { '--bg': '#16131f', '--panel': '#1e1a2b', '--panel2': '#272138', '--line': '#352d4a', '--accent': '#b388ff', '--accent2': '#7c5cff' } },
  ember:    { label: 'Ember',          vars: { '--bg': '#1a1413', '--panel': '#241a18', '--panel2': '#322220', '--line': '#43302c', '--accent': '#ff8a5c', '--accent2': '#f2545b' } },
  forest:   { label: 'Forest',         vars: { '--bg': '#101815', '--panel': '#16211d', '--panel2': '#1e2d27', '--line': '#2b3d35', '--accent': '#4ade80', '--accent2': '#22b8a6' } },
  gold:     { label: 'Gold',           vars: { '--bg': '#181510', '--panel': '#221d15', '--panel2': '#30281c', '--line': '#42371f', '--accent': '#f5c451', '--accent2': '#e0913a' } },
  slate:    { label: 'Slate',          vars: { '--bg': '#14171a', '--panel': '#1c2024', '--panel2': '#252b31', '--line': '#333b42', '--accent': '#7dd3fc', '--accent2': '#38bdf8' } },
  rose:     { label: 'Rose',           vars: { '--bg': '#1a1317', '--panel': '#241a20', '--panel2': '#33232c', '--line': '#452f3c', '--accent': '#fb7185', '--accent2': '#e879a6' } },
};

export function applyTheme(key) {
  const t = THEMES[key] || THEMES.default;
  for (const [k, v] of Object.entries(t.vars)) document.documentElement.style.setProperty(k, v);
}
