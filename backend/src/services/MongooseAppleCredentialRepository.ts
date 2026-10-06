import { AppleCredentialModel } from '../models/AppleCredential';
import { decryptAppleRefreshToken, encryptAppleRefreshToken } from '../crypto/appleCredentialEncryption';
import type { AppleCredentialEntity } from '../types/accountDomain';
import type { AppleCredentialRepository } from './AppleCredentialRepository';

export class MongooseAppleCredentialRepository implements AppleCredentialRepository {
  async save(userId: string, refreshToken: string): Promise<void> {
    const encrypted = encryptAppleRefreshToken(refreshToken);
    await AppleCredentialModel.findOneAndUpdate(
      { userId },
      { $set: { userId, ...encrypted } },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }

  async get(userId: string): Promise<string | null> {
    const doc = await AppleCredentialModel.findOne({ userId }).lean<AppleCredentialEntity>();
    if (!doc) return null;
    return decryptAppleRefreshToken(doc);
  }

  async delete(userId: string): Promise<void> {
    await AppleCredentialModel.deleteOne({ userId });
  }
}
