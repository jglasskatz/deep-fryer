import { describe, expect, it } from 'vitest';
import {
  extractPageWindowExcerpt,
  extractPdfPageWindowFromBytes,
  extractPdfTextPages,
  extractText,
  htmlToText,
  OVERSIZED_PDF_EXCERPT_HEADER,
  parseCitedPageNumbers,
  PDF_PAGE_BREAK,
} from './text-extract.js';
import { scannedPdf, textPdf } from './test/pdf-fixture.js';

describe('extractText: PDF', () => {
  it('reads the text layer of every page, keeping the figures as written', async () => {
    const pdf = textPdf([
      ['Anytown Housing Report (2023)', 'Median rent burden: 42.7% of renter households'],
      ['Households on the waiting list: 1,234'],
    ]);
    const text = await extractText(pdf, 'application/pdf');
    expect(text).toContain('Median rent burden: 42.7% of renter households');
    expect(text).toContain('Households on the waiting list: 1,234');
    expect(text!.split(PDF_PAGE_BREAK)).toHaveLength(2);
  });

  it('gives an empty string for a scanned PDF, which is only a picture of its page', async () => {
    expect(await extractText(scannedPdf(), 'application/pdf')).toBe('');
  });

  it('gives an empty string for a damaged file, without throwing', async () => {
    expect(await extractText(Buffer.from('%PDF-1.4 this is not really a PDF'), 'application/pdf')).toBe('');
  });

  it('recognises a PDF a server labelled only as binary, by its header', async () => {
    const pdf = textPdf([['Life expectancy 79.4 years']]);
    expect(await extractText(pdf, 'application/octet-stream')).toBe('Life expectancy 79.4 years');
    expect(await extractText(pdf)).toBe('Life expectancy 79.4 years');
    expect(await extractText(Buffer.from('not a document'), 'application/octet-stream')).toBeNull();
  });

  it('does not change the bytes it was given', async () => {
    const pdf = textPdf([['Tree canopy 23%']]);
    const copy = Buffer.from(pdf);
    await extractText(pdf, 'application/pdf');
    expect(pdf.equals(copy)).toBe(true);
  });
});

describe('extractText: HTML', () => {
  const page = `<!doctype html>
<html><head><title>Rent burden</title><style>p { color: red }</style>
<script>var figure = "99.9%";</script></head>
<body>
  <nav>Home &rsaquo; Housing</nav>
  <h1>Rent burden in Anytown</h1>
  <p>In 2023, <strong>42.7&nbsp;%</strong> of renter households paid more than 30&percnt; of income.</p>
  <!-- old figure: 38.1% -->
  <table><tr><th>Year</th><th>Share</th></tr><tr><td>2022</td><td>41.0%</td></tr></table>
  <p>Fish &amp; chips &#8212; &#x2264; 5 &lt;b&gt;</p>
  <noscript>Turn on scripts</noscript>
</body></html>`;

  it('reads the words a visitor sees, a line per block, tabs between table cells', async () => {
    const text = await extractText(Buffer.from(page), 'text/html; charset=utf-8');
    expect(text).toContain('Rent burden in Anytown');
    expect(text).toContain('In 2023, 42.7 % of renter households paid more than 30% of income.');
    expect(text).toContain('Year\tShare');
    expect(text).toContain('2022\t41.0%');
    expect(text).toContain('Fish & chips — ≤ 5 <b>');
  });

  it('leaves out what a visitor never sees: head, scripts, styles, comments, noscript', async () => {
    const text = (await extractText(Buffer.from(page), 'text/html'))!;
    expect(text).not.toContain('99.9%');
    expect(text).not.toContain('color: red');
    expect(text).not.toContain('38.1%');
    expect(text).not.toContain('Turn on scripts');
    expect(text.startsWith('Home')).toBe(true);
  });

  it('keeps an unknown entity as written and drops an unclosed tag', () => {
    expect(htmlToText('<p>A &madeup; B</p><div')).toBe('A &madeup; B');
  });

  it('keeps a bare "<" and the figures after it as text', () => {
    expect(htmlToText('<p>a < b and 5 > 3</p>')).toBe('a < b and 5 > 3');
    expect(htmlToText('<p>x<y 3</p> after')).toBe('x<y 3\nafter');
    expect(htmlToText('<p>Rate <5% in 2023</p>')).toBe('Rate <5% in 2023');
  });

  it('decodes the charset the content type names', async () => {
    const latin1 = Buffer.from('<p>Caf\xe9 density: 4.2 per km\xb2</p>', 'latin1');
    expect(await extractText(latin1, 'text/html; charset=iso-8859-1')).toBe('Café density: 4.2 per km²');
  });
});

