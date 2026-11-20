import { z } from 'zod';
import type { TenantBranding } from '@deep-fryer/core';

/**
 * A portrait's own look on its public pages: a logo beside its name in the
 * header, a strip of its colour along the header's lower edge, and a font
 * from a fixed list. The owner sets them in Settings (SettingsForms); the
 * server action (lib/actions.ts updateBranding) checks them with the same
 * rules as the form, and SiteHeader draws them.
 *
 * No React, database or server-only imports: the settings form (a client
 * component) and the server action both use this module.
 */

/* ---------------------------------------------------------------- fonts */

export interface BrandFont {
  key: string;
  label: string;
  /** The CSS font-family list the portrait's pages use; null keeps the app's own. */
  stack: string | null;
}

/**
 * The fonts a portrait may pick. Inter ships with the app (app/layout.tsx);
 * the others are faces every reader's device already has, so choosing one
 * loads nothing from anywhere. The first entry is the default and is stored
 * as no font at all.
 */
export const BRAND_FONTS: readonly BrandFont[] = [
  { key: 'inter', label: 'Inter (the standard font)', stack: null },
  {
    key: 'system',
    label: 'The font of the visitor’s own device',
    stack: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },
  {
    key: 'serif',
    label: 'A classic serif, like Georgia',
    stack: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
  },
];

export const DEFAULT_BRAND_FONT = BRAND_FONTS[0]!.key;

export function brandFont(key: string | null | undefined): BrandFont | undefined {
  return BRAND_FONTS.find((f) => f.key === key);
}

/* ---------------------------------------------------------------- colour */

/**
 * The page background in each theme (--color-bg in app/globals.css; the
 * branding test checks they still match). The colour strip has to show
 * against both, because a reader may have either.
 */
export const PAGE_BACKGROUNDS = { light: '#fafaf7', dark: '#121411' } as const;

/**
 * The strip is a graphic, not text, so it needs the non-text contrast of
 * WCAG 1.4.11 (3 to 1) against the page. Text contrast (4.5 to 1) against
 * both a near-white and a near-black page cannot be met by any one colour.
 */
export const BRAND_COLOUR_MIN_CONTRAST = 3;

export const HEX_COLOUR_RE = /^#[0-9a-f]{6}$/i;

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The WCAG contrast ratio of two #rrggbb colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const ratioText = (r: number) => `${(Math.floor(r * 10) / 10).toFixed(1)} to 1`;

/**
 * Why a colour cannot be used, in words an owner can act on, or null when it
 * shows clearly on both the light and the dark page.
 */
export function brandColourProblem(colour: string): string | null {
  if (!HEX_COLOUR_RE.test(colour)) return 'Pick a colour from the colour picker.';
  const light = contrastRatio(colour, PAGE_BACKGROUNDS.light);
  if (light < BRAND_COLOUR_MIN_CONTRAST) {
    return `This colour is too pale to see on the light page (contrast ${ratioText(light)}; it needs at least 3 to 1). Pick a darker one.`;
  }
  const dark = contrastRatio(colour, PAGE_BACKGROUNDS.dark);
  if (dark < BRAND_COLOUR_MIN_CONTRAST) {
    return `This colour is too dark to see on the dark page (contrast ${ratioText(dark)}; it needs at least 3 to 1). Pick a lighter one.`;
  }
  return null;
}

/* ---------------------------------------------------------------- logo */

/** A logo is a small picture; this also keeps the upload under the server's request limit. */
export const MAX_LOGO_BYTES = 500 * 1024;

export const LOGO_TOO_LARGE = 'The logo file is too large. Please use a picture under 500 KB.';
export const LOGO_WRONG_TYPE = 'The logo must be a PNG, JPEG or WebP picture.';

export interface LogoKind {
  ext: 'png' | 'jpg' | 'webp';
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
}

/**
 * What kind of picture the bytes are, read from the bytes themselves (a
 * file's name and declared type are the sender's claim). Only raster
 * formats: an SVG can carry script.
 */
