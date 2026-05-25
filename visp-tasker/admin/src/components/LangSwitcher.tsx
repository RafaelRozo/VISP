import { useTranslation } from 'react-i18next';

export default function LangSwitcher({ className }: { className?: string }) {
  const { i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? 'en';

  const set = (lng: 'en' | 'fr') => {
    void i18n.changeLanguage(lng);
  };

  return (
    <div className={`inline-flex items-center gap-1 rounded-full border border-glassBorder bg-glass px-1 py-1 text-xs ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => set('en')}
        className={`px-3 py-1 rounded-full transition ${current === 'en' ? 'bg-primary text-white' : 'text-textSecondary hover:text-white'}`}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => set('fr')}
        className={`px-3 py-1 rounded-full transition ${current === 'fr' ? 'bg-primary text-white' : 'text-textSecondary hover:text-white'}`}
      >
        FR
      </button>
    </div>
  );
}
