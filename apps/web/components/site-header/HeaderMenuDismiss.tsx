'use client';

import { useEffect } from 'react';
import { onMenuFocusOut, onMenuKeyDown, onMenuPointerDown } from './header-menus';

/**
 * Lets the header's <details> menus close on Escape, on focus leaving them,
 * and on a press outside (rules and reasons in header-menus.ts). Rendered
 * once by SiteHeader; draws nothing. The menus stay plain <details>, so
 * without JavaScript they still open and close from their summaries.
 *
 * The listeners are on document, so they cover menus rendered by server
 * components (LanguageSwitcher) and client ones (RequestTranslation) alike,
 * and keydown runs before DeepFryLayer's listener on window: an Escape spent
 * closing a menu is marked (preventDefault) before the fryer looks at it.
 */
export function HeaderMenuDismiss() {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => onMenuKeyDown(event, document);
    const focusout = (event: FocusEvent) => onMenuFocusOut(event);
    const pointerdown = (event: PointerEvent) => onMenuPointerDown(event, document);
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusout', focusout);
    document.addEventListener('pointerdown', pointerdown);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('focusout', focusout);
      document.removeEventListener('pointerdown', pointerdown);
    };
  }, []);
  return null;
}