export function sniffLogo(bytes: Uint8Array): LogoKind | null {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', contentType: 'image/png' };
  if (starts([0xff, 0xd8, 0xff])) return { ext: 'jpg', contentType: 'image/jpeg' };
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) {
    return { ext: 'webp', contentType: 'image/webp' };
  }
  return null;
}

/**
 * Where uploaded logos live in the portrait's storage. `logo_url` holds this
 * storage path, not a full address, so the public address follows the
 * deployment's storage settings; anything else in it is never drawn.
 */
export const LOGO_PATH_RE = /^branding\/logo-[a-z0-9-]+\.(?:png|jpg|webp)$/;

export function logoStoragePath(kind: LogoKind, now: Date, random: string): string {
  return `branding/logo-${now.getTime().toString(36)}-${random}.${kind.ext}`;
}

/**
 * The branding as the open-data API sends it. A stored logo path is turned
 * into the logo's full public address (`absoluteUrl` gives null when it
 * cannot make one, and the logo is then left out); a full https address
 * stored some other way is passed on as it is; anything else in logo_url is
 * left out, since no reader of the API could load it. Other keys are passed
 * on as stored.
 */
export function publicBranding(
  branding: TenantBranding | null | undefined,
  absoluteUrl: (storagePath: string) => string | null,
): TenantBranding | null {
  if (!branding) return branding ?? null;
  const { logo_url: logo, ...rest } = branding;
  const address = !logo ? null : LOGO_PATH_RE.test(logo) ? absoluteUrl(logo) : /^https:\/\//i.test(logo) ? logo : null;
  return address ? { ...rest, logo_url: address } : rest;
}

/* ---------------------------------------------------------------- input */

/**
 * The colour and font an owner submits. An empty colour means no strip; an
 * empty font, or the default, means the standard font.
 */
export const brandingInputSchema = z.object({
  colour: z
    .string()
    .trim()
    .transform((v) => v.toLowerCase())
    .superRefine((v, ctx) => {
      if (!v) return;
      const problem = brandColourProblem(v);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    }),
  font: z
    .string()
    .trim()
    .refine((v) => !v || brandFont(v) !== undefined, 'That font is not one of the choices. Pick one from the list.'),
});

/**
 * The branding to store: the earlier value with the logo, colour and font
 * replaced. Keys this form does not own (such as footer_html) are carried
 * over untouched, never set from the request.
 */
export function nextBranding(
  previous: TenantBranding | null,
  input: { colour: string; font: string; logoPath: string | null | undefined },
): TenantBranding {
  const next: TenantBranding = { ...(previous ?? {}) };
  delete next.primary_color;
  delete next.font;
  if (input.colour) next.primary_color = input.colour;
  if (input.font && input.font !== DEFAULT_BRAND_FONT) next.font = input.font;
  // undefined: keep the logo as it was; null: remove it.
  if (input.logoPath === null) delete next.logo_url;
  else if (input.logoPath !== undefined) next.logo_url = input.logoPath;
  return next;
}

/* ---------------------------------------------------------------- view */

export interface BrandingView {
  logoSrc: string | null;
  colour: string | null;
  fontStack: string | null;
}

/**
 * What the public header draws from stored branding. Each part is checked
 * again here, so a value written some other way (by hand in the database, or
 * an older format) is skipped rather than drawn.
 */
export function brandingView(
  branding: TenantBranding | null | undefined,
  fileUrl: (storagePath: string) => string,
): BrandingView {
  const logo = branding?.logo_url;
  const colour = branding?.primary_color?.toLowerCase();
  return {
    logoSrc: logo && LOGO_PATH_RE.test(logo) ? fileUrl(logo) : null,
    colour: colour && brandColourProblem(colour) === null ? colour : null,
    fontStack: brandFont(branding?.font)?.stack ?? null,
  };
}
