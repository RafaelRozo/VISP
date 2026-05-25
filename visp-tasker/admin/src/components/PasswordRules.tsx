import { useTranslation } from 'react-i18next';
import { evaluatePassword, PasswordRuleKey } from '@/lib/passwordPolicy';

interface Props {
  password: string;
}

const RULES: { key: PasswordRuleKey; i18n: string }[] = [
  { key: 'length', i18n: 'passwordRules.length' },
  { key: 'uppercase', i18n: 'passwordRules.uppercase' },
  { key: 'lowercase', i18n: 'passwordRules.lowercase' },
  { key: 'number', i18n: 'passwordRules.number' },
  { key: 'special', i18n: 'passwordRules.special' },
];

export default function PasswordRules({ password }: Props) {
  const { t } = useTranslation();
  const r = evaluatePassword(password);
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {RULES.map((rule) => {
        const ok = r[rule.key];
        return (
          <li
            key={rule.key}
            className={ok ? 'text-success' : 'text-textTertiary'}
          >
            <span className="inline-block w-4">{ok ? '✓' : '•'}</span>
            {t(rule.i18n)}
          </li>
        );
      })}
    </ul>
  );
}
