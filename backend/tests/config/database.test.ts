import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  connect: vi.fn(),
  disconnect: vi.fn(),
  connectedName: 'quranheals_dev' as string | undefined,
}));

vi.mock('mongoose', () => ({
  default: {
    set: vi.fn(),
    connect: state.connect,
    disconnect: state.disconnect,
    get connection() {
      return { db: state.connectedName ? { databaseName: state.connectedName } : undefined };
    },
  },
}));
vi.mock('../../src/config/env', () => ({ env: state.env }));

import { connectScriptDatabase, connectToDatabase } from '../../src/config/database';

const URI = 'mongodb+srv://user:secret@cluster.example.invalid/?w=majority';

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of Object.keys(state.env)) delete state.env[key];
  delete process.env.QURAN_HEALS_CONFIRM_PRODUCTION_WRITE;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

function setEnv(nodeEnv: string, dbName?: string) {
  Object.assign(state.env, { NODE_ENV: nodeEnv, MONGODB_URI: URI, MONGODB_DB_NAME: dbName });
  state.connectedName = dbName;
}

describe('connectToDatabase (server startup)', () => {
  it('connects production to quranheals_prod with an explicit dbName', async () => {
    setEnv('production', 'quranheals_prod');
    await expect(connectToDatabase()).resolves.toEqual({ environment: 'production', databaseName: 'quranheals_prod' });
    expect(state.connect).toHaveBeenCalledWith(URI, expect.objectContaining({ dbName: 'quranheals_prod' }));
  });

  it.each([
    ['production', undefined],
    ['production', 'test'],
    ['production', 'quranheals_dev'],
    ['development', 'quranheals_prod'],
  ])('refuses %s + %s before ever connecting', async (nodeEnv, dbName) => {
    setEnv(nodeEnv, dbName);
    await expect(connectToDatabase()).rejects.toThrow();
    expect(state.connect).not.toHaveBeenCalled();
  });

  it('disconnects and fails if the server reports a different database than requested', async () => {
    setEnv('production', 'quranheals_prod');
    state.connectedName = 'test';
    await expect(connectToDatabase()).rejects.toThrow(/Connected to database "test" instead of "quranheals_prod"/);
    expect(state.disconnect).toHaveBeenCalled();
  });
});

describe('connectScriptDatabase', () => {
  it('prints the target before connecting', async () => {
    setEnv('development', 'quranheals_dev');
    await connectScriptDatabase({ script: 'seed', writes: true });
    expect(console.error).toHaveBeenCalledWith('[seed] environment=development database=quranheals_dev mode=WRITE');
    expect(state.connect).toHaveBeenCalledWith(URI, expect.objectContaining({ dbName: 'quranheals_dev' }));
  });

  it('refuses production for an unsupported script without connecting', async () => {
    setEnv('production', 'quranheals_prod');
    await expect(connectScriptDatabase({ script: 'seed', writes: true })).rejects.toThrow(/does not support the production database/);
    expect(state.connect).not.toHaveBeenCalled();
  });

  it('allows a supported production write only with the exact confirmation', async () => {
    setEnv('production', 'quranheals_prod');
    const access = { script: 'mapping:deactivate', writes: true, productionSupported: true };
    await expect(connectScriptDatabase(access)).rejects.toThrow(/QURAN_HEALS_CONFIRM_PRODUCTION_WRITE/);
    expect(state.connect).not.toHaveBeenCalled();
    process.env.QURAN_HEALS_CONFIRM_PRODUCTION_WRITE = 'quranheals_prod';
    await expect(connectScriptDatabase(access)).resolves.toMatchObject({ databaseName: 'quranheals_prod' });
  });
});
