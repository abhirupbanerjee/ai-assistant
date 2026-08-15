/**
 * Mobile floating-control geometry.
 *
 * This value is duplicated as the CSS custom property `--mobile-top-clearance`
 * in `src/app/globals.css`. Keep the two in sync.
 *
 * Breakdown:
 * - env(safe-area-inset-top): OS-reported notch/Dynamic Island/status bar height.
 * - 8px: gap from safe-area to control top.
 * - 48px: control touch target.
 * - 8px: clearance below control before message content begins.
 */
export const MOBILE_TOP_CLEARANCE = 'calc(env(safe-area-inset-top, 0px) + 64px)';

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
