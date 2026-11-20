import { describe, expect, it } from 'vitest';
import { extractText, htmlToText, PDF_PAGE_BREAK } from './text-extract.js';
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
