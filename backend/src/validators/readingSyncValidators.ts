import { z } from 'zod';

import { READING_PULL_DEFAULT_LIMIT, READING_PULL_MAX_LIMIT, READING_PUSH_MAX_CHANGES, type ReadingChange } from '../services/readingSync';

/**
 * أورادي وختماتي sync payloads (services/readingSync.ts). Every field is
 * checked here — the server stores this content as the account's own — and
 * nothing else is accepted: never a user id, a revision to set, a change
 * number, or encrypted content (an unreleased build's format; refused, so
 * such a client cannot overwrite anything).
 */

/** The Mushaf's page count (mobile/src/mushaf/mushafPage.ts). */
const MUSHAF_PAGE_COUNT = 604;
/** mobile/src/mushaf/readingStops.ts: READING_STOP_NAME_MAX_LENGTH (characters). */
const NAME_MAX_LENGTH = 40;

// Device-generated opaque ids (e.g. `stop-lq3x9k-a8f2c1d0`, `khatma-<cycle id>-2`).
const idSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
const isoDateSchema = z.string().max(40).refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid timestamp.');
const pageSchema = z.number().int().min(1).max(MUSHAF_PAGE_COUNT);
// As the app stores it: trimmed, single spaces, no control characters, 1–40 characters.
const nameSchema = z.string().refine((value) => {
  const length = [...value].length;
  return length >= 1 && length <= NAME_MAX_LENGTH && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value) && !/\s{2,}/.test(value);
}, 'Invalid name.');

const cycleSchema = z.object({
  id: idSchema,
  startedAt: isoDateSchema,
  lastSavedPage: pageSchema,
  reachedEndAt: isoDateSchema.nullable(),
  startedByKhatmaId: idSchema.nullable(),
  savedSinceStart: z.boolean(),
  seq: z.number().int().min(0).max(1_000_000),
  undoneCycleId: idSchema.nullable(),
}).strict();

const wirdDataSchema = z.object({
  v: z.literal(1),
  kind: z.literal('wird'),
  id: idSchema,
  name: nameSchema,
  nameUpdatedAt: isoDateSchema.nullable(),
  page: pageSchema,
  savedAt: isoDateSchema,
  cycle: cycleSchema,
}).strict().refine((data) => data.cycle.lastSavedPage === data.page, 'The cycle must agree with the saved page.');

const khatmaDataSchema = z.object({
  v: z.literal(1),
  kind: z.literal('khatma'),
  id: idSchema,
  stopId: idSchema,
  stopName: nameSchema,
  cycleId: idSchema,
  cycleStartedAt: isoDateSchema,
  previousStartedByKhatmaId: idSchema.nullable(),
  completedAt: isoDateSchema,
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ramadan: z.boolean(),
  ramadanHijriYear: z.number().int().min(1300).max(1700).nullable(),
}).strict();

const activeDataSchema = z.object({
  v: z.literal(1),
  kind: z.literal('active'),
  id: z.literal('active'),
  stopId: idSchema.nullable(),
  changedAt: isoDateSchema.nullable(),
}).strict();

const baseRevisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable();

const changeSchema = z.union([
  z.object({ kind: z.literal('wird'), recordId: idSchema, action: z.literal('upsert'), baseRevision: baseRevisionSchema, data: wirdDataSchema }).strict()
    .refine((change) => change.data.id === change.recordId, 'Content must belong to its record.'),
  z.object({ kind: z.literal('active'), recordId: z.literal('active'), action: z.literal('upsert'), baseRevision: baseRevisionSchema, data: activeDataSchema }).strict(),
  z.object({ kind: z.literal('khatma'), recordId: idSchema, action: z.literal('upsert'), data: khatmaDataSchema }).strict()
    .refine((change) => change.data.id === change.recordId, 'Content must belong to its record.'),
  z.object({ kind: z.enum(['wird', 'khatma']), recordId: idSchema, action: z.literal('delete') }).strict(),
]);

export const pushReadingSchema = z.object({
  changes: z.array(changeSchema).min(1).max(READING_PUSH_MAX_CHANGES),
}).strict().refine(
  ({ changes }) => new Set(changes.map((change) => `${change.kind}:${change.recordId}`)).size === changes.length,
  'Each record may appear once per request.',
).transform(({ changes }) => ({ changes: changes as ReadingChange[] }));

const integerParam = (min: number, max: number) =>
  z.string().regex(/^\d{1,16}$/).transform(Number).pipe(z.number().int().min(min).max(max));

export const pullReadingQuerySchema = z.object({
  since: integerParam(0, Number.MAX_SAFE_INTEGER).optional().default(0),
  limit: integerParam(1, READING_PULL_MAX_LIMIT).optional().default(READING_PULL_DEFAULT_LIMIT),
}).strict();
