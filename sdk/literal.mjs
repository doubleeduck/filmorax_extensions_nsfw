/** Reads only data literals from player configuration; never evals site code. */
export function parseLiteral(input, start = 0) {
  let at = start,
    nodes = 0;
  const invalid = () => {
    throw new SyntaxError('Unsupported data literal');
  };
  const space = () => {
    while (/\s/.test(input[at] ?? '') && at < input.length) at++;
  };
  function string() {
    const quote = input[at++];
    let value = '';
    while (at < input.length) {
      const char = input[at++];
      if (char === quote) return value;
      if (char !== '\\') {
        value += char;
        continue;
      }
      const escape = input[at++];
      if (/^[0-7]$/.test(escape ?? '')) {
        let octal = escape;
        while (octal.length < 3 && /^[0-7]$/.test(input[at] ?? '')) octal += input[at++];
        value += String.fromCharCode(parseInt(octal, 8));
      } else if (escape === 'u' || escape === 'x') {
        const size = escape === 'u' ? 4 : 2,
          hex = input.slice(at, at + size);
        if (!new RegExp(`^[a-fA-F0-9]{${size}}$`).test(hex)) invalid();
        value += String.fromCharCode(parseInt(hex, 16));
        at += size;
      } else if (escape === '\n') {
        /* escaped line continuation */
      } else if (escape === '\r') {
        if (input[at] === '\n') at++;
      } else if (escape in { n: 1, r: 1, t: 1, b: 1, f: 1, v: 1, 0: 1 })
        value += { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' }[escape];
      else if (escape != null) value += escape;
      else invalid();
    }
    invalid();
  }
  function read(depth) {
    if (++nodes > 50000 || depth > 32 || at - start > 2 * 1024 * 1024) invalid();
    space();
    const char = input[at];
    if (char === '"' || char === "'") return string();
    if (char === '[' || char === '{') {
      const list = char === '[',
        end = list ? ']' : '}',
        result = list ? [] : {};
      at++;
      space();
      while (input[at] !== end) {
        let key;
        if (!list) {
          if (input[at] === '"' || input[at] === "'") key = string();
          else {
            const match = /^[A-Za-z_$][\w$]*/.exec(input.slice(at));
            if (!match) invalid();
            key = match[0];
            at += key.length;
          }
          if (
            key === '__proto__' ||
            key === 'constructor' ||
            key === 'prototype' ||
            Object.hasOwn(result, key)
          )
            invalid();
          space();
          if (input[at++] !== ':') invalid();
        }
        const value = read(depth + 1);
        if (list) result.push(value);
        else result[key] = value;
        space();
        if (input[at] === end) break;
        if (input[at++] !== ',') invalid();
        space();
      }
      at++;
      return result;
    }
    const match = /^(?:true\b|false\b|null\b|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(
      input.slice(at),
    );
    if (!match) invalid();
    at += match[0].length;
    return JSON.parse(match[0]);
  }
  try {
    return read(0);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
export function literalProperty(input, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    pattern = new RegExp(`(?:["']${escaped}["']|\\b${escaped})\\s*:\\s*`, 'g');
  for (const match of input.matchAll(pattern)) {
    const value = parseLiteral(input, match.index + match[0].length);
    if (value !== null) return value;
  }
  return null;
}
