import { classifyMongoFailure } from '../config/mongoFailure';

/**
 * Safe, allowlist-based descriptions of database errors for monitoring and
 * logs. MongoDB and Mongoose error MESSAGES can embed the data that caused
 * them — a duplicate key's values (a provider subject, an email), the value
 * a cast failed on (a user id), a validator's rejected input, or the filter
 * of a failed query. Instead of trying to redact those messages, a database
 * error's message is never used: its description is rebuilt only from fixed
 * identifiers (class name, numeric code, MongoDB codeName, index and field
 * NAMES, schema path, model name), each checked against SAFE_IDENTIFIER.
 * Anything that doesn't pass is replaced by a placeholder, never echoed.
 *
 * Pure: no I/O, and nothing here ever logs.
 */

const SAFE_IDENTIFIER = /^[A-Za-z0-9_.$-]{1,64}$/;

/** Mongoose error classes (their `name`), on top of every Mongo*, Mongoose* and BSON* name. */
const MONGOOSE_ERROR_NAMES = new Set([
  'CastError', 'ValidationError', 'ValidatorError', 'DocumentNotFoundError', 'VersionError', 'ParallelSaveError',
  'ParallelValidateError', 'StrictModeError', 'StrictPopulateError', 'DivergentArrayError', 'MissingSchemaError',
  'OverwriteModelError', 'ObjectExpectedError', 'ObjectParameterError', 'DisconnectedError', 'BulkSaveIncompleteError',
  'SyncIndexesError', 'InvalidSchemaOptionError', 'EachAsyncMultiError',
]);

const DUPLICATE_KEY_CODES = new Set([11000, 11001]);

type ErrorLike = {
  name?: unknown;
  code?: unknown;
  codeName?: unknown;
  message?: unknown;
  kind?: unknown;
  path?: unknown;
  model?: { modelName?: unknown } | null;
  keyPattern?: unknown;
  errors?: unknown;
  _message?: unknown;
};

function identifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && SAFE_IDENTIFIER.test(value) ? value : null;
}

export function isDatabaseErrorName(name: unknown): boolean {
  return typeof name === 'string' && (/^(Mongo|Mongoose|BSON)/.test(name) || MONGOOSE_ERROR_NAMES.has(name));
}

/** `index: <name>` / `collection: <db.coll>` out of a duplicate-key message, only if the token is a plain identifier. */
function messageToken(message: unknown, label: 'index' | 'collection'): string | null {
  if (typeof message !== 'string') return null;
  const match = new RegExp(`${label}: ([^\\s]+)`).exec(message);
  return match ? identifier(match[1]) : null;
}

function modelName(error: ErrorLike): string | null {
  const fromModel = identifier(error.model?.modelName);
  if (fromModel) return fromModel;
  const match = typeof error._message === 'string' ? /^([A-Za-z0-9_$]{1,64}) validation failed$/.exec(error._message) : null;
  return match ? match[1] : null;
}

function duplicateKeySummary(error: ErrorLike): string {
  const collection = messageToken(error.message, 'collection');
  const index = messageToken(error.message, 'index');
  const fields =
    error.keyPattern && typeof error.keyPattern === 'object'
      ? Object.keys(error.keyPattern).map(identifier).filter((v): v is string => v !== null)
      : [];
  return [
    `duplicate key (code ${identifier(error.code)})`,
    collection && `in ${collection}`,
    index && `on index ${index}`,
    fields.length > 0 && `fields: ${fields.join(', ')}`,
  ]
    .filter(Boolean)
    .join(' ')
    .concat('; key values removed');
}

function validationSummary(error: ErrorLike): string {
  const model = modelName(error);
  const entries = error.errors && typeof error.errors === 'object' ? Object.values(error.errors as Record<string, ErrorLike>).slice(0, 10) : [];
  const paths = entries.map((entry) => `${identifier(entry?.path) ?? '[path]'} (${identifier(entry?.kind) ?? 'invalid'})`);
  return `${model ? `${model} ` : ''}validation failed${paths.length > 0 ? ` at ${paths.join(', ')}` : ''}; values removed`;
}

/**
 * A safe one-line description of a MongoDB/Mongoose/BSON error, built only
 * from fixed identifiers. Null when `error` is not a database error (the
 * caller then falls back to scrubbing its message).
 */
export function summarizeDatabaseError(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as ErrorLike;
  if (!isDatabaseErrorName(e.name)) return null;

  switch (e.name) {
    case 'CastError': {
      const model = modelName(e);
      return `Cast to ${identifier(e.kind) ?? '[type]'} failed at path "${identifier(e.path) ?? '[path]'}"${model ? ` for model "${model}"` : ''}; value removed`;
    }
    case 'ValidationError':
      return validationSummary(e);
    case 'ValidatorError':
      return `validator "${identifier(e.kind) ?? 'unknown'}" failed at path "${identifier(e.path) ?? '[path]'}"; value removed`;
    default:
      break;
  }

  if (typeof e.code === 'number' && DUPLICATE_KEY_CODES.has(e.code)) return duplicateKeySummary(e);
  if (typeof e.code === 'number') {
    const codeName = identifier(e.codeName);
    return `MongoDB error code ${e.code}${codeName ? ` (${codeName})` : ''}; details removed`;
  }
  if (/^(Mongo|Mongoose)/.test(e.name as string) && !MONGOOSE_ERROR_NAMES.has(e.name as string)) {
    const { kind, identifiers } = classifyMongoFailure(error);
    return `MongoDB ${kind} failure (${identifiers}); details removed`;
  }
  const model = modelName(e);
  return `${model ? `model ${model}: ` : ''}details removed`;
}

/**
 * The same, from text only — for a Sentry exception entry whose original
 * error object is not available. The message is parsed for fixed
 * identifiers only; nothing else from it is kept.
 */
export function summarizeDatabaseErrorText(type: string, value: string): string | null {
  if (!isDatabaseErrorName(type)) return null;
  const validation = /^([A-Za-z0-9_$]{1,64}) validation failed/.exec(value);
  if (type === 'ValidationError' && validation) return `${validation[1]} validation failed; values removed`;
  const cast =/Cast to ([A-Za-z0-9_]{1,64}) failed .*?at path "([A-Za-z0-9_.$]{1,64})"(?: for model "([A-Za-z0-9_$]{1,64})")?/.exec(value);
  if (cast) return `Cast to ${cast[1]} failed at path "${cast[2]}"${cast[3] ? ` for model "${cast[3]}"` : ''}; value removed`;
  if (/\bE1100[01]\b/.test(value)) {
    const collection = messageToken(value, 'collection');
    const index = messageToken(value, 'index');
    return ['duplicate key', collection && `in ${collection}`, index && `on index ${index}`].filter(Boolean).join(' ').concat('; key values removed');
  }
  if (validation) return `${validation[1]} validation failed; values removed`;
  return 'details removed';
}

/** The error and its `cause` chain (bounded, cycle-safe), outermost first. */
export function errorChain(error: unknown, limit = 10): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current && typeof current === 'object' && chain.length < limit && !chain.includes(current)) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

/** Stack frames only ("    at …" lines): never the first line or any message line, which can repeat the message. */
export function safeStackFrames(error: unknown, max = 5): string {
  const stack = error instanceof Error && typeof error.stack === 'string' ? error.stack : '';
  return stack
    .split('\n')
    .filter((line) => /^\s+at\s/.test(line))
    .slice(0, max)
    .join('\n');
}
