/**
 * Reads a Content Sync snapshot (`{ …envelope, "records": [ {…}, … ], … }`)
 * as a stream, one record at a time: a snapshot is one ~23 MB response with
 * no pagination, and must never be held as one string. The envelope fields
 * around the array are kept and returned.
 */

export class SnapshotFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotFormatError';
  }
}

export type SnapshotEnvelope = Record<string, unknown>;

/** Calls `onRecord` for each element of the top-level `records` array; resolves with the rest of the object. */
export async function readSnapshotStream(
  body: ReadableStream<Uint8Array>,
  onRecord: (record: Record<string, unknown>) => void,
): Promise<{ envelope: SnapshotEnvelope; records: number; bytes: number }> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let head = '';          // text before the records array
  let tail = '';          // text after it
  let phase: 'head' | 'records' | 'tail' = 'head';
  let buffer = '';        // the unfinished record (records phase)
  let scanned = 0;
  let depth = 0;
  let inString = false;
  let escape = false;
  let records = 0;
  let bytes = 0;

  const feed = (text: string) => {
    if (phase === 'head') {
      head += text;
      const key = head.indexOf('"records"');
      if (key < 0) {
        if (head.length > 1 << 20) throw new SnapshotFormatError('No records array in the snapshot');
        return;
      }
      const bracket = head.indexOf('[', key);
      if (bracket < 0) return;
      buffer = head.slice(bracket + 1);
      head = head.slice(0, bracket);
      phase = 'records';
      scanned = 0;
      text = '';
    } else if (phase === 'tail') {
      tail += text;
      return;
    } else {
      buffer += text;
    }
    let start = depth > 0 ? 0 : -1;
    let i = scanned;
    for (; i < buffer.length; i++) {
      const c = buffer[i];
      if (inString) {
        if (escape) escape = false;
        else if (c === '\\') escape = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth < 0) throw new SnapshotFormatError('Unbalanced braces in records');
        if (depth === 0) {
          let record: unknown;
          try {
            record = JSON.parse(buffer.slice(start, i + 1));
          } catch {
            throw new SnapshotFormatError('A record is not valid JSON');
          }
          if (!record || typeof record !== 'object' || Array.isArray(record)) throw new SnapshotFormatError('A record is not an object');
          onRecord(record as Record<string, unknown>);
          records++;
          start = -1;
        }
      } else if (depth === 0 && c === ']') {
        tail = buffer.slice(i + 1);
        buffer = '';
        phase = 'tail';
        return;
      } else if (depth === 0 && c !== ',' && !/\s/.test(c)) {
        throw new SnapshotFormatError('Unexpected value in records');
      }
    }
    // Keep only the unfinished record; resume scanning after what was read.
    if (start >= 0) {
      buffer = buffer.slice(start);
      scanned = i - start;
    } else {
      buffer = '';
      scanned = 0;
    }
  };

  const decode = (value?: Uint8Array) => {
    try {
      return value ? decoder.decode(value, { stream: true }) : decoder.decode();
    } catch {
      throw new SnapshotFormatError('The snapshot is not valid UTF-8');
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      feed(decode(value));
    }
    feed(decode());
  } catch (error) {
    // Format errors and broken connections alike: stop reading; nothing was kept.
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  // `feed` moves the phase forward; TypeScript can't see that through the closure.
  if ((phase as string) !== 'tail') throw new SnapshotFormatError('The snapshot ended before its records did');

  let envelope: unknown;
  try {
    envelope = JSON.parse(`${head}[]${tail}`);
  } catch {
    throw new SnapshotFormatError('The snapshot envelope is not valid JSON');
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new SnapshotFormatError('The snapshot is not an object');
  const result = envelope as SnapshotEnvelope;
  delete result.records;
  return { envelope: result, records, bytes };
}
