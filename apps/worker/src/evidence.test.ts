import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureEvidence,
  classifyExhibit,
  composeReadableText,
  ExhibitRefusedError,
  MAX_SIGN_IN_PAGE_TEXT_CHARS,
  MIN_EXHIBIT_TEXT_CHARS,
  PDF_TEXT_HEADING,
  PDF_WITHOUT_TEXT_NOTE,
  type ExhibitSignals,
} from './evidence.js';
import { findingPayloadSchema } from '@deep-fryer/core';
import type { TenantStorage } from './storage.js';
import { scannedPdf, textPdf } from './test/pdf-fixture.js';

/**
 * captureEvidence drives a real browser over the public internet, so its tests stand in a scripted
 * browser and network for Playwright and the egress guard: each test says what the page shows and
 * what the PDF link returns, and everything after that (the gate, storage, text extraction) is real.
 */
const fake = vi.hoisted(() => ({
  page: { status: 200, contentType: 'text/html', title: '', text: '' },
  pdf: null as Buffer | null,
}));

vi.mock('@deep-fryer/research', () => ({
  assertPublicHttpsUrl: async () => undefined,
  guardedFetch: async () =>
    fake.pdf ? new Response(new Uint8Array(fake.pdf), { status: 200 }) : new Response('gone', { status: 404 }),
}));

vi.mock('playwright-core', () => {
  const response = {
    status: () => fake.page.status,
    headers: () => ({ 'content-type': fake.page.contentType }),
  };
  const page = {
    on: () => undefined,
    goto: async () => response,
    title: async () => fake.page.title,
    locator: () => ({
      innerText: async () => fake.page.text,
      filter: () => ({ count: async () => 0 }),
    }),
    screenshot: async () => Buffer.from('png bytes'),
  };
  const context = { route: async () => undefined, newPage: async () => page, close: async () => undefined };
  return { chromium: { launch: async () => ({ newContext: async () => context, close: async () => undefined }) } };
});

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

/** Tenant storage in memory, refusing to overwrite as the real stores do. */
function memoryStorage(): TenantStorage & { objects: Map<string, { body: Buffer; contentType: string }> } {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  return {
    objects,
    describe: () => 'memory',
    async put(path, body, contentType) {
      if (objects.has(path)) throw new Error(`evidence object already exists: ${path}`);
      objects.set(path, { body, contentType });
      return path;
    },
    async get(path) {
      const object = objects.get(path);
      if (!object) throw new Error('missing');
      return object.body;
    },
  };
}

const REPORT_PAGE =
  'Anytown Housing Report 2023. Median rent burden: 42.7% of renter households paid more than 30% of income. ' +
  'Download the full report (PDF).';

describe('captureEvidence keeps the text research read', () => {
  beforeEach(() => {
    fake.page = { status: 200, contentType: 'text/html; charset=utf-8', title: 'Housing Report | Anytown', text: REPORT_PAGE };
    fake.pdf = null;
  });

  it('stores the text of a captured page, containing its figure, beside the snapshot', async () => {
    const storage = memoryStorage();
    const result = await captureEvidence(storage, 'https://anytown.example.gov/housing/report');
    expect(result.text_path).toMatch(/^evidence\/[0-9a-f]{16}\.txt$/);
    expect(result.text_path!.replace(/\.txt$/, '.png')).toBe(result.snapshot_path);
    expect(result.no_readable_text).toBeUndefined();
    const stored = storage.objects.get(result.text_path!)!;
    expect(stored.contentType).toBe('text/plain; charset=utf-8');
    expect(stored.body.toString('utf8')).toContain('Median rent burden: 42.7%');
  });

  it('stores the text layer of a captured PDF, containing its figure, with the page text', async () => {
    fake.pdf = textPdf([['Table 3. Households on the waiting list: 1,234'], ['Median rent burden 42.7%']]);
    const storage = memoryStorage();
    const result = await captureEvidence(
      storage,
      'https://anytown.example.gov/housing/report',
      'https://anytown.example.gov/housing/report.pdf',
    );
    expect(result.pdf_path).toBeDefined();
    const text = storage.objects.get(result.text_path!)!.body.toString('utf8');
    expect(text).toContain('Households on the waiting list: 1,234');
    expect(text).toContain(PDF_TEXT_HEADING);
    expect(text).toContain(REPORT_PAGE);
  });

  it('stores no text for a scanned PDF, and says the capture had none', async () => {
    // A PDF opened directly: the browser's viewer shows no page text of its own.
    fake.page = { status: 200, contentType: 'application/pdf', title: 'report.pdf', text: '' };
    fake.pdf = scannedPdf();
    const storage = memoryStorage();
    const result = await captureEvidence(storage, 'https://anytown.example.gov/housing/scan.pdf');
    expect(result.pdf_path).toBeDefined();
    expect(result.text_path).toBeUndefined();
    expect(result.no_readable_text).toBe(true);
    expect([...storage.objects.keys()].some((key) => key.endsWith('.txt'))).toBe(false);
    // The result reaches the researcher as JSON and is copied into the finding's evidence.
    expect(JSON.parse(JSON.stringify(result))).toMatchObject({ no_readable_text: true });
  });

  it('still captures when the text copy cannot be stored', async () => {
    const storage = memoryStorage();
    const put = storage.put.bind(storage);
    storage.put = async (path, body, contentType) => {
      if (path.endsWith('.txt')) throw new Error('store unavailable');
      return put(path, body, contentType);
    };
    const result = await captureEvidence(storage, 'https://anytown.example.gov/housing/report');
    expect(result.snapshot_path).toMatch(/\.png$/);
    expect(result.text_path).toBeUndefined();
    expect(result.no_readable_text).toBeUndefined();
  });

  it('stores nothing, text included, for a page the gate refuses', async () => {
    fake.page = { status: 403, contentType: 'text/html', title: 'Just a moment...', text: 'Verifying' };
    const storage = memoryStorage();
    await expect(captureEvidence(storage, 'https://anytown.example.gov/housing/report')).rejects.toThrow(ExhibitRefusedError);
    expect(storage.objects.size).toBe(0);
  });
});

