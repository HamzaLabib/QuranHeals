import { UserModel } from '../models/User';
import type { AuthProvider } from '../types/accountDomain';
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
    return toUserDto((await this.upsertByProviderIdentity(identity, true)) as never);
  }

  async findExistingByProviderIdentity(identity: VerifiedProviderIdentity): Promise<UserDto | null> {
    const doc = await this.upsertByProviderIdentity(identity, false);
    return doc ? toUserDto(doc as never) : null;
  }

  /** One atomic findOneAndUpdate; with upsert false a missing account stays missing (null). */
  private upsertByProviderIdentity(identity: VerifiedProviderIdentity, upsert: boolean) {
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

    return UserModel.findOneAndUpdate(
      { provider, providerSubject },
      update,
      upsert ? { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true } : { returnDocument: 'after' },
    ).lean();
  }

  async findById(userId: string): Promise<UserDto | null> {
    const doc = await UserModel.findById(userId).lean();
    return doc ? toUserDto(doc as never) : null;
  }

  async findProviderIdentity(userId: string): Promise<{ provider: AuthProvider; providerSubject: string } | null> {
    const doc = await UserModel.findById(userId).lean<{ provider: AuthProvider; providerSubject: string }>();
    return doc ? { provider: doc.provider, providerSubject: doc.providerSubject } : null;
  }
}
