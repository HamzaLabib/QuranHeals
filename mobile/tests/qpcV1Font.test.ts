/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

/** The bundled QCF V1 page-61 font is the exact, unmodified King Fahd Complex font from Quran Foundation's CDN. */

const fontPath = resolve(__dirname, '../assets/mushaf/qpc-v1/p61.ttf');
const font = readFileSync(fontPath);

function nameTable(buffer: Buffer): Record<number, string> {
  const tables = buffer.readUInt16BE(4);
  let offset = -1;
  for (let index = 0; index < tables; index += 1) {
    const record = 12 + index * 16;
    if (buffer.toString('ascii', record, record + 4) === 'name') offset = buffer.readUInt32BE(record + 8);
  }
  const count = buffer.readUInt16BE(offset + 2);
  const strings = offset + buffer.readUInt16BE(offset + 4);
  const names: Record<number, string> = {};
  for (let index = 0; index < count; index += 1) {
    const record = offset + 6 + index * 12;
    const platform = buffer.readUInt16BE(record);
    const id = buffer.readUInt16BE(record + 6);
    const length = buffer.readUInt16BE(record + 8);
    const start = strings + buffer.readUInt16BE(record + 10);
    if (platform === 3 && names[id] === undefined) names[id] = Buffer.from(buffer.subarray(start, start + length)).swap16().toString('utf16le');
  }
  return names;
}

describe('bundled QCF V1 page font', () => {
  it('is byte-identical to the recorded download (155,996 bytes, the SHA-256 pinned in qpcV1Fonts.ts)', () => {
    // Read from source: the module itself `require`s the binary font, which Node can't import.
    const pinned = readFileSync(resolve(__dirname, '../src/mushaf/qpcV1Fonts.ts'), 'utf-8').match(/61: '([0-9a-f]{64})'/)?.[1];
    expect(pinned).toBe('34d6a665c9ac4e36539d389571f897ec8622fa795d40359f266a77b2451fc486');
    expect(font.length).toBe(155996);
    expect(createHash('sha256').update(font).digest('hex')).toBe(pinned);
  });

  it('is the King Fahd Complex QCF_P061 font, version 5.10 (TrueType)', () => {
    expect(font.readUInt32BE(0)).toBe(0x00010000);
    const names = nameTable(font);
    expect(names[1]).toBe('QCF_P061');
    expect(names[4]).toBe('QCF_P061');
    expect(names[5]).toBe('version 5.10');
    expect(names[0]).toMatch(/King Fahad Complex/);
  });

  it('only page 61 is bundled — not the 604-page set', () => {
    const fontsSource = readFileSync(resolve(__dirname, '../src/mushaf/qpcV1Fonts.ts'), 'utf-8');
    expect(fontsSource.match(/require\(/g)).toHaveLength(1);
    expect(fontsSource).toMatch(/p61\.ttf/);
  });
});
