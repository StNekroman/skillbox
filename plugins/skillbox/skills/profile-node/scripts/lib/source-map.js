// Maps a generated position back to its original source through a source map,
// with nothing but Node. The map is found the way Node finds it: the file's
// last sourceMappingURL comment, inline as a data URL or a file beside it — or
// <file>.map when the file has no comment. Index maps (`sections`) are not
// supported; a file that has one is reported unmapped.

const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_VALUE = new Int8Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_VALUE[B64.charCodeAt(i)] = i;

const MAP_COMMENT = /\/[/*][#@]\s*sourceMappingURL=([^\s'"*]+)/g;
const SCHEME = /^[a-z][\w+.-]*:/i;

// One array of segments per generated line. A segment is
// [column, source, line, sourceColumn], all absolute and 0-based, or [column]
// alone for a stretch that maps to nothing. Names are not kept: the profile
// already carries V8's name for every function.
function decodeMappings(mappings) {
  const lines = [];
  let line = [];
  let seg = [];
  let col = 0;
  let src = 0;
  let srcLine = 0;
  let srcCol = 0;
  let value = 0;
  let shift = 0;
  for (let i = 0; i <= mappings.length; i++) {
    const ch = i < mappings.length ? mappings.charCodeAt(i) : 59; // a final ';' ends the last line
    if (ch === 44 || ch === 59) {
      if (shift) throw new Error(`mappings: a value is cut off at ${i}`);
      if (seg.length) {
        col += seg[0];
        if (seg.length >= 4) {
          src += seg[1];
          srcLine += seg[2];
          srcCol += seg[3];
          line.push([col, src, srcLine, srcCol]);
        } else {
          line.push([col]);
        }
      }
      seg = [];
      if (ch === 59) {
        lines.push(line);
        line = [];
        col = 0;
      }
      continue;
    }
    const digit = ch < 128 ? B64_VALUE[ch] : -1;
    if (digit < 0) throw new Error(`mappings: unexpected character at ${i}`);
    value += (digit & 31) * 2 ** shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    seg.push(value % 2 ? -Math.floor(value / 2) : value / 2);
    value = 0;
    shift = 0;
  }
  return lines;
}

// The original position of a generated one, or null. Only segments on the same
// line count: a column before the line's first segment maps to nothing, as in
// other source-map consumers. A negative column means the column is not known
// — the profile's per-line sample counts carry none — and takes the line's
// first mapped segment.
function originalPosition(map, line, column) {
  const segs = map.lines[line];
  if (!segs || !segs.length) return null;
  if (column < 0) {
    const first = segs.find((s) => s.length >= 4);
    const source = first && map.sources[first[1]];
    return source ? { source, line: first[2], column: first[3] } : null;
  }
  let lo = 0;
  let hi = segs.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid][0] <= column) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0 || segs[found].length < 4) return null;
  const [, src, srcLine, srcCol] = segs[found];
  const source = map.sources[src];
  return source ? { source, line: srcLine, column: srcCol } : null;
}

// A source as a path where it can be one. A relative source resolves against
// the map's own directory, after sourceRoot, as the spec says. webpack's
// `webpack://<namespace>/./src/x.ts` is relative to the build's context, which
// is not recorded, so it is kept relative.
function resolveSource(source, sourceRoot, mapFile) {
  const joined =
    sourceRoot && !SCHEME.test(source) && !path.isAbsolute(source)
      ? `${sourceRoot.replace(/\/?$/, '/')}${source}`
      : source;
  if (joined.startsWith('file:')) return fileURLToPath(joined);
  if (path.isAbsolute(joined)) return path.normalize(joined);
  const webpack = /^webpack:\/\/[^/]*\/(.*)$/.exec(joined);
  if (webpack) return webpack[1].replace(/^\.\//, '');
  if (SCHEME.test(joined)) return joined;
  return path.resolve(path.dirname(mapFile), joined);
}

// The decoded map of a generated file, or null when it has none or it cannot
// be read. Never throws: a broken map leaves the file unmapped.
function readMapFor(file) {
  try {
    const code = fs.readFileSync(file, 'utf8');
    let url = null;
    for (const m of code.matchAll(MAP_COMMENT)) url = m[1];
    let raw;
    let mapFile;
    if (url && url.startsWith('data:')) {
      const comma = url.indexOf(',');
      const body = url.slice(comma + 1);
      raw = /;base64$/i.test(url.slice(5, comma))
        ? Buffer.from(body, 'base64').toString('utf8')
        : decodeURIComponent(body);
      mapFile = file;
    } else {
      mapFile = !url
        ? `${file}.map`
        : url.startsWith('file:')
          ? fileURLToPath(url)
          : path.resolve(path.dirname(file), decodeURIComponent(url));
      raw = fs.readFileSync(mapFile, 'utf8');
    }
    const json = JSON.parse(raw);
    if (typeof json.mappings !== 'string' || !Array.isArray(json.sources)) return null;
    return {
      sources: json.sources.map((s) => (s == null ? null : resolveSource(s, json.sourceRoot || '', mapFile))),
      lines: decodeMappings(json.mappings),
    };
  } catch {
    return null;
  }
}

// A profile's script url as a file path, or null for anything that is not a
// file on this machine's terms: node: internals, an empty url, another scheme.
function urlToPath(url) {
  if (!url) return null;
  if (url.startsWith('file:')) {
    try {
      return fileURLToPath(url);
    } catch {
      return null;
    }
  }
  return path.isAbsolute(url) ? url : null;
}

// (url, line, column) → { source, line, column } or null, 0-based. Each file
// and its map are read once.
function createResolver() {
  const maps = new Map();
  return (url, line, column) => {
    const file = urlToPath(url);
    if (!file) return null;
    if (!maps.has(file)) maps.set(file, readMapFor(file));
    const map = maps.get(file);
    return map && originalPosition(map, line, column);
  };
}

module.exports = { decodeMappings, originalPosition, resolveSource, readMapFor, urlToPath, createResolver };
