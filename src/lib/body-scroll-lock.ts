let activeLocks = 0;
let previousOverflow = '';

/**
 * Reference-counted body scroll lock for nested drawers and modals.
 * Returns an idempotent release function so one overlay cannot unlock the
 * document while another overlay is still active.
 */
export function lockBodyScroll(): () => void {
  if (activeLocks === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  activeLocks += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeLocks = Math.max(0, activeLocks - 1);
    if (activeLocks === 0) {
      document.body.style.overflow = previousOverflow;
      previousOverflow = '';
    }
  };
}
