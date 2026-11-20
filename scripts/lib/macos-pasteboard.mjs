import { execFileSync } from 'node:child_process';

// JXA: the copied files' list, their icon as image data and their names as
// text, the content a Finder ⌘C offers. The icon is what a paste must never
// mistake for the content (BUG-353).
//
// One declaration written whole: AppKit offers each file's URL from the list,
// as it does for Finder's copy. Writing one pasteboard item per file from a
// short-lived script is not reliable: about one write in fifteen kept only the
// first item once the script exited (measured 2026-11-20).
const FINDER_COPY = `
ObjC.import('AppKit');
function run(paths) {
  const pasteboard = $.NSPasteboard.generalPasteboard;
  const icon = $.NSWorkspace.sharedWorkspace.iconForFiles($(paths));
  icon.size = $.NSMakeSize(1024, 1024);
  pasteboard.declareTypesOwner(
    $(['NSFilenamesPboardType', 'public.tiff', 'public.utf8-plain-text']),
    $()
  );
  const names = paths.map(file => file.split('/').pop()).join('\\r');
  const written =
    pasteboard.setPropertyListForType($(paths), 'NSFilenamesPboardType') &&
    pasteboard.setDataForType(icon.TIFFRepresentation, 'public.tiff') &&
    pasteboard.setStringForType(names, 'public.utf8-plain-text');
  return written ? String(pasteboard.pasteboardItems.count) : 'refused';
}`;

/** Put `paths` on the macOS pasteboard the way Finder copies files. */
export function copyFilesLikeFinder(paths) {
  const written = execFileSync(
    'osascript',
    ['-l', 'JavaScript', '-e', FINDER_COPY, ...paths],
    { encoding: 'utf8' }
  ).trim();
  if (written !== String(paths.length)) {
    throw new Error(
      `Finder-style copy of ${paths.length} files left ${written} on the pasteboard`
    );
  }
}
