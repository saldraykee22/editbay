/**
 * Workspace front-matter helpers for the renderer.
 *
 * Why this module exists instead of importing `@editbay/harness/frontmatter`:
 * the harness package only exposes its root plus a few named subpaths
 * (`agent`, `tools`, `prompt`, `types`, `receipts`, `providers`), and its root
 * index re-exports Node-only modules (`workspace.ts`, `receipts-node.ts` that
 * import `node:fs`). Vite cannot bundle those into the sandboxed renderer, so
 * the renderer keeps one shared implementation here. It mirrors the grammar in
 * `packages/harness/src/frontmatter.ts` (so the same files round-trip through
 * `FileMemoryStore` / `FileSkillStore`) and adds hex-colour-aware comment
 * stripping: the harness strips `"\s#.*"` which would truncate an unquoted
 * colour list such as `#0B0B0B, #5BE9A6` to `#0B0B0B,`.
 *
 * If the harness ever exports a browser-safe `./frontmatter` subpath, delete
 * this module and point BrandPanel, SkillsPanel and state/workspace.ts at it.
 */

export type FrontMatterValue = string | number | boolean | string[];

export type FrontMatterData = Record<string, FrontMatterValue>;

export interface ParsedFrontMatter {
  data: FrontMatterData;
  body: string;
}

const FENCE = '---';
const NUMBER_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const HEX_COLOR_RE = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?(?=\s|,|$)/;
const INLINE_COMMENT_RE = /\s#/;

/** Parse optional YAML front-matter. Returns null when there is none. */
export function parseFrontMatter(text: string): ParsedFrontMatter | null {
  const normalized = text.replace(/^\uFEFF/, '');
  const firstBreak = normalized.indexOf('\n');
  const firstLine = (firstBreak === -1 ? normalized : normalized.slice(0, firstBreak)).replace(/\r$/, '').trim();
  if (firstLine !== FENCE) return null;

  const rest = firstBreak === -1 ? '' : normalized.slice(firstBreak + 1);
  const lines = rest.split(/\r?\n/);
  let closing = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if ((lines[index] ?? '').trim() === FENCE) {
      closing = index;
      break;
    }
  }
  if (closing === -1) return null;

  return { data: parseYamlLines(lines.slice(0, closing)), body: lines.slice(closing + 1).join('\n') };
}

