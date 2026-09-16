import { Schema, model, models } from 'mongoose';

import type { UserSyncKeyEntity } from '../types/accountDomain';

/**
 * Holds the user's reflection master key WRAPPED (encrypted) under a key
 * derived from their separate Sync Passphrase — set up entirely on-device
 * (mobile/src/crypto/reflectionEncryption.ts). This backend stores only the
 * wrapped blob, the salt, and the KDF iteration count: none of those are
 * useful for decryption without the passphrase, which never leaves the
 * device. See docs/reflection-privacy.md.
 */
const userSyncKeySchema = new Schema<UserSyncKeyEntity>(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
    },
    wrappedKey: {
      type: String,
      required: true,
    },
    nonce: {
      type: String,
      required: true,
    },
    salt: {
      type: String,
      required: true,
    },
    kdfIterations: {
      type: Number,
      required: true,
      min: 1,
    },
    encryptionVersion: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  {
    timestamps: true,
  },
);

export const UserSyncKeyModel =
  models.UserSyncKey || model<UserSyncKeyEntity>('UserSyncKey', userSyncKeySchema);
