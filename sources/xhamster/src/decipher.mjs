function decipher(hex) {
  if (hex.length < 12 || hex.length % 2 || hex.length > 32768 || !/^[0-9a-f]+$/i.test(hex))
    return '';
  const bytes = hex.match(/../g).map((v) => parseInt(v, 16)),
    algorithm = bytes[0];
  if (algorithm < 1 || algorithm > 7) return '';
  let state = bytes[1] | (bytes[2] << 8) | (bytes[3] << 16) | (bytes[4] << 24);
  function next() {
    let value;
    switch (algorithm) {
      case 1:
        state = (Math.imul(state, 1664525) + 1013904223) | 0;
        return state;
      case 2:
        value = state ^ (state << 13);
        value ^= value >>> 17;
        return (state = value ^ (value << 5));
      case 3:
        value = state = (state + 0x9e3779b9) | 0;
        value ^= value >>> 16;
        value = Math.imul(value, 0x85ebca77);
        value ^= value >>> 13;
        value = Math.imul(value, 0xc2b2ae3d);
        return value ^ (value >>> 16);
      case 4:
        value = state = (state + 0x6d2b79f5) | 0;
        value = (value << 7) | (value >>> 25);
        value = (value + 0x9e3779b9) | 0;
        value ^= value >>> 11;
        return Math.imul(value, 0x27d4eb2d);
      case 5:
        value = state ^ (state << 7);
        value ^= value >>> 9;
        value ^= value << 8;
        return (state = (value + 0xa5a5a5a5) | 0);
      case 6:
        state = (Math.imul(state, 0x2c9277b5) + 0xac564b05) | 0;
        value = state ^ (state >>> 18);
        return value >>> ((state >>> 27) & 31);
      case 7:
        value = state = (state + 0x9e3779b9) | 0;
        value ^= value << 5;
        value = Math.imul(value, 0x7feb352d);
        value ^= value >>> 15;
        return Math.imul(value, 0x846ca68b);
    }
  }
  return bytes
    .slice(5)
    .map((byte) => String.fromCharCode(byte ^ (next() & 255)))
    .join('');
}
export function decipherUrl(value) {
  value = String(value ?? '').trim();
  if (/^[0-9a-f]{12,}$/i.test(value)) return decipher(value);
  try {
    const uri = new URL(value),
      match = /^\/([0-9a-f]{12,})([/,].+)$/i.exec(uri.pathname);
    if (!match) return value;
    const decoded = decipher(match[1]);
    if (decoded) uri.pathname = '/' + decoded + match[2];
    return uri.href;
  } catch {
    return value;
  }
}
