/**
 * Builds small, valid PDF files in memory for tests, so no binary fixture is checked in.
 *
 * textPdf(pages) gives a PDF with a real text layer: each page draws its lines in Helvetica, one of
 * the fonts every PDF reader carries. scannedPdf() gives what a scanner produces: a page that is only
 * a picture, with no text layer at all.
 */

/** Escapes a string for a PDF literal string: backslash and both parentheses. */
function pdfString(text: string): string {
  return `(${text.replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

/** Assembles numbered objects into a PDF with a correct cross-reference table. */
function assemble(objects: string[]): Buffer {
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

function stream(content: string): string {
  return `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
}

/** A PDF whose page i shows the lines of pages[i] as real text. */
export function textPdf(pages: string[][]): Buffer {
  // 1 catalog, 2 page tree, 3 font, then a page object and its content stream per page.
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  pages.forEach((lines, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    const drawn = lines.map((line, j) => `BT /F1 12 Tf 72 ${720 - j * 20} Td ${pdfString(line)} Tj ET`).join('\n');
    objects.push(stream(drawn));
  });
  return assemble(objects);
}

/** A one-page PDF that is only an image (a 2x2 grey picture scaled to the page): no text layer. */
export function scannedPdf(): Buffer {
  const pixels = '\x80\x80\x80\x80';
  return assemble([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>',
    stream('q 612 0 0 792 0 0 cm /Im1 Do Q'),
    `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n${pixels}\nendstream`,
  ]);
}
