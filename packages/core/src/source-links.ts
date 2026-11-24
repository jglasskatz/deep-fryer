/**
 * Whether a cited link goes to a publisher's home page or a section of its
 * site rather than to the page or document that holds a figure: at most one
 * path segment, no query string, and no file name. `https://www.epa.gov/`
 * and `https://www.epa.gov/water` are; `https://www.epa.gov/water/report.pdf`
 * and `https://data.city.gov/rent?year=2024` are not.
 *
 * A reader cannot check a number from a home or section page, so review
 * flags such citations, and the same rule marks them wherever a portrait's
 * rows are checked. The fragment is ignored: it never changes the page
 * fetched. A string that is not a URL is not judged here (the URL check
 * already fails it), so it reads as false.
 */
export function isHomeOrSectionPage(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.search) return false;
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length > 1) return false;
  return !/\.[a-z0-9]{2,5}$/i.test(parsed.pathname);
}
