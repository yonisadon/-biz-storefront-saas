import type { CSSProperties } from 'react';
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const full = (h: string) =>
  h.length === 4 ? '#' + [...h.slice(1)].map((c) => c + c).join('') : h;

function readableOn(hex: string) {
  const n = parseInt(full(hex).slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.179 ? '#111111' : '#ffffff';
}

export function themeVars(colors?: Record<string, string | undefined>): CSSProperties {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(colors ?? {})) {
    if (typeof v !== 'string' || !HEX.test(v)) continue;
    out[`--brand-${k}`] = v;
    if (k === 'primary') out['--brand-primary-fg'] = readableOn(v);
  }
  return out as CSSProperties;
}