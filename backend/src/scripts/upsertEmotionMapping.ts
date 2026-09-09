import { connectToDatabase, disconnectFromDatabase } from '../config/database';
import { env } from '../config/env';
import { emotionMappingStatuses } from '../models/EmotionVerseMapping';
import { EmotionVerseMappingModel } from '../models/EmotionVerseMapping';
import { EmotionModel } from '../models/Emotion';
import { isValidVerseKey } from '../quran/referenceKeys';
import type { EmotionMappingStatus } from '../types/domain';
import { FOUNDATION_MAPPING_VERSION } from '../seed/foundation';

type ParsedArgs = Record<string, string | string[]>;

const usage = [
  'Usage:',
  '  npm run mapping:upsert -- --verse=2:153 --emotion=sad --status=development --rationale="..."',
  '',
  'Optional:',
  '  --confidence=0.5 --mappingVersion=mvp-seed-1 --contextNotes="..." --tafsirReference="..."',
  '  --reviewedBy="..." --reviewedAt=2026-09-08',
].join('\n');

function parseArgs(args: string[]): ParsedArgs {
  return args.reduce<ParsedArgs>((parsed, arg) => {
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument "${arg}".\n${usage}`);
    }

    const separatorIndex = arg.indexOf('=');

    if (separatorIndex === -1) {
      throw new Error(`Argument "${arg}" must use --name=value format.\n${usage}`);
    }

    const key = arg.slice(2, separatorIndex);
    const value = arg.slice(separatorIndex + 1);
    const existing = parsed[key];

    if (existing === undefined) {
      parsed[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      parsed[key] = [existing, value];
    }

    return parsed;
  }, {});
}

function one(args: ParsedArgs, key: string) {
  const value = args[key];

  if (Array.isArray(value)) {
    throw new Error(`Argument "--${key}" may only be provided once.`);
  }

  return value;
}

function many(args: ParsedArgs, key: string) {
  const value = args[key];

  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function requireArg(args: ParsedArgs, key: string) {
  const value = one(args, key);

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required argument "--${key}".\n${usage}`);
  }

  return value;
}

function parseStatus(value: string): EmotionMappingStatus {
  if (!emotionMappingStatuses.includes(value as EmotionMappingStatus)) {
    throw new Error(`Invalid status "${value}". Allowed: ${emotionMappingStatuses.join(', ')}.`);
  }

  return value as EmotionMappingStatus;
}

function parseConfidence(value: string | undefined) {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error('Confidence must be a number between 0 and 1.');
  }

  return parsed;
}

function parseReviewDate(value: string | undefined) {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error('reviewedAt must be a valid date.');
  }

  return parsed;
}

async function upsertEmotionMapping() {
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required to upsert an emotion mapping.');
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('Emotion mapping CLI is disabled when NODE_ENV=production.');
  }

  const args = parseArgs(process.argv.slice(2));
  const verseReferenceKey = requireArg(args, 'verse');
  const emotionKey = requireArg(args, 'emotion');
  const status = parseStatus(one(args, 'status') ?? 'development');
  const rationale = one(args, 'rationale');
  const confidence = parseConfidence(one(args, 'confidence'));
  const mappingVersion = one(args, 'mappingVersion') ?? FOUNDATION_MAPPING_VERSION;
  const contextNotes = one(args, 'contextNotes');
  const tafsirReferences = many(args, 'tafsirReference');
  const reviewedBy = one(args, 'reviewedBy');
  const reviewedAt = parseReviewDate(one(args, 'reviewedAt'));

  await connectToDatabase(env.MONGODB_URI);

  if (!isValidVerseKey(verseReferenceKey)) {
    throw new Error(`"${verseReferenceKey}" is not a valid Quran reference.`);
  }

  const emotionExists = await EmotionModel.exists({ key: emotionKey, active: true });

  if (!emotionExists) {
    throw new Error(`Active emotion "${emotionKey}" does not exist.`);
  }

  await EmotionVerseMappingModel.updateOne(
    { verseReferenceKey, emotionKey },
    {
      $set: {
        verseReferenceKey,
        emotionKey,
        status,
        rationale,
        confidence,
        mappingVersion,
        contextNotes,
        tafsirReferences,
        reviewedBy,
        reviewedAt,
      },
    },
    { upsert: true, runValidators: true },
  );

  console.log(`Upserted mapping ${verseReferenceKey} -> ${emotionKey} with status ${status}.`);
}

upsertEmotionMapping()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown mapping CLI error.';
    console.error(`Emotion mapping upsert failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectFromDatabase();
  });
