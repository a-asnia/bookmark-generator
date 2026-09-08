import { ru } from './ru';
import { en } from './en';

export type Lang = 'ru' | 'en';
type Dict = Record<string, string>;
const dicts: Record<Lang, Dict> = { ru, en };

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem('bf-lang');
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    /* ignore */
  }
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function makeT(lang: Lang): (key: string, vars?: Record<string, string | number>) => string {
  return (key, vars) => {
    let s = dicts[lang][key] ?? dicts.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
}
