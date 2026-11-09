/**
 * Tiny YAML front-matter parser/serializer.
 *
 * Supports the subset Editbay needs for human-readable workspace files:
 * strings, numbers, booleans, arrays of strings (inline and block style) and
 * simple block scalars. No external dependencies.
 */

export type FrontMatterValue = string | number | boolean | string[];

export type FrontMatterData = Record<string, FrontMatterValue>;

export interface ParsedFrontMatter {
  data: FrontMatterData;
  body: string;
}

const FRONT_MATTER_FENCE = '---';
const NUMBER_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Parse front-matter. Returns null when the text does not start with `---`. */
export function parseFrontMatter(text: string): ParsedFrontMatter | null {
  const normalized = text.replace(/^\uFEFF/, '');
  const firstBreak = normalized.indexOf('\n');
  const firstLine = (firstBreak === -1 ? normalized : normalized.slice(0, firstBreak))
    .replace(/\r$/, '')
    .trim();
  if (firstLine !== FRONT_MATTER_FENCE) return null;

  const rest = firstBreak === -1 ? '' : normalized.slice(firstBreak + 1);
  const lines = rest.split(/\r?\n/);
  let closing = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if ((lines[index] ?? '').trim() === FRONT_MATTER_FENCE) {
      closing = index;
      break;
    }
  }
  if (closing === -1) {
    throw new Error('Invalid front-matter: missing closing "---"');
  }

  const data = parseYamlLines(lines.slice(0, closing));
  return { data, body: lines.slice(closing + 1).join('\n') };
}

/** Serialize front-matter and body. The parser restores the exact body. */
export function stringifyFrontMatter(data: FrontMatterData, body: string): string {
  const lines: string[] = [FRONT_MATTER_FENCE];
  for (const [key, value] of Object.entries(data)) {
    if (!isValidKey(key)) {
      throw new Error(`Invalid front-matter key: ${key}`);
    }
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map(formatString).join(', ')}]`);
    } else {
      lines.push(`${key}: ${formatScalar(value)}`);
    }
  }
  lines.push(FRONT_MATTER_FENCE);
  return `${lines.join('\n')}\n${body}`;
}

export function isFrontMatterValue(value: unknown): value is FrontMatterValue {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

function parseYamlLines(lines: string[]): FrontMatterData {
  const data: FrontMatterData = {};
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index] ?? '';
    const line = rawLine.trimEnd();
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      index += 1;
      continue;
    }

    const indentation = line.length - line.trimStart().length;
    if (indentation > 0) {
      throw new Error(`Invalid front-matter: unexpected indentation on line ${index + 1}`);
    }

    const colon = line.indexOf(':');
    if (colon <= 0) {
      throw new Error(`Invalid front-matter: expected "key: value" on line ${index + 1}`);
    }
    const key = line.slice(0, colon).trim();
    if (!isValidKey(key)) {
      throw new Error(`Invalid front-matter key on line ${index + 1}: ${key}`);
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
      data[key] = parseInlineArray(rawValue);
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

/** Read an indented `- item` list, or an empty string when none follows. */
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

function parseInlineArray(raw: string): string[] {
  if (!raw.endsWith(']')) {
    throw new Error(`Invalid front-matter array: ${raw}`);
  }
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

  if (quote !== null) {
    throw new Error(`Invalid front-matter array: unterminated quote in ${raw}`);
  }
  if (current.trim() !== '') parts.push(current.trim());

  return parts.map((part) => unquoteScalar(part));
}

function parseScalar(raw: string): string | number | boolean {
  const value = raw.trim();
  if (value === '') return '';
  if (value.startsWith('"') || value.startsWith("'")) {
    return unquoteScalar(value);
  }
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
    if (!value.endsWith('"') || value.length < 2) {
      throw new Error(`Invalid front-matter string: ${raw}`);
    }
    return unescapeDoubleQuoted(value.slice(1, -1));
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      throw new Error(`Invalid front-matter string: ${raw}`);
    }
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

function stripInlineComment(value: string): string {
  const trimmed = value.trim();
  const comment = trimmed.search(/\s#/);
  return comment === -1 ? trimmed : trimmed.slice(0, comment).trimEnd();
}

/* ------------------------------------------------------------------ */
/* Serializing                                                         */
/* ------------------------------------------------------------------ */

function formatScalar(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot serialize a non-finite number');
    return String(value);
  }
  return formatString(value);
}

function formatString(value: string): string {
  if (value === '') return '""';
  if (NUMBER_RE.test(value.trim()) || /^(true|false)$/i.test(value.trim())) {
    return JSON.stringify(value);
  }
  if (/^[A-Za-z0-9_./@+()% -]+$/.test(value) && value === value.trim()) {
    return value;
  }
  return JSON.stringify(value);
}

function isValidKey(key: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(key);
}
