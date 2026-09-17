/**
 * The GitHub-style typed-confirmation check for permanent account deletion
 * (DeleteAccountSheet.tsx) — a deliberate exact match against the
 * locale-specific confirmation word (messages.deleteAccount.confirmationWord),
 * never a partial/case-insensitive one. Only accidental leading/trailing
 * whitespace is forgiven.
 */
export function isValidDeleteConfirmation(typedText: string, requiredWord: string): boolean {
  return typedText.trim() === requiredWord;
}
