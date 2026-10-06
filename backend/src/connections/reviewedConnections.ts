import { resolve } from 'node:path';

import { getCanonicalEmotion } from '../emotions/emotionCatalog';
import { isValidVerseKey } from '../quran/referenceKeys';
import type { EmotionMappingStatus, MappingConnection } from '../types/domain';

/**
 * Reviewed "How this ayah connects" content: the single source of truth for
 * mapping.connection, applied to the database only by
 * scripts/applyAyahConnections.ts (never edited in Mongo by hand).
 *
 * Shape: { "<emotionKey>": { "<verseKey>": { "en"?: string, "ar"?: string } } }
 * 'ar' serves both Arabic locales. Pure: no database, no side effects.
 */
export const REVIEWED_CONNECTIONS_PATH = resolve(__dirname, '../../data/ayah-connections/reviewed-connections.json');
export const CONNECTION_MAX_LENGTH = 2000; // matches models/EmotionVerseMapping.ts
const LOCALES = ['en', 'ar'] as const;

export type ReviewedConnection = { emotionKey: string; verseKey: string; connection: MappingConnection };

export class ConnectionValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Reviewed connections are invalid; nothing was written:\n- ${problems.join('\n- ')}`);
    this.name = 'ConnectionValidationError';
  }
}

/** JSON.parse, but refusing duplicate object keys (which JSON.parse silently collapses to the last one). */
export function parseJsonRejectingDuplicateKeys(text: string): unknown {
  let i = 0;
  const fail = (message: string): never => {
    throw new SyntaxError(`${message} at position ${i}`);
  };
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const str = (): string => {
    const start = i;
    i++; // opening quote
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (text[i] !== '"') fail('Unterminated string');
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (path: string): unknown => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const object: Record<string, unknown> = {};
      ws();
      if (text[i] === '}') return i++, object;
      for (;;) {
        ws();
        if (text[i] !== '"') fail('Expected a string key');
        const key = str();
        if (Object.prototype.hasOwnProperty.call(object, key)) fail(`Duplicate key "${path}${key}"`);
        ws();
        if (text[i] !== ':') fail('Expected ":"');
        i++;
        object[key] = value(`${path}${key}.`);
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') return i++, object;
        fail('Expected "," or "}"');
      }
    }
    if (c === '[') {
      i++;
      const array: unknown[] = [];
      ws();
      if (text[i] === ']') return i++, array;
      for (;;) {
        array.push(value(`${path}[${array.length}].`));
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') return i++, array;
        fail('Expected "," or "]"');
      }
    }
    if (c === '"') return str();
    const literal = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    if (!literal) fail('Unexpected token');
    i += literal![0].length;
    return JSON.parse(literal![0]);
  };
  const result = value('');
  ws();
  if (i !== text.length) fail('Unexpected trailing content');
  return result;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Structural validation of the file (no database): known emotion, real
 * verseKey, only en/ar string fields, trimmed, non-blank, ≤ 2,000 chars, at
 * least one locale, no duplicates. Throws ConnectionValidationError listing
 * every problem.
 */
export function parseReviewedConnections(text: string): ReviewedConnection[] {
  let data: unknown;
  try {
    data = parseJsonRejectingDuplicateKeys(text);
  } catch (error) {
    throw new ConnectionValidationError([`Not valid JSON: ${(error as Error).message}`]);
  }
  if (!isPlainObject(data)) throw new ConnectionValidationError(['Top level must be an object keyed by emotionKey.']);

  const problems: string[] = [];
  const entries: ReviewedConnection[] = [];
  for (const [emotionKey, verses] of Object.entries(data)) {
    if (!getCanonicalEmotion(emotionKey)) problems.push(`Unknown emotion "${emotionKey}".`);
    if (!isPlainObject(verses)) {
      problems.push(`"${emotionKey}" must be an object keyed by verseKey.`);
      continue;
    }
    for (const [verseKey, raw] of Object.entries(verses)) {
      const at = `${emotionKey} ${verseKey}`;
      if (!isValidVerseKey(verseKey)) problems.push(`${at}: invalid verseKey (expected an existing "surah:ayah").`);
      if (!isPlainObject(raw)) {
        problems.push(`${at}: must be an object with "en" and/or "ar".`);
        continue;
      }
      const unknown = Object.keys(raw).filter((key) => !(LOCALES as readonly string[]).includes(key));
      if (unknown.length > 0) problems.push(`${at}: unknown field(s) ${unknown.map((key) => `"${key}"`).join(', ')}; only "en" and "ar" are allowed.`);
      const connection: MappingConnection = {};
      for (const locale of LOCALES) {
        if (!(locale in raw)) continue;
        const text = raw[locale];
        if (typeof text !== 'string') {
          problems.push(`${at}: "${locale}" must be a string.`);
          continue;
        }
        const trimmed = text.trim();
        if (!trimmed) problems.push(`${at}: "${locale}" is blank; omit the field instead.`);
        else if (trimmed.length > CONNECTION_MAX_LENGTH) problems.push(`${at}: "${locale}" is ${trimmed.length} characters (max ${CONNECTION_MAX_LENGTH}).`);
        else connection[locale] = trimmed;
      }
      if (!('en' in raw) && !('ar' in raw)) problems.push(`${at}: needs "en" and/or "ar".`);
      entries.push({ emotionKey, verseKey, connection });
    }
  }
  if (problems.length > 0) throw new ConnectionValidationError(problems);
  return entries;
}

export type StoredMapping = {
  _id: unknown;
  emotionKey: string;
  verseReferenceKey: string;
  status: EmotionMappingStatus;
  connection?: MappingConnection;
};

export type ConnectionChange = {
  emotionKey: string;
  verseKey: string;
  mappingId: unknown;
  before: MappingConnection | null;
  after: MappingConnection;
};

const sameConnection = (a: MappingConnection | undefined, b: MappingConnection) => (a?.en ?? undefined) === b.en && (a?.ar ?? undefined) === b.ar;

/**
 * Checks every entry against the target database's mappings and returns the
 * pairs that would change. Only an existing, APPROVED mapping may receive
 * text — development, reviewed, draft, rejected and nonexistent mappings
 * are refused. Throws ConnectionValidationError if any entry is refused.
 */
export function planConnectionChanges(entries: ReviewedConnection[], mappings: StoredMapping[]): { changes: ConnectionChange[]; unchanged: number } {
  const problems: string[] = [];
  const changes: ConnectionChange[] = [];
  let unchanged = 0;
  for (const entry of entries) {
    const matches = mappings.filter((mapping) => mapping.emotionKey === entry.emotionKey && mapping.verseReferenceKey === entry.verseKey);
    const at = `${entry.emotionKey} ${entry.verseKey}`;
    if (matches.length === 0) {
      problems.push(`${at}: no such mapping in the target database.`);
      continue;
    }
    if (matches.length > 1) {
      problems.push(`${at}: duplicate mapping documents; manual review required.`);
      continue;
    }
    const [mapping] = matches;
    if (mapping.status !== 'approved') {
      problems.push(`${at}: mapping status is "${mapping.status}"; connection text is only allowed on approved mappings.`);
      continue;
    }
    if (sameConnection(mapping.connection, entry.connection)) {
      unchanged++;
      continue;
    }
    changes.push({ emotionKey: entry.emotionKey, verseKey: entry.verseKey, mappingId: mapping._id, before: mapping.connection ?? null, after: entry.connection });
  }
  if (problems.length > 0) throw new ConnectionValidationError(problems);
  return { changes, unchanged };
}

/** The exact update for one mapping: only connection.en / connection.ar are set or unset. */
export function connectionUpdate(after: MappingConnection): { $set: Record<string, string>; $unset?: Record<string, ''> } {
  const $set: Record<string, string> = {};
  const $unset: Record<string, ''> = {};
  for (const locale of LOCALES) {
    if (after[locale] !== undefined) $set[`connection.${locale}`] = after[locale]!;
    else $unset[`connection.${locale}`] = '';
  }
  return Object.keys($unset).length > 0 ? { $set, $unset } : { $set };
}
