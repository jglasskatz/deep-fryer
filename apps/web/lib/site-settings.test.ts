import { afterEach, describe, expect, it } from 'vitest';
import { showcaseOrgSlug, termsUrl } from './site-settings';

/** The operator's optional footer and landing settings, read per request from the environment. */
describe('site settings', () => {
  const saved = { TERMS_URL: process.env.TERMS_URL, DF_SHOWCASE_ORG: process.env.DF_SHOWCASE_ORG };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('TERMS_URL: an http(s) address, or no Terms link at all', () => {
    delete process.env.TERMS_URL;
    expect(termsUrl()).toBeNull();
    process.env.TERMS_URL = '   ';
    expect(termsUrl()).toBeNull();
    process.env.TERMS_URL = ' https://city.example.gov/terms ';
    expect(termsUrl()).toBe('https://city.example.gov/terms');
    // A typo or an injection never becomes a link in every page's footer.
    process.env.TERMS_URL = 'javascript:alert(1)';
    expect(termsUrl()).toBeNull();
  });

  it('DF_SHOWCASE_ORG: a well-formed organization slug, or no showcase', () => {
    delete process.env.DF_SHOWCASE_ORG;
    expect(showcaseOrgSlug()).toBeNull();
    process.env.DF_SHOWCASE_ORG = ' NYC ';
    expect(showcaseOrgSlug()).toBe('nyc');
    process.env.DF_SHOWCASE_ORG = '../nyc';
    expect(showcaseOrgSlug()).toBeNull();
  });
});
