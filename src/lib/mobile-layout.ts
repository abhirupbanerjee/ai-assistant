/**
 * Mobile chat top-clearance geometry.
 *
 * This value is duplicated as the CSS custom property `--mobile-top-clearance`
 * in `src/app/globals.css`. Keep the two in sync.
 *
 * Only the OS-reported notch/Dynamic Island/status bar area is reserved. The
 * floating menu and artifact controls deliberately overlay the scrollable chat.
 */
export const MOBILE_TOP_CLEARANCE = 'env(safe-area-inset-top, 0px)';

/**
 * Resolve a CSS length (possibly a calc()) to pixels using the browser's
 * computed-style engine. Use this when JS needs the numeric clearance value,
 * e.g. for bottom-spacer sizing.
 */
export function resolveCssLengthToPixels(value: string): number {
  if (typeof document === 'undefined') return 0;
  const tmp = document.createElement('div');
  tmp.style.height = value;
  tmp.style.position = 'absolute';
  tmp.style.visibility = 'hidden';
  tmp.style.pointerEvents = 'none';
  document.body.appendChild(tmp);
  const height = tmp.clientHeight;
  document.body.removeChild(tmp);
  return height;
}
