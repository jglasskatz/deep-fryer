'use client';

import { useRef, type MouseEvent } from 'react';
import { isPlainClick } from './selection';

/**
 * A source snapshot that enlarges in place, after the Santa Cruz site's
 * lightbox: a plain click on the thumbnail opens it full size over the
 * page, and a click anywhere, the Close button or Escape closes it.
 *
 * The thumbnail stays a real link to the image: without JavaScript, or with
 * a modified click (Cmd/Ctrl for a new tab, a middle click), it opens the
 * snapshot in a new tab as before. The enlarged view is a native modal
 * <dialog>, so the browser keeps focus inside it, closes it on Escape, makes
 * the page behind it inert, and returns focus to the thumbnail afterwards.
 *
 * Snapshots are whole-page captures, about 1280 px wide and often many
 * times taller, so the enlarged view fits the image to the window's width
 * (up to its own) and scrolls down it, with Close kept in view; fitting the
 * whole height would leave a tall page too small to read.
 *
 * The backdrop is the page's own background colour, nearly opaque, so it
 * fades the page in both themes without a colour of its own.
 */
export function EvidenceLightbox({
  src,
  alt,
  closeLabel,
}: {
  src: string;
  /** Names the snapshot: the thumbnail, the enlarged image and the dialog. */
  alt: string;
  closeLabel: string;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  function open(event: MouseEvent<HTMLAnchorElement>) {
    const dialog = dialogRef.current;
    if (!isPlainClick(event) || !dialog || typeof dialog.showModal !== 'function') return;
    event.preventDefault();
    dialog.showModal();
  }

  return (
    <>
      <a href={src} target="_blank" rel="noreferrer" aria-haspopup="dialog" onClick={open} className="inline-block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="max-h-56 cursor-zoom-in rounded border border-black/15" />
      </a>
      <dialog
        ref={dialogRef}
        aria-label={alt}
        // Any click closes it, on the image or the backdrop around it.
        onClick={() => dialogRef.current?.close()}
        className="m-auto max-h-[95vh] w-[min(95vw,1280px)] max-w-none cursor-zoom-out overflow-y-auto rounded-lg border border-black/15 bg-[color:var(--color-bg)] px-3 pb-3 text-[color:var(--color-fg)] backdrop:bg-[color:var(--color-bg)]/90"
      >
        <div className="sticky top-0 flex justify-end bg-[color:var(--color-bg)] py-2">
          <button type="button" autoFocus className="rounded px-3 py-1.5 text-sm underline hover:bg-black/5">
            {closeLabel}
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} loading="lazy" className="block h-auto w-full rounded" />
      </dialog>
    </>
  );
}
