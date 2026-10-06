import { Schema, model, models } from 'mongoose';

import type { AppleCredentialEntity } from '../types/accountDomain';

/**
 * Holds an Apple refresh token, encrypted at rest (crypto/
 * appleCredentialEncryption.ts), obtained by exchanging a Sign in with
 * Apple authorization code — stored only so account deletion can later
 * revoke this app's Apple authorization for this user. One document per
 * Apple-authenticated user; deleted as part of account deletion.
 */
const appleCredentialSchema = new Schema<AppleCredentialEntity>(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
    },
    ciphertext: {
      type: String,
      required: true,
    },
    iv: {
      type: String,
      required: true,
    },
    authTag: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

export const AppleCredentialModel =
  models.AppleCredential || model<AppleCredentialEntity>('AppleCredential', appleCredentialSchema);
