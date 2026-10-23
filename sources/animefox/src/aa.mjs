import { text, fail } from '../../../sdk/video.mjs';
import { parseLiteral } from '../../../sdk/literal.mjs';
const p = String.fromCharCode(0xff9f),
  epsilon = String.fromCharCode(0x03b5),
  de = String.fromCharCode(0x0414),
  theta = String.fromCharCode(0x0398),
  san = String.fromCharCode(0xff70),
  epsilonToken = p + epsilon + p,
  thetaToken = p + theta + p,
  sanToken = p + san + p,
  quoteToken = `(${p}${de}${p})[${p}o${p}]`,
  slashToken = `(${p}${de}${p})[${epsilonToken}]`;
const clean = (value) => value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
function unwrap(value) {
  while (value.startsWith('(') && value.endsWith(')')) {
    let depth = 0,
      whole = true;
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')') depth--;
      if (depth === 0 && i < value.length - 1) {
        whole = false;
        break;
      }
    }
    if (!whole) break;
    value = value.slice(1, -1);
  }
  return value;
}
function number(token, nesting = 0) {
  if (nesting > 64) throw fail('AA expression nesting limit');
  const value = unwrap(clean(token));
  if (value === thetaToken) return 1;
  if (value === 'c^_^o') return 0;
  if (value === sanToken) return 4;
  if (value === 'o^_^o') return 3;
  let depth = 0;
  for (let i = value.length - 1; i >= 0; i--) {
    if (value[i] === ')') depth++;
    else if (value[i] === '(') depth--;
    else if (!depth && (value[i] === '+' || value[i] === '-')) {
      const left = number(value.slice(0, i), nesting + 1),
        right = number(value.slice(i + 1), nesting + 1);
      return left == null || right == null ? null : value[i] === '+' ? left + right : left - right;
    }
  }
  return null;
}
function split(input) {
  const result = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '(') depth++;
    else if (input[i] === ')') depth--;
    else if (input[i] === '+' && !depth) {
      result.push(input.slice(start, i));
      start = i + 1;
    }
  }
  result.push(input.slice(start));
  return result;
}
function unpack(source) {
  const match = /\}\('((?:\\.|[^'\\])*)',(\d+),(\d+),'((?:\\.|[^'\\])*)'\.split\('\|'\)\)\)/.exec(
    source,
  );
  if (!match) return source;
  let payload = parseLiteral("'" + match[1] + "'"),
    radix = Number(match[2]),
    count = Number(match[3]);
  const dictionary = parseLiteral("'" + match[4] + "'");
  if (
    typeof payload !== 'string' ||
    typeof dictionary !== 'string' ||
    radix < 2 ||
    radix > 62 ||
    count > 20000
  )
    throw fail('Invalid packed AA settings');
  const words = dictionary.split('|'),
    digit = (value) => (value > 35 ? String.fromCharCode(value + 29) : value.toString(36)),
    index = (value) =>
      value < radix ? digit(value) : index(Math.floor(value / radix)) + digit(value % radix);
  while (count > 0) {
    count--;
    if (count >= words.length || !words[count]) continue;
    payload = payload.replace(new RegExp(`\\b${index(count)}\\b`, 'g'), () => words[count]);
  }
  return payload;
}
export function decodeSettings(html) {
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((v) => v[1])
    .find((value) => value.length > 20000 && value.includes("['_'] ("));
  if (!script) return {};
  const marker = "['_'] (",
    start = script.lastIndexOf(marker),
    tail = script.lastIndexOf(") ('_')");
  if (tail <= start) return {};
  const call = script.slice(start + marker.length, tail),
    end = call.lastIndexOf(') (');
  if (end <= 0) return {};
  let body = '';
  for (const part of split(call.slice(0, end))) {
    const token = clean(part);
    if (token === epsilonToken) body += 'return ';
    else if (token === quoteToken) body += '"';
    else if (token === slashToken) body += '\\';
    else {
      const value = number(token);
      if (value == null) throw fail('Unsupported AA data token');
      body += value;
    }
  }
  body = body.trim();
  if (!body.startsWith('return ')) return {};
  const value = parseLiteral(body.slice(7).trim().replace(/;$/, ''));
  if (typeof value !== 'string') return {};
  const source = unpack(value),
    result = {};
  for (const match of source.matchAll(
    /([A-Za-z][A-Za-z0-9_]*)\s*=\s*("(?:\\.|[^"\\])*"|true\b|false\b|\d+)/g,
  )) {
    const decoded = parseLiteral(match[2]);
    if (decoded != null) result[match[1]] = String(decoded);
  }
  return result;
}