describe('extractText: CSV', () => {
  it('keeps the rows as they are, without a byte-order mark or carriage returns', async () => {
    const csv = Buffer.from('﻿year,share\r\n2022,41.0\r\n2023,42.7\r\n');
    expect(await extractText(csv, 'text/csv')).toBe('year,share\n2022,41.0\n2023,42.7');
  });
});

describe('extractText: other kinds', () => {
  it('returns null for a kind it does not read, such as a spreadsheet or an image', async () => {
    expect(await extractText(Buffer.from('PK\x03\x04'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBeNull();
    expect(await extractText(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png')).toBeNull();
  });
});

describe('large-PDF page-window excerpt extraction', () => {
  it('parses cited page numbers from URL fragments and prose locators, capping huge ranges', () => {
    expect(parseCitedPageNumbers('https://city.gov/report.pdf#page=14', 'See p. 7 and pp. 20–22')).toEqual([7, 14, 20, 21, 22]);
    // Bogus huge range is capped at 10 pages from start.
    expect(parseCitedPageNumbers(undefined, 'pp. 5-9999')).toHaveLength(10);
  });

  it('splits stored capture text into PDF pages and ignores scanned-PDF markers', () => {
    const stored =
      'Text of the captured page\n\nDownload report\n\nText of the PDF document\n\nPage one\n\f\nPage two\n\f\nPage three\n';
    expect(extractPdfTextPages(stored)).toEqual(['Page one', 'Page two', 'Page three']);
    expect(extractPdfTextPages('Text of the PDF document\n\nThis PDF has no readable text. It may be a scanned image.\n')).toEqual([]);
  });

  it('extracts a bounded window around cited pages and value/keyword hits with an explicit header', () => {
    const pages = Array.from({ length: 20 }, (_, i) => `Page ${i + 1} general background content.`);
    pages[11] = 'Table 4: Renter cost burden reached 54.2% of households in 2024.';

    const byValue = extractPageWindowExcerpt(pages, {
      claimedValue: '54.2%',
      indicatorName: 'Cost-burdened renters',
    });
    expect(byValue.text).toContain(OVERSIZED_PDF_EXCERPT_HEADER);
    expect(byValue.matchBasis).toContain('value_match');
    expect(byValue.pagesIncluded).toEqual([11, 12, 13]);
    expect(byValue.text).toContain('--- Page 12 of 20 ---');
    expect(byValue.text).toContain('54.2%');

    const byLocator = extractPageWindowExcerpt(pages, {
      sourceUrl: 'https://city.gov/huge-report.pdf#page=5',
      locatorText: 'Table on page 5',
    });
    expect(byLocator.matchBasis).toContain('cited_page');
    expect(byLocator.pagesIncluded).toEqual([4, 5, 6]);
  });

  it('falls back to opening pages when nothing matches and strictly bounds output bytes', () => {
    const hugePages = Array.from({ length: 10 }, (_, i) => `Page ${i + 1}: ` + 'x'.repeat(2000));
    const fallback = extractPageWindowExcerpt(hugePages, { indicatorName: 'Unmatched indicator' }, { maxBytes: 1500 });
    expect(fallback.matchBasis).toEqual(['opening_pages']);
    expect(Buffer.byteLength(fallback.text, 'utf8')).toBeLessThanOrEqual(1500);
    expect(fallback.truncated).toBe(true);
    expect(fallback.text).toContain(OVERSIZED_PDF_EXCERPT_HEADER);
  });

  it('extracts a targeted page window directly from PDF bytes', async () => {
    const pdf = textPdf([
      ['Cover page: Annual Environmental Report'],
      ['Chapter 1: Introduction'],
      ['Chapter 2: Methodology'],
      ['Chapter 3: Air Quality — Annual PM2.5 average was 6.51 ug/m3 in 2024'],
      ['Chapter 4: Appendix'],
    ]);
    const excerpt = await extractPdfPageWindowFromBytes(pdf, {
      claimedValue: 6.51,
      indicatorName: 'PM2.5 annual',
    });
    expect(excerpt).not.toBeNull();
    expect(excerpt!.pagesIncluded).toEqual([3, 4, 5]);
    expect(excerpt!.text).toContain('6.51');
    expect(excerpt!.text).toContain(OVERSIZED_PDF_EXCERPT_HEADER);
    expect(await extractPdfPageWindowFromBytes(scannedPdf(), { claimedValue: 6.51 })).toBeNull();
  });
});