describe('composeReadableText', () => {
  it('stores a page alone as its text', () => {
    expect(composeReadableText('  Rent burden 42.7%  ')).toBe('Rent burden 42.7%\n');
  });

  it('has nothing to store when neither the page nor its PDF has words', () => {
    expect(composeReadableText('')).toBeNull();
    expect(composeReadableText(' \n\t ', '')).toBeNull();
  });

  it('keeps a page with text and notes a PDF without any', () => {
    const text = composeReadableText('Rent burden 42.7%', '')!;
    expect(text).toContain('Rent burden 42.7%');
    expect(text).toContain(PDF_WITHOUT_TEXT_NOTE);
  });

  it('adds no digits of its own, so a search for a figure finds only the source\'s', () => {
    const text = composeReadableText('words', 'more words')!;
    expect(text).not.toMatch(/\d/);
    expect(PDF_WITHOUT_TEXT_NOTE).not.toMatch(/\d/);
  });
});

describe('the capture result as a finding\'s evidence', () => {
  const finding = (evidence: Record<string, unknown>) => ({
    kind: 'indicator',
    indicator_slug: 'rent-burden',
    name: 'Rent burden',
    value: 42.7,
    unit: '% of households',
    year: 2023,
    target: 30,
    level_pct: 42,
    scoring: { threshold_ref: 'housing.rent', function: 'lower_is_better', inputs: {}, worked_math: '' },
    source: 'Anytown Housing Report',
    source_url: 'https://anytown.example.gov/housing/report',
    source_tier: 1,
    evidence,
    confidence: 'high',
    geographic_scale: 'city',
  });

  beforeEach(() => {
    fake.page = { status: 200, contentType: 'text/html', title: 'Housing Report | Anytown', text: REPORT_PAGE };
    fake.pdf = null;
  });

  it('keeps the text path and the no-text mark when copied into a finding', async () => {
    const withText = await captureEvidence(memoryStorage(), 'https://anytown.example.gov/housing/report');
    const parsed = findingPayloadSchema.parse(finding(JSON.parse(JSON.stringify(withText))));
    expect(parsed.kind === 'indicator' && parsed.evidence.text_path).toBe(withText.text_path);

    fake.page = { status: 200, contentType: 'application/pdf', title: 'scan.pdf', text: '' };
    fake.pdf = scannedPdf();
    const scanned = await captureEvidence(memoryStorage(), 'https://anytown.example.gov/housing/scan.pdf');
    const parsedScan = findingPayloadSchema.parse(finding(JSON.parse(JSON.stringify(scanned))));
    expect(parsedScan.kind === 'indicator' && parsedScan.evidence.no_readable_text).toBe(true);
  });

  it('accepts older evidence that has neither, and refuses a text path outside the evidence folder', () => {
    const older = { snapshot_path: 'evidence/old001.png', captured_at: '2026-10-23T00:00:00Z' };
    expect(findingPayloadSchema.safeParse(finding(older)).success).toBe(true);
    expect(findingPayloadSchema.safeParse(finding({ ...older, text_path: '../other-tenant/evidence/x.txt' })).success).toBe(false);
    expect(findingPayloadSchema.safeParse(finding({ ...older, text_path: 'evidence/x.png' })).success).toBe(false);
    expect(findingPayloadSchema.safeParse(finding({ ...older, no_readable_text: false })).success).toBe(false);
  });
});
