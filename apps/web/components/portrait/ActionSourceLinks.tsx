export interface ActionSourceView {
  text: string;
  sourceHref: string | null;
  snapshotHref: string;
  pdfHref: string | null;
}
/** Archived support stays beside an action in both the panel and full page. */
export function ActionSourceLinks({ source }: { source?: ActionSourceView }) {
  if (!source) return null;
  return <span lang="en" className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
    {source.sourceHref ? <a className="underline" href={source.sourceHref} rel="noopener noreferrer">Source ↗</a> : null}
    <a className="underline" href={source.snapshotHref}>Archived evidence</a>
    {source.pdfHref ? <a className="underline" href={source.pdfHref}>Archived PDF</a> : null}
  </span>;
}
