import { UserModel } from '../models/User';
import type { UserDto } from '../types/accountDto';
import type { UserRepository, VerifiedProviderIdentity } from './UserRepository';

function toUserDto(doc: {
  _id: unknown;
  provider: string;
  email?: string;
  createdAt?: Date;
}): UserDto {
  return {
    id: String(doc._id),
    provider: doc.provider as UserDto['provider'],
    email: doc.email,
    createdAt: (doc.createdAt ?? new Date()).toISOString(),
  };
}

export class MongooseUserRepository implements UserRepository {
  async findOrCreateByProviderIdentity(identity: VerifiedProviderIdentity): Promise<UserDto> {
    const { provider, providerSubject, email, emailVerified } = identity;

    const update: Record<string, unknown> = {
      $setOnInsert: { provider, providerSubject },
    };
    // Only ever refresh email/emailVerified with a value the provider itself
    // supplied on this sign-in — never clear a previously-recorded email
    // just because a later token omitted it (e.g. Apple only echoes some
    // fields on first authorization).
    if (email !== undefined) {
      (update.$set ??= {} as Record<string, unknown>) as Record<string, unknown>;
      (update.$set as Record<string, unknown>).email = email;
      (update.$set as Record<string, unknown>).emailVerified = emailVerified ?? false;
    }

    const doc = await UserModel.findOneAndUpdate({ provider, providerSubject }, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }).lean();

    return toUserDto(doc as never);
  }

  async findById(userId: string): Promise<UserDto | null> {
    const doc = await UserModel.findById(userId).lean();
    return doc ? toUserDto(doc as never) : null;
  }
}
