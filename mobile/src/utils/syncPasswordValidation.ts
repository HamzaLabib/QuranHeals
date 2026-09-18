/** Count Unicode code points; never alter the password used by the KDF. */
export function passwordLengthError(value: string): 'tooShort' | 'tooLong' | null {
  const length = Array.from(value).length;
  return length < 8 ? 'tooShort' : length > 32 ? 'tooLong' : null;
}

export function canSetSyncPassword(password: string, confirmation: string): boolean {
  return passwordLengthError(password) === null && password === confirmation;
}

export function canChangeSyncPassword(current: string, next: string, confirmation: string, verified: boolean): boolean {
  return verified && current !== next && canSetSyncPassword(next, confirmation);
}
