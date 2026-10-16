import { describe, expect, it } from 'vitest';
import {
  classifyExhibit,
  ExhibitRefusedError,
  MAX_SIGN_IN_PAGE_TEXT_CHARS,
  MIN_EXHIBIT_TEXT_CHARS,
  type ExhibitSignals,
} from './evidence.js';

/**
 * The exhibit gate decides, from what a loaded page reports about itself, whether its snapshot may
 * stand as a finding's evidence. classifyExhibit is pure, so it is exercised here on plain signals —
 * no browser. Both directions matter: a block page archived as evidence misleads reviewers and the
 * public drilldown, and a real source refused costs the researcher that source. So the titles below
 * are real ones of both kinds, including data pages whose titles look dangerous to a careless regex.
 */

/** A healthy data page: 200, HTML, a real title, plenty of text, no password field. */
const page = (over: Partial<ExhibitSignals> = {}): ExhibitSignals => ({
  status: 200,
  contentType: 'text/html; charset=utf-8',
  title: 'Rent Burden by Borough, 2023 | NYC Open Data',
  visibleText: 'Median gross rent as a share of household income, by borough. '.repeat(10),
  passwordFields: 0,
  ...over,
});

const codes = (signals: ExhibitSignals) => classifyExhibit(signals).map((p) => p.code);

