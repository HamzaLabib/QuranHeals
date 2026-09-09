// Local verification server: GET routes only, no seed/migration/index creation.
import mongoose from 'mongoose';
import { createApp } from '../app';
import { env } from '../config/env';

async function main() {
  if (!env.MONGODB_URI || env.NODE_ENV === 'production') throw new Error('Development database required.');
  await mongoose.connect(env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  const server = createApp().listen(4000, '127.0.0.1', () => console.log('Read-only verification API: http://127.0.0.1:4000'));
  const close = () => server.close(() => { void mongoose.disconnect().then(() => process.exit(0)); });
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
main().catch(() => { console.error('Read-only preview could not start. Connection details suppressed.'); process.exitCode = 1; });
