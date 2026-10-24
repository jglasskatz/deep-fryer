'use client';
import { useRef, type ReactNode } from 'react';

/** Progressive enhancement: the server-rendered links and data remain usable
 * without JavaScript. Pointer and keyboard exploration share highlighting. */
export function LinkedInsights({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const highlight = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : null;
    const dimension = element?.closest<HTMLElement>('[data-insight-dimension]')?.dataset.insightDimension;
    const member = element?.closest<HTMLElement>('[data-insight-member]')?.dataset.insightMember;
    for (const node of root.current?.querySelectorAll<HTMLElement>('[data-insight-dimension], [data-insight-member]') ?? []) {
      node.toggleAttribute('data-linked-dimension', Boolean(dimension && node.dataset.insightDimension === dimension));
      node.toggleAttribute('data-muted-member', Boolean(member && node.dataset.insightMember && node.dataset.insightMember !== member));
    }
  };
  return <div ref={root} className="linked-insights" onPointerOver={event => highlight(event.target)} onPointerLeave={() => highlight(null)} onFocus={event => highlight(event.target)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) highlight(null); }}>
    <style>{`.linked-insights [data-muted-member]{opacity:.35}.linked-insights [data-linked-dimension]{outline:2px solid var(--color-accent,#35684b);outline-offset:2px}.linked-insights tr[data-linked-dimension]{outline-offset:-2px}`}</style>
    {children}
  </div>;
}
