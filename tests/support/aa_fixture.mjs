/** Data-only AA fixture; no encoded function is executed by tests or sources. */
export function aaFixture(source) {
  const p = String.fromCharCode(0xff9f),
    e = String.fromCharCode(0x03b5),
    d = String.fromCharCode(0x0414),
    t = String.fromCharCode(0x0398),
    s = String.fromCharCode(0xff70),
    theta = p + t + p,
    san = p + s + p,
    tokens = [
      'c^_^o',
      theta,
      `(${theta}+${theta})`,
      'o^_^o',
      san,
      `(${san}+${theta})`,
      '(o^_^o+o^_^o)',
      `(${san}+o^_^o)`,
    ],
    quote = `(${p}${d}${p})[${p}o${p}]`,
    slash = `(${p}${d}${p})[${p}${e}${p}]`,
    parts = [p + e + p, quote];
  for (const char of source) {
    parts.push(slash);
    for (const digit of char.charCodeAt(0).toString(8)) parts.push(tokens[Number(digit)]);
  }
  parts.push(quote);
  return `<script>/*${'padding'.repeat(3000)}*/['_'] (${parts.join('+')}) (0) ('_')</script>`;
}
