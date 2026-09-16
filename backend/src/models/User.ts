import { Schema, model, models } from 'mongoose';

import type { AuthProvider, UserEntity } from '../types/accountDomain';

export const AUTH_PROVIDERS: AuthProvider[] = ['apple', 'google'];

const userSchema = new Schema<UserEntity>(
  {
    provider: {
      type: String,
      required: true,
      enum: AUTH_PROVIDERS,
    },
    // Apple/Google's own stable subject identifier for this user — never a
    // client-supplied value; always taken from a verified identity token
    // (see backend/src/auth/*Verifier.ts).
    providerSubject: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    emailVerified: {
      type: Boolean,
    },
  },
  {
    timestamps: true,
  },
);

// One account per verified (provider, providerSubject) pair. Signing in with
// a different provider — even the same real person — creates a separate
// account in this phase; see UserEntity's doc comment.
userSchema.index({ provider: 1, providerSubject: 1 }, { unique: true });

export const UserModel = models.User || model<UserEntity>('User', userSchema);
