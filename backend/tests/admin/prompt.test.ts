import { describe, expect, it } from 'vitest';

import { chooseIndex, confirmTyped, PromptError, readHidden, readLine } from '../../src/admin/prompt';
import { FakeTerminal, typed } from './adminFakes';

describe('hidden terminal input', () => {
  it('returns what was typed and echoes none of it', async () => {
    const terminal = new FakeTerminal([typed('owner@example.invalid')]);
    expect(await readHidden(terminal.io, 'Email (hidden): ')).toBe('owner@example.invalid');
    expect(terminal.written).toBe('Email (hidden): \n');
    expect(terminal.written).not.toContain('owner');
  });

  it('handles backspace without echoing, and ignores arrow-key escape sequences', async () => {
    const terminal = new FakeTerminal(['ABX\u007fC\u001b[DD\r']);
    expect(await readHidden(terminal.io, 'Code: ')).toBe('ABCD');
    expect(terminal.written).toBe('Code: \n');
  });

  it('switches raw mode on for the prompt and always restores it', async () => {
    const terminal = new FakeTerminal([typed('x'), '\u0003']);
    await readHidden(terminal.io, '');
    await expect(readHidden(terminal.io, '')).rejects.toThrow(PromptError);
    expect(terminal.rawModes).toEqual([true, false, true, false]);
  });

  it('Ctrl+C and end of input cancel', async () => {
    await expect(readHidden(new FakeTerminal(['abc\u0003']).io, '')).rejects.toThrow(/Cancelled/);
    await expect(readHidden(new FakeTerminal([]).io, '')).rejects.toThrow(/Input ended/);
  });

  it('visible input echoes what is typed', async () => {
    const terminal = new FakeTerminal([typed('2')]);
    expect(await readLine(terminal.io, 'Choice: ')).toBe('2');
    expect(terminal.written).toBe('Choice: 2\n');
  });
});

describe('TTY requirement', () => {
  it('refuses when input is not a terminal (piped), or when output is redirected', async () => {
    await expect(readHidden(new FakeTerminal([typed('x')], { tty: false }).io, '')).rejects.toThrow(/interactive terminal/);
    await expect(confirmTyped(new FakeTerminal([typed('yes')], { outputTty: false }).io, '', 'yes')).rejects.toThrow(/interactive terminal/);
  });
});

describe('typed confirmation', () => {
  it('accepts only the exact phrase (case-sensitive, surrounding spaces ignored)', async () => {
    expect(await confirmTyped(new FakeTerminal([typed('  abc123 DELETE ')]).io, '', 'abc123 DELETE')).toBe(true);
    for (const answer of ['abc123 delete', 'abc124 DELETE', 'DELETE', '', 'y']) {
      expect(await confirmTyped(new FakeTerminal([typed(answer)]).io, '', 'abc123 DELETE')).toBe(false);
    }
  });

  it('chooseIndex accepts 1..n only', async () => {
    expect(await chooseIndex(new FakeTerminal([typed('2')]).io, '', 2)).toBe(1);
    for (const answer of ['0', '3', 'one', '']) {
      await expect(chooseIndex(new FakeTerminal([typed(answer)]).io, '', 2)).rejects.toThrow(/No valid choice/);
    }
  });
});
