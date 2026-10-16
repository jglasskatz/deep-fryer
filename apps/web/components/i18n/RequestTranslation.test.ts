import { describe, expect, it } from 'vitest';
import { languageNameIn } from './RequestTranslation';

/** The confirmation names the requested language in the confirmation's own language. */
describe('languageNameIn', () => {
  it('names the language in the language of the sentence around it', () => {
    expect(languageNameIn('en', 'es', 'Español')).toBe('Spanish');
    expect(languageNameIn('en', 'zh-Hant', '繁體中文')).toBe('Traditional Chinese');
    expect(languageNameIn('es', 'bn', 'বাংলা')).toBe('bengalí');
  });

  it("falls back to the language's own name when the runtime cannot name it", () => {
    expect(languageNameIn('en', 'xx-unknown', 'Own name')).toBe('Own name');
    expect(languageNameIn('not a locale tag!', 'es', 'Español')).toBe('Español');
  });
});
