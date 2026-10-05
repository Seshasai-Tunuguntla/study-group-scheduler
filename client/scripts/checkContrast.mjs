// Checks WCAG contrast for every text/background pair the stylesheet uses, in both themes.
// Reads the light-dark() token pairs straight from src/index.css: `node scripts/checkContrast.mjs`.
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const tokens = { light: {}, dark: {} };
for (const [, name, light, dark] of css.matchAll(/(--[\w-]+):\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/gi)) {
  tokens.light[name] = light;
  tokens.dark[name] = dark;
}

const channel = (hex, i) => {
  const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [foreground, background, minimum]: 4.5 for text, 3 for borders and grid cells (non-text).
const surfaces = ['--color-bg', '--color-sunken', '--color-surface', '--color-raised'];
const PAIRS = [
  ...surfaces.map((bg) => ['--color-text', bg, 4.5]),
  ...surfaces.map((bg) => ['--color-text-muted', bg, 4.5]),
  ...['--color-bg', '--color-surface', '--color-raised', '--color-accent-wash'].map((bg) => ['--color-accent', bg, 4.5]),
  ['--color-on-accent', '--color-accent', 4.5],
  ['--color-on-accent', '--color-accent-hover', 4.5],
  ...['--color-bg', '--color-surface', '--color-raised'].map((bg) => ['--color-input-line', bg, 3]),
  ['--color-accent', '--color-sunken', 3], // free cell vs empty cell (availability grid)
  ['--color-text', '--heat-1', 4.5],
  ['--color-text', '--heat-2', 4.5],
  ['--color-on-accent', '--heat-3', 4.5],
  ['--color-on-accent', '--heat-4', 4.5],
  ['--color-bg', '--color-text', 4.5], // best-time rank badges
  ['--color-danger', '--color-danger-surface', 4.5],
  ['--color-danger', '--color-surface', 4.5],
  ['--color-success', '--color-success-surface', 4.5],
  ['--color-info', '--color-info-surface', 4.5],
  ['--color-warning', '--color-warning-surface', 4.5],
  ['--color-warning', '--color-surface', 4.5],
];

let failures = 0;
for (const theme of ['light', 'dark']) {
  console.log(`\n${theme}`);
  for (const [fg, bg, min] of PAIRS) {
    const [a, b] = [tokens[theme][fg], tokens[theme][bg]];
    if (!a || !b) throw new Error(`Missing light-dark() token: ${a ? bg : fg}`);
    const ratio = contrast(a, b);
    const ok = ratio >= min;
    if (!ok) failures += 1;
    console.log(`${ok ? ' ok ' : 'FAIL'} ${ratio.toFixed(1).padStart(5)}:1  ${fg} on ${bg} (needs ${min})`);
  }
}
if (failures) {
  console.error(`\n${failures} pair(s) below WCAG AA`);
  process.exitCode = 1;
}
