export type AuthProvider = 'apple' | 'google';

export type AuthUser = {
  id: string;
  provider: AuthProvider;
  email?: string;
  createdAt: string;
};

export type AuthStatus = 'loading' | 'guest' | 'signed-in';
