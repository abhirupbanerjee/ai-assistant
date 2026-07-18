/**
 * Dark Mode Toggle (v2)
 *
 * Simple toggle that flips data-theme attribute on <html>.
 * CSS already has dark mode overrides from day one — this just enables the UI.
 * Include this script in generated pages to activate the toggle.
 */

(function() {
  'use strict';

  // Check for saved preference or system preference
  const savedTheme = localStorage.getItem('site-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  // Create toggle button
  function createToggle() {
    var btn = document.createElement('button');
    btn.className = 'theme-toggle';
    btn.setAttribute('aria-label', 'Toggle dark mode');
    btn.innerHTML = isDark() ? '☀️' : '🌙';
    btn.style.cssText = [
      'position: fixed',
      'bottom: 20px',
      'right: 20px',
      'width: 44px',
      'height: 44px',
      'border-radius: 50%',
      'border: 1px solid var(--color-border)',
      'background: var(--color-surface)',
      'color: var(--color-text)',
      'font-size: 1.2rem',
      'cursor: pointer',
      'z-index: 9999',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'box-shadow: var(--shadow-md)',
      'transition: transform var(--transition-fast), background var(--transition-fast)',
    ].join(';');

    btn.addEventListener('click', function() {
      var dark = isDark();
      if (dark) {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('site-theme', 'light');
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('site-theme', 'dark');
      }
      btn.innerHTML = dark ? '🌙' : '☀️';
    });

    btn.addEventListener('mouseenter', function() {
      btn.style.transform = 'scale(1.1)';
    });
    btn.addEventListener('mouseleave', function() {
      btn.style.transform = 'scale(1)';
    });

    document.body.appendChild(btn);
  }

  function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createToggle);
  } else {
    createToggle();
  }
})();
