/**
 * The name under which an archived third-party file is published.
 *
 * GitHub Pages picks a file's content type from its extension and sends no
 * CSP or nosniff header, so an archived web page or script published under its
 * own name would render, and run its publisher's scripts, on this site's
 * origin. A file whose extension a browser renders or runs is published with
 * ".txt" appended, which Pages serves as text/plain. The bytes are unchanged,
 * so a recorded SHA-256 still verifies against the published file. Every
 * other file (PDF, image, JSON, CSV, spreadsheet) keeps its name.
 *
 * The builders, the link code and the published-file contract all use this
 * one list.
 */
export const RENDERABLE_EXTENSIONS = Object.freeze(['.html', '.htm', '.shtml', '.xhtml', '.xht', '.js', '.mjs', '.cjs', '.svg', '.svgz', '.xml', '.xsl', '.xslt']);

/** The file's last extension, lower-cased, or '' when it has none. */
function extensionOf(name) {
  const base = String(name).split('/').pop();
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot).toLowerCase();
}

/** True when a browser would render or run this file under its own name. */
export function isRenderable(name) {
  return RENDERABLE_EXTENSIONS.includes(extensionOf(name));
}

/** The published path of an archived file: unchanged, or with ".txt" appended. */
export function publishedArchiveName(name) {
  return isRenderable(name) ? `${name}.txt` : name;
}
