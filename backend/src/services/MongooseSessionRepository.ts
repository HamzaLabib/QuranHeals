import { Types } from 'mongoose';

import {
  formatRefreshToken,
  generateRefreshTokenSecret,
  hashRefreshToken,
  parseRefreshToken,
  REFRESH_TOKEN_TTL_MS,
} from '../auth/session';
import { AppError } from '../errors/AppError';
import { SessionModel } from '../models/Session';
import type { IssuedSession, SessionRepository } from './SessionRepository';

const INVALID_SESSION_MESSAGE = 'Session is invalid or has expired. Please sign in again.';

function expiryFromNow(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
}

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

  async rotateSession(refreshToken: string): Promise<IssuedSession & { userId: string }> {
    const parsed = parseRefreshToken(refreshToken);
    if (!parsed || !Types.ObjectId.isValid(parsed.sessionId)) {
      throw new AppError(INVALID_SESSION_MESSAGE, 401);
    }

    const session = await SessionModel.findById(parsed.sessionId);
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      throw new AppError(INVALID_SESSION_MESSAGE, 401);
    }

    if (session.refreshTokenHash !== hashRefreshToken(refreshToken)) {
      // The presented token doesn't match this session's current refresh
      // token — either a stale token from before an earlier rotation, or
      // one that was never valid. Either way, treat it as possible
      // theft/reuse and revoke the whole session rather than silently
      // ignoring it ("handle reused/invalid/expired refresh tokens
      // securely").
      session.revokedAt = new Date();
      await session.save();
      throw new AppError(INVALID_SESSION_MESSAGE, 401);
    }

    const nextSecret = generateRefreshTokenSecret();
    const nextRefreshToken = formatRefreshToken(parsed.sessionId, nextSecret);
    session.refreshTokenHash = hashRefreshToken(nextRefreshToken);
    session.expiresAt = expiryFromNow();
    await session.save();

    return { sessionId: parsed.sessionId, refreshToken: nextRefreshToken, userId: session.userId };
  }

  async revokeSession(refreshToken: string): Promise<void> {
    const parsed = parseRefreshToken(refreshToken);
    if (!parsed || !Types.ObjectId.isValid(parsed.sessionId)) return;
    await SessionModel.updateOne({ _id: parsed.sessionId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
  }
}