/** Serialize front-matter and body. */
export function stringifyFrontMatter(data: FrontMatterData, body: string): string {
  const lines: string[] = [FENCE];
  for (const [key, value] of Object.entries(data)) {
    if (!isValidKey(key)) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map(formatString).join(', ')}]`);
    } else {
      lines.push(`${key}: ${formatScalar(value)}`);
    }
  }
  lines.push(FENCE);
  const trimmed = body.replace(/^\r?\n+/, '').trimEnd();
  return trimmed === '' ? `${lines.join('\n')}\n` : `${lines.join('\n')}\n\n${trimmed}\n`;
}

/* ------------------------------------------------------------------ */
/* Read helpers                                                        */
/* ------------------------------------------------------------------ */

export function frontMatterString(data: FrontMatterData, key: string, fallback = ''): string {
  const value = data[key];
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

export function frontMatterBool(data: FrontMatterData, key: string, fallback = false): boolean {
  const value = data[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

/** Strings from an inline array, a block list or a comma-separated scalar. */
export function frontMatterList(data: FrontMatterData, key: string): string[] {
  const value = data[key];
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string' || value.trim() === '') return [];
  const inner = value.trim().replace(/^\[|\]$/g, '');
  return inner
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/** Colour-like values, tolerating legacy whitespace-separated lists. */
export function parseHexList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Comma-separated values that may contain spaces (font names, triggers). */
export function parseCommaList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

function parseYamlLines(lines: string[]): FrontMatterData {
  const data: FrontMatterData = {};
  let index = 0;

  while (index < lines.length) {
    const line = (lines[index] ?? '').trimEnd();
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      index += 1;
      continue;
    }

    const indentation = line.length - line.trimStart().length;
    if (indentation > 0) {
      // A stray indented line: skip it instead of failing a whole workspace file.
      index += 1;
      continue;
    }

    const colon = line.indexOf(':');
    if (colon <= 0) {
      index += 1;
      continue;
    }
    const key = line.slice(0, colon).trim();
    if (!isValidKey(key)) {
      index += 1;
      continue;
    }
    const rawValue = line.slice(colon + 1).trim();

    if (rawValue === '') {
      const block = readBlock(lines, index + 1);
      data[key] = block.value;
      index = block.next;
      continue;
    }

    if (rawValue === '|' || rawValue === '>') {
      const block = readBlockScalar(lines, index + 1, rawValue === '|');
      data[key] = block.value;
      index = block.next;
      continue;
    }

    if (rawValue.startsWith('[')) {
      const parsed = parseInlineArray(rawValue);
      data[key] = parsed ?? parseScalar(rawValue);
      index += 1;
      continue;
    }

    data[key] = parseScalar(rawValue);
    index += 1;
  }

  return data;
}

interface BlockResult {
  value: FrontMatterValue;
  next: number;
}

function readBlock(lines: string[], start: number): BlockResult {
  const items: string[] = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    const match = /^\s+-\s+(.*)$/.exec(line);
    if (!match) break;
    items.push(unquoteScalar((match[1] ?? '').trim()));
    index += 1;
  }

  return { value: items.length > 0 ? items : '', next: index };
}

interface BlockScalarResult {
  value: string;
  next: number;
}

function readBlockScalar(lines: string[], start: number, literal: boolean): BlockScalarResult {
  const collected: string[] = [];
  let index = start;
  let indentation: number | null = null;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      collected.push('');
      index += 1;
      continue;
    }
    const leading = line.length - line.trimStart().length;
    if (leading === 0) break;
    indentation ??= leading;
    collected.push(line.slice(Math.min(indentation, leading)));
    index += 1;
  }

  const value = literal ? collected.join('\n') : collected.join(' ').replace(/\s+/g, ' ');
  return { value: value.replace(/\n+$/, ''), next: index };
}

function parseInlineArray(raw: string): string[] | null {
  if (!raw.endsWith(']')) return null;
  const inner = raw.slice(1, -1).trim();
  if (inner === '') return [];

  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of inner) {
    if (quote === '"') {
      current += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        quote = null;
      }
      continue;
    }
    if (quote === "'") {
      current += char;
      if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ',') {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (quote !== null) return null;
  if (current.trim() !== '') parts.push(current.trim());
  return parts.map((part) => unquoteScalar(part));
}

function parseScalar(raw: string): string | number | boolean {
  const value = raw.trim();
  if (value === '') return '';
  if (value.startsWith('"') || value.startsWith("'")) return unquoteScalar(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (NUMBER_RE.test(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return stripInlineComment(value);
}

function unquoteScalar(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) return value;
    return unescapeDoubleQuoted(value.slice(1, -1));
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) return value;
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return stripInlineComment(value);
}

function unescapeDoubleQuoted(value: string): string {
  let result = '';
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      switch (char) {
        case 'n':
          result += '\n';
          break;
        case 't':
          result += '\t';
          break;
        case 'r':
          result += '\r';
          break;
        case '"':
          result += '"';
          break;
        case '\\':
          result += '\\';
          break;
        default:
          result += char;
          break;
      }
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else {
      result += char;
    }
  }
  if (escaped) result += '\\';
  return result;
}

/**
 * Strip a YAML inline comment, but keep unquoted hex colours: a `#` that
 * starts a 3/6/8-digit colour token is data, not a comment.
 */
function stripInlineComment(value: string): string {
  const trimmed = value.trim();
  let index = trimmed.search(INLINE_COMMENT_RE);
  while (index !== -1) {
    const rest = trimmed.slice(index + 1);
    if (!HEX_COLOR_RE.test(rest)) {
      return trimmed.slice(0, index).trimEnd();
    }
    const next = trimmed.slice(index + 1).search(INLINE_COMMENT_RE);
    if (next === -1) return trimmed;
    index = index + 1 + next;
  }
  return trimmed;
}

/* ------------------------------------------------------------------ */
/* Serializing                                                         */
/* ------------------------------------------------------------------ */

function formatScalar(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  return formatString(value);
}

function formatString(value: string): string {
  if (value === '') return '""';
  if (NUMBER_RE.test(value.trim()) || /^(true|false)$/i.test(value.trim())) return JSON.stringify(value);
  if (/^[A-Za-z0-9_./@+()% -]+$/.test(value) && value === value.trim()) return value;
  return JSON.stringify(value);
}

function isValidKey(key: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(key);
}