describe('classifyExhibit', () => {
  it('archives an ordinary data page', () => {
    expect(classifyExhibit(page())).toEqual([]);
  });

  it('refuses an HTTP error status, and only from 400 up', () => {
    expect(codes(page({ status: 403 }))).toEqual(['http_status']);
    expect(codes(page({ status: 404 }))).toEqual(['http_status']);
    expect(codes(page({ status: 503 }))).toEqual(['http_status']);
    expect(classifyExhibit(page({ status: 429 }))[0]!.detail).toBe('the server answered HTTP 429');
    expect(codes(page({ status: 399 }))).toEqual([]);
    expect(codes(page({ status: 304 }))).toEqual([]);
    // No response object (Playwright returns null for some navigations): nothing to judge, no refusal.
    expect(codes(page({ status: undefined }))).toEqual([]);
  });

  it.each([
    'Just a moment...',
    'Just a moment…',
    'Attention Required! | Cloudflare',
    'Access denied | data.example.gov used Cloudflare to restrict access',
    'reCAPTCHA',
    'hCaptcha challenge',
    'Access Denied',
    'Sucuri WebSite Firewall - Access Denied',
    'Access to this page has been denied.',
    'Pardon Our Interruption',
    'Request Rejected',
    'Request unsuccessful. Incapsula incident ID: 0-123',
    'The requested URL was rejected. Please consult with your administrator.',
    'DDoS-Guard',
    'Web Page Blocked',
    'Sorry, you have been blocked',
    'Checking your browser before accessing example.gov',
    'Are you a robot?',
    'Robot or human?',
    'Robot Check',
    'Bot Verification',
    'Verifying you are human. This may take a few seconds.',
    'Please verify that you\'re a human',
    'Human Verification',
    'Security Check Required',
    '403 Forbidden',
    '403 - Forbidden: Access is denied.',
    '404 Not Found',
    '404 - File or directory not found.',
    '404 Error',
    'Error 404',
    'Error: 500',
    '500 Internal Server Error',
    '502 Bad Gateway',
    '503 Service Temporarily Unavailable',
    '504 Gateway Time-out',
    '429 Too Many Requests',
    'Forbidden',
    'Not Found',
    'Service Unavailable',
    'Page Not Found | NYC Health',
    'The page cannot be found',
    '  Just   a moment...  ',
  ])('refuses the block, challenge, or error title %j', (title) => {
    expect(codes(page({ title }))).toEqual(['block_title']);
  });

  it.each([
    // Leading numbers that are not status codes.
    '500 Cities: Local Data for Better Health',
    '311 Service Requests from 2010 to Present',
    '2023 Community Health Profile: The Bronx',
    '404 Park Avenue South - Building Energy Report',
    // Words block pages use, inside real titles.
    'Access Denied: Barriers to Health Care in New York City',
    'Access to Care | NYC Health',
    'Food Security Checklist for Families',
    'Security checkpoint wait times',
    'Human Development Index (HDI)',
    'Not Found in the Census: Undercounted Communities',
    'Errors in Air Quality Monitoring: A Review',
    'Service Requests Unavailable for Your Area? Read This First',
    'Cloudflare Radar 2024 Year in Review',
    'Moment of truth for the city budget',
    '',
  ])('archives the real data-page title %j', (title) => {
    expect(codes(page({ title }))).toEqual([]);
  });

  it('quotes a refused title as data, and only a bounded slice of it', () => {
    const title = `Access denied | ${'x'.repeat(300)} used Cloudflare to restrict access`;
    const [problem] = classifyExhibit(page({ title }));
    expect(problem!.code).toBe('block_title');
    expect(problem!.detail).toBe(
      `the page title ${JSON.stringify(title.slice(0, 80))} is a block, challenge, or error page`,
    );
  });

  it('refuses a near-empty HTML page, counting text with whitespace collapsed', () => {
    const justUnder = 'x'.repeat(MIN_EXHIBIT_TEXT_CHARS - 1);
    expect(codes(page({ visibleText: '' }))).toEqual(['near_empty']);
    expect(codes(page({ visibleText: 'Loading…' }))).toEqual(['near_empty']);
    expect(codes(page({ visibleText: `\n\n   ${justUnder}   \n\t` }))).toEqual(['near_empty']);
    // Runs of whitespace between words count as one character, so layout padding cannot fake content.
    expect(codes(page({ visibleText: 'word \n\n\n\t   '.repeat(19) }))).toEqual(['near_empty']);
    expect(codes(page({ visibleText: 'x'.repeat(MIN_EXHIBIT_TEXT_CHARS) }))).toEqual([]);
    expect(classifyExhibit(page({ visibleText: 'Please wait' }))[0]!.detail).toBe(
      'the page shows only 11 characters of text (a blank, loading, or blocked page)',
    );
  });

  it('applies the text check to HTML (or an unlabeled document) only', () => {
    expect(codes(page({ visibleText: '', contentType: undefined }))).toEqual(['near_empty']);
    expect(codes(page({ visibleText: '', contentType: 'application/xhtml+xml' }))).toEqual(['near_empty']);
    // An image, a PDF in the viewer, CSV or JSON shows its content without carrying it as page text.
    expect(codes(page({ visibleText: '', contentType: 'image/png' }))).toEqual([]);
    expect(codes(page({ visibleText: '', contentType: 'application/pdf' }))).toEqual([]);
    expect(codes(page({ visibleText: '', contentType: 'text/csv' }))).toEqual([]);
    expect(codes(page({ visibleText: '{}', contentType: 'application/json' }))).toEqual([]);
  });

  it('refuses a sign-in form: a password field on a page with little else', () => {
    const signIn =
      'Skip to main content City of Anytown Permit Portal Sign in Username Password Remember me Sign in ' +
      'Forgot your password? Need an account? Contact the Department of Buildings. Privacy Accessibility';
    expect(codes(page({ title: 'Sign In | Permit Portal', visibleText: signIn, passwordFields: 1 }))).toEqual([
      'password_field',
    ]);
    expect(codes(page({ visibleText: signIn, passwordFields: 2 }))).toEqual(['password_field']);
    expect(classifyExhibit(page({ visibleText: signIn, passwordFields: 1 }))[0]!.detail).toBe(
      `the page is a sign-in form (a password field and only ${signIn.length} characters of text), not a document`,
    );
  });

  it('archives a document that carries a login box beside its text', () => {
    // An older .gov CMS page: the profile itself, with the theme's sidebar "User login" block (a plain
    // <div>, so readExhibitSignals counts it). The document's text is what decides.
    const profile = 'Life expectancy at birth in Anytown County was 79.4 years in 2023, up from 78.9. '.repeat(60);
    expect(profile.length).toBeGreaterThan(4_000);
    expect(
      codes(page({ title: 'Community Health Profile 2023 | Anytown County', visibleText: profile, passwordFields: 1 })),
    ).toEqual([]);
  });

  it('draws the sign-in line at MAX_SIGN_IN_PAGE_TEXT_CHARS, with whitespace collapsed', () => {
    const under = 'x'.repeat(MAX_SIGN_IN_PAGE_TEXT_CHARS - 1);
    expect(codes(page({ visibleText: under, passwordFields: 1 }))).toEqual(['password_field']);
    expect(codes(page({ visibleText: `${under}x`, passwordFields: 1 }))).toEqual([]);
    // Padding cannot carry a sign-in form over the line.
    const padded = `${under.slice(0, 700)}\n\n\n\n${' '.repeat(2_000)}`;
    expect(codes(page({ visibleText: padded, passwordFields: 1 }))).toEqual(['password_field']);
    // A short page with no password field is no sign-in form: only the near-empty line applies to it.
    expect(codes(page({ visibleText: under.slice(0, 200), passwordFields: 0 }))).toEqual([]);
  });

  it('names every problem at once, in a fixed order', () => {
    const challenge = { status: 403, title: 'Just a moment...', visibleText: 'Verifying', passwordFields: 1 };
    expect(codes(page(challenge))).toEqual(['http_status', 'block_title', 'near_empty', 'password_field']);
  });
});

describe('ExhibitRefusedError', () => {
  it('tells the researcher what was wrong and what to do instead', () => {
    const problems = classifyExhibit(page({ status: 403, title: 'Access Denied' }));
    const err = new ExhibitRefusedError(problems);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ExhibitRefusedError');
    expect(err.problems).toBe(problems);
    // session.ts reports it as {"error": "capture failed: <message>"}.
    expect(err.message).toBe(
      'not archived as evidence: the server answered HTTP 403; the page title "Access Denied" is a block, ' +
        'challenge, or error page. The browser did not reach the source document, so a snapshot would not show ' +
        'the value. Retry capture_evidence once if the block may be temporary; otherwise choose another source ' +
        'for this value.',
    );
  });
});
