import { Types } from 'mongoose';

import { rotateRefreshToken, type RotationSessionState, type RotationStore, type RotationUpdate } from '../auth/refreshRotation';
import {
  formatRefreshToken,
  generateRefreshTokenSecret,
  hashRefreshToken,
  parseRefreshToken,
  REFRESH_TOKEN_TTL_MS,
} from '../auth/session';
import { SessionModel } from '../models/Session';
import type { SessionEntity } from '../types/accountDomain';
import type { IssuedSession, SessionRepository } from './SessionRepository';

function expiryFromNow(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
}

/** MongoDB persistence for auth/refreshRotation.ts. compareAndRotate is a single conditional findOneAndUpdate, so concurrent refreshes can never both apply. */
export const mongooseRotationStore: RotationStore = {
  async compareAndRotate(sessionId: string, expectedHash: string, update: RotationUpdate, now: number) {
    if (!Types.ObjectId.isValid(sessionId)) return null;
    const doc = await SessionModel.findOneAndUpdate(
      {
        _id: sessionId,
        refreshTokenHash: expectedHash,
        revokedAt: { $exists: false },
        expiresAt: { $gt: new Date(now) },
      },
      {
        $set: {
          refreshTokenHash: update.refreshTokenHash,
          previousRefreshTokenHash: update.previousRefreshTokenHash,
          rotatedAt: new Date(update.rotatedAt),
          expiresAt: new Date(update.expiresAt),
        },
      },
      { new: true },
    ).lean<SessionEntity>();
    return doc ? doc.userId : null;
  },

  async find(sessionId: string): Promise<RotationSessionState | null> {
    if (!Types.ObjectId.isValid(sessionId)) return null;
    const doc = await SessionModel.findById(sessionId).lean<SessionEntity>();
    if (!doc) return null;
    return {
      userId: doc.userId,
      refreshTokenHash: doc.refreshTokenHash,
      previousRefreshTokenHash: doc.previousRefreshTokenHash,
      rotatedAt: doc.rotatedAt?.getTime(),
      expiresAt: doc.expiresAt.getTime(),
      revokedAt: doc.revokedAt?.getTime(),
    };
  },

  async revoke(sessionId: string, now: number) {
    if (!Types.ObjectId.isValid(sessionId)) return;
    await SessionModel.updateOne({ _id: sessionId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date(now) } });
  },
};

export class MongooseSessionRepository implements SessionRepository {
  async createSession(userId: string): Promise<IssuedSession> {
    const sessionId = new Types.ObjectId();
    const secret = generateRefreshTokenSecret();
    const refreshToken = formatRefreshToken(sessionId.toHexString(), secret);

    await SessionModel.create({
      _id: sessionId,
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: expiryFromNow(),
    });

    return { sessionId: sessionId.toHexString(), refreshToken };
  }

  rotateSession(refreshToken: string): Promise<IssuedSession & { userId: string }> {
    return rotateRefreshToken(mongooseRotationStore, refreshToken);
  }

  async revokeSession(refreshToken: string): Promise<void> {
    const parsed = parseRefreshToken(refreshToken);
    if (!parsed || !Types.ObjectId.isValid(parsed.sessionId)) return;
    await SessionModel.updateOne({ _id: parsed.sessionId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
  }

  async isSessionActive(sessionId: string, userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(sessionId)) return false;
    const session = await SessionModel.findById(sessionId).lean<SessionEntity>();
    if (!session || session.userId !== userId || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      return false;
    }
    return true;
  }
}
