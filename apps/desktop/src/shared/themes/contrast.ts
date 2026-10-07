/**
 * The WCAG 2 contrast ratio of two opaque colours, from 1 (none) to 21
 * (black on white). Each is `#rgb` or `#rrggbb`.
 */
export function contrastRatio(foreground: string, background: string) {
  const [lighter, darker] = [
    relativeLuminance(foreground),
    relativeLuminance(background),
  ].sort((a, b) => b - a) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(colour: string) {
  const [r, g, b] = channels(colour).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function channels(colour: string) {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(colour);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  const hex = short?.slice(1).map((digit) => digit + digit) ?? long?.slice(1);
  if (!hex) throw new Error(`${colour} is not an opaque hex colour.`);
  return hex.map((pair) => parseInt(pair, 16));
}
