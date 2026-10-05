import { Schema, model, models } from 'mongoose';

import type { SessionEntity } from '../types/accountDomain';

const sessionSchema = new Schema<SessionEntity>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    refreshTokenHash: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    revokedAt: {
      type: Date,
    },
    // Hash of the token rotated INTO refreshTokenHash, and when — lets a
    // client that lost the rotation response retry once within a short
    // window (see auth/refreshRotation.ts). Never a raw token.
    previousRefreshTokenHash: {
      type: String,
    },
    rotatedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

// Auto-removes a session document once its refresh token can no longer be
// used, whether it expired naturally or was revoked and never cleaned up
// otherwise — sessions never accumulate unbounded per user.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SessionModel = models.Session || model<SessionEntity>('Session', sessionSchema);
