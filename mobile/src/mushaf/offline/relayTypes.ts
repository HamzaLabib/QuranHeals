/** The relay's interface and errors, without the network code (so tests and logic stay platform-free). */

export class RelayError extends Error {
  constructor(message: string, readonly kind: 'offline' | 'unavailable' | 'http') {
    super(message);
    this.name = 'RelayError';
  }
}

export type OfflineRelay = {
  manifest(): Promise<unknown>;
  /** One chunk's JSON text, exactly as served (it is SHA-256-verified before use). */
  chunk(version: string, index: number): Promise<string>;
};
