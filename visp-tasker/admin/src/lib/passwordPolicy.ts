/**
 * Admin password policy shared between RedeemInvite and RedeemReset.
 * Minimum 8 chars, with at least one uppercase, one lowercase, one digit,
 * and one special character.
 */

export const MIN_PASSWORD_LENGTH = 8;

export type PasswordRuleKey =
  | 'length'
  | 'uppercase'
  | 'lowercase'
  | 'number'
  | 'special';

const SPECIAL = /[^A-Za-z0-9]/;

export function evaluatePassword(pwd: string): Record<PasswordRuleKey, boolean> {
  return {
    length: pwd.length >= MIN_PASSWORD_LENGTH,
    uppercase: /[A-Z]/.test(pwd),
    lowercase: /[a-z]/.test(pwd),
    number: /\d/.test(pwd),
    special: SPECIAL.test(pwd),
  };
}

export function firstFailingRule(pwd: string): PasswordRuleKey | null {
  const r = evaluatePassword(pwd);
  if (!r.length) return 'length';
  if (!r.uppercase) return 'uppercase';
  if (!r.lowercase) return 'lowercase';
  if (!r.number) return 'number';
  if (!r.special) return 'special';
  return null;
}
