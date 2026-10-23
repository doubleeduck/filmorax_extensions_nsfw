// Small UTF-8-only Web Encoding API surface. Other encodings are decoded by the
// host HTTP/HTML broker, never guessed here. No Node Buffer or OS access.
const bytesOf = (input) => {
  if (input === undefined) return new Uint8Array();
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input))
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('TextDecoder input must be a BufferSource');
};
function codePoint(text, index) {
  const first = text.charCodeAt(index);
  if (first >= 0xd800 && first <= 0xdbff) {
    const next = text.charCodeAt(index + 1);
    if (next >= 0xdc00 && next <= 0xdfff)
      return [0x10000 + ((first - 0xd800) << 10) + (next - 0xdc00), 2];
    return [0xfffd, 1];
  }
  return [first >= 0xdc00 && first <= 0xdfff ? 0xfffd : first, 1];
}
function encode(text, output) {
  let read = 0,
    written = 0;
  while (read < text.length) {
    const [point, units] = codePoint(text, read);
    const size = point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (written + size > output.length) break;
    if (size === 1) output[written++] = point;
    else {
      output[written++] =
        (size === 2 ? 0xc0 : size === 3 ? 0xe0 : 0xf0) | (point >> (6 * (size - 1)));
      for (let shift = 6 * (size - 2); shift >= 0; shift -= 6)
        output[written++] = 0x80 | ((point >> shift) & 0x3f);
    }
    read += units;
  }
  return { read, written };
}
export class Utf8TextEncoder {
  get encoding() {
    return 'utf-8';
  }
  encode(input = '') {
    const text = String(input),
      output = new Uint8Array(text.length * 3);
    return output.slice(0, encode(text, output).written);
  }
  encodeInto(input, destination) {
    if (!(destination instanceof Uint8Array))
      throw new TypeError('encodeInto destination must be Uint8Array');
    return encode(String(input), destination);
  }
}
export class Utf8TextDecoder {
  #pending = new Uint8Array();
  #seen = false;
  constructor(label = 'utf-8', { fatal = false, ignoreBOM = false } = {}) {
    if (!['utf-8', 'utf8', 'unicode-1-1-utf-8'].includes(String(label).trim().toLowerCase()))
      throw new RangeError('Host SDK supports UTF-8 only');
    Object.defineProperties(this, {
      fatal: { value: !!fatal, enumerable: true },
      ignoreBOM: { value: !!ignoreBOM, enumerable: true },
    });
  }
  get encoding() {
    return 'utf-8';
  }
  decode(input, { stream = false } = {}) {
    const incoming = bytesOf(input),
      data = new Uint8Array(this.#pending.length + incoming.length);
    data.set(this.#pending);
    data.set(incoming, this.#pending.length);
    this.#pending = new Uint8Array();
    const output = [];
    const append = (point) => {
      if (!this.#seen) {
        this.#seen = true;
        if (point === 0xfeff && !this.ignoreBOM) return;
      }
      output.push(String.fromCodePoint(point));
    };
    const invalid = () => {
      if (this.fatal) {
        this.#seen = false;
        throw new TypeError('Invalid UTF-8');
      }
      append(0xfffd);
    };
    for (let index = 0; index < data.length;) {
      const first = data[index];
      if (first < 0x80) {
        append(first);
        index++;
        continue;
      }
      const size =
        first >= 0xc2 && first <= 0xdf
          ? 2
          : first >= 0xe0 && first <= 0xef
            ? 3
            : first >= 0xf0 && first <= 0xf4
              ? 4
              : 0;
      if (!size) {
        invalid();
        index++;
        continue;
      }
      let point = first & (size === 2 ? 0x1f : size === 3 ? 0x0f : 0x07),
        consumed = 1,
        bad = false;
      while (consumed < size && index + consumed < data.length) {
        const next = data[index + consumed];
        const min =
          consumed === 1 && first === 0xe0 ? 0xa0 : consumed === 1 && first === 0xf0 ? 0x90 : 0x80;
        const max =
          consumed === 1 && first === 0xed ? 0x9f : consumed === 1 && first === 0xf4 ? 0x8f : 0xbf;
        if (next < min || next > max) {
          bad = true;
          break;
        }
        point = (point << 6) | (next & 0x3f);
        consumed++;
      }
      if (!bad && consumed < size && stream) {
        this.#pending = data.slice(index);
        break;
      }
      if (bad || consumed < size) invalid();
      else append(point);
      index += consumed;
    }
    if (!stream) this.#seen = false;
    return output.join('');
  }
}
