/** Portraits assembled at build time from pinned, hash-checked source files.
 *
 * An import never enters the frozen research snapshot. Adding one means a
 * directory under `site/imports/`, an importer that checks its pins, an entry
 * here and a line in `site/catalog.json`.
 */
import { californiaPortrait, californiaSourceFiles } from './california-import.mjs';
import { sanFranciscoPortrait, sanFranciscoSourceFiles } from './san-francisco-import.mjs';

export const portraitImports = [
  { slug: 'california', directory: 'imports/california', files: californiaSourceFiles, portrait: californiaPortrait },
  { slug: 'san-francisco', directory: 'imports/san-francisco', files: sanFranciscoSourceFiles, portrait: sanFranciscoPortrait },
];
export const importedSlugs = new Set(portraitImports.map(entry => entry.slug));
export const importedPortraits = () => portraitImports.map(entry => entry.portrait());
