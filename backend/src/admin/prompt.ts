/**
 * Interactive terminal input for the admin tools. Sensitive values (email
 * addresses, verification codes) are typed at a hidden prompt instead of
 * being passed as command-line arguments, so they never reach PowerShell
 * history, npm's echoed command line, or process listings. Hidden input is
 * read in raw mode and never echoed.
 *
 * Every prompt requires an interactive terminal on both input and the
 * prompt output: a piped "yes" (or a script) can never answer a prompt or
 * confirm a deletion.
 */

export type TerminalInput = {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  removeListener(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  removeListener(event: 'end', listener: () => void): unknown;
  resume(): unknown;
  pause(): unknown;
};

export type TerminalOutput = { isTTY?: boolean; write(text: string): unknown };

export type TerminalIO = { input: TerminalInput; output: TerminalOutput };

/** Prompts go to stderr, so a redirected stdout (the JSON report) never captures them. */
export function processTerminal(): TerminalIO {
  return { input: process.stdin, output: process.stderr };
}

export class PromptError extends Error {}

export function isInteractive(io: TerminalIO): boolean {
  return io.input.isTTY === true && io.output.isTTY === true && typeof io.input.setRawMode === 'function';
}

export function assertInteractive(io: TerminalIO, purpose: string): void {
  if (!isInteractive(io)) {
    throw new PromptError(`${purpose} needs an interactive terminal (input and output must be a TTY). Nothing was changed.`);
  }
}

const ENTER = new Set(['\r', '\n']);
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = new Set(['\u007f', '\b']);
const ESC = '\u001b';

/**
 * Reads one line in raw mode. `hidden` echoes nothing at all (not even
 * asterisks, which would reveal the length). Ctrl+C or end of input
 * cancels with PromptError. Terminal escape sequences (arrow keys) are
 * ignored.
 */
export async function readLine(io: TerminalIO, question: string, options: { hidden?: boolean } = {}): Promise<string> {
  assertInteractive(io, 'This step');
  const { input, output } = io;
  return new Promise<string>((resolvePrompt, rejectPrompt) => {
    let value = '';
    let inEscape = false;
    let settled = false;

    const finish = (error: PromptError | null) => {
      if (settled) return;
      settled = true;
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.setRawMode!(false);
      input.pause();
      output.write('\n');
      if (error) rejectPrompt(error);
      else resolvePrompt(value);
    };

    const onEnd = () => finish(new PromptError('Input ended. Nothing was changed.'));

    const onData = (chunk: Buffer | string) => {
      for (const char of typeof chunk === 'string' ? chunk : chunk.toString('utf8')) {
        if (settled) return;
        if (inEscape) {
          if (/[A-Za-z~]/.test(char)) inEscape = false;
          continue;
        }
        if (char === ESC) inEscape = true;
        else if (ENTER.has(char)) finish(null);
        else if (char === CTRL_C) finish(new PromptError('Cancelled. Nothing was changed.'));
        else if (char === CTRL_D && value === '') finish(new PromptError('Input ended. Nothing was changed.'));
        else if (BACKSPACE.has(char)) {
          if (value.length > 0) {
            value = value.slice(0, -1);
            if (!options.hidden) output.write('\b \b');
          }
        } else if (char >= ' ') {
          value += char;
          if (!options.hidden) output.write(char);
        }
      }
    };

    output.write(question);
    input.setRawMode!(true);
    input.on('data', onData);
    input.on('end', onEnd);
    input.resume();
  });
}

export function readHidden(io: TerminalIO, question: string): Promise<string> {
  return readLine(io, question, { hidden: true });
}

/** True only if the operator types exactly `expected` (surrounding spaces ignored, case-sensitive). */
export async function confirmTyped(io: TerminalIO, question: string, expected: string): Promise<boolean> {
  const answer = await readLine(io, question);
  return answer.trim() === expected;
}

/** Asks the operator to pick 1..count; anything else cancels. */
export async function chooseIndex(io: TerminalIO, question: string, count: number): Promise<number> {
  const answer = (await readLine(io, question)).trim();
  const choice = /^\d+$/.test(answer) ? Number(answer) : NaN;
  if (!Number.isInteger(choice) || choice < 1 || choice > count) throw new PromptError('No valid choice. Nothing was changed.');
  return choice - 1;
}
