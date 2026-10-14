'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { escapeUnfries } from '@/lib/theme';
import { getServerThemeState, getThemeState, setFried, subscribeThemeState } from './theme-dom';

/**
 * Stickers on a fried page: fixed, hand-placed positions (deterministic —
 * the same page always fries the same way, and nothing jumps between
 * renders). They hug the edges, clear of the header row and the reading
 * column's centre. Physical left/right on purpose: they are decoration, not
 * layout, so a right-to-left page fries identically.
 */
const STICKERS: { emoji: string; at: CSSProperties; tilt: string }[] = [
  { emoji: '🔥', at: { top: '16%', left: '2%' }, tilt: '-14deg' },
  { emoji: '💯', at: { top: '28%', right: '3%' }, tilt: '12deg' },
  { emoji: '😂', at: { bottom: '20%', left: '4%' }, tilt: '9deg' },
  { emoji: '👌', at: { bottom: '7%', right: '8%' }, tilt: '-10deg' },
  { emoji: '🍩', at: { top: '56%', right: '1%' }, tilt: '22deg' },
];

/**
 * Everything the deep fry needs beyond the CSS filter (app/globals.css),
 * rendered once by the root layout so it works on every page — including
 * after client-side navigation to a page without the header toggle:
 *
 * - the grain and sticker overlay while <html data-fried> is set — aria-
 *   hidden and click-through, so the page underneath stays fully usable;
 * - a polite live region announcing "fried" / "restored" (only on change,
 *   never on page load);
 * - Escape un-fries — but only an Escape nothing else wanted
 *   (lib/theme.ts escapeUnfries): not one a widget already handled (the
 *   theme menu closing itself calls preventDefault), not one cancelling an
 *   IME composition, and not one pressed in a text field or dialog. The
 *   listener is on window so it runs after React's handlers on document.
 *
 * Labels come from the root layout in the request's language (m.theme).
 */
export function DeepFryLayer({ fried: friedLabel, unfried: unfriedLabel }: { fried: string; unfried: string }) {
  const { fried } = useSyncExternalStore(subscribeThemeState, getThemeState, getServerThemeState);
  const [announcement, setAnnouncement] = useState('');
  const previous = useRef<boolean | null>(null);

  useEffect(() => {
    if (previous.current !== null && previous.current !== fried) {
      setAnnouncement(fried ? friedLabel : unfriedLabel);
    }
    previous.current = fried;
  }, [fried, friedLabel, unfriedLabel]);

  useEffect(() => {
    if (!fried) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (escapeUnfries(event)) setFried(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fried]);

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {fried ? (
        <div aria-hidden="true" className="df-fry-layer">
          {STICKERS.map((s, i) => (
            <span
              key={s.emoji}
              className="df-fry-sticker"
              style={{ ...s.at, '--df-tilt': s.tilt, animationDelay: `${i * 70}ms` } as CSSProperties}
            >
              {s.emoji}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}
