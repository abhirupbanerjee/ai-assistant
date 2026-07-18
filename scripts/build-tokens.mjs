/**
 * DTCG Token → CSS Compiler
 *
 * Reads W3C DTCG-format JSON tokens and compiles them to CSS custom properties.
 * Handles reference resolution (e.g., {color.blue.blue-600} → actual value).
 * Generates light mode (:root) and dark mode ([data-theme="dark"]) blocks.
 *
 * Usage: node scripts/build-tokens.mjs
 * Replaces the need for style-dictionary as a build dependency.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TOKENS_DIR = join(ROOT, 'src/lib/site-gen/themes/tokens');
const DIST_DIR = join(ROOT, 'src/lib/site-gen/themes/dist');

const THEMES = [
  'portfolio', 'product', 'company', 'blog', 'documentation',
  'dashboard', 'store', 'event', 'nonprofit', 'education',
];

// ============ Token Utilities ============

/**
 * Load and parse a JSON file.
 */
function loadJson(filepath) {
  return JSON.parse(readFileSync(filepath, 'utf8'));
}

/**
 * Flatten a nested token object into dot-notation paths.
 * E.g., { color: { primary: { $value: '#fff' } } } → { 'color.primary': '#fff' }
 */
function flattenTokens(obj, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === '$description' || key === '$type') continue;
    const path = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === 'object' && '$value' in value) {
      result[path] = value.$value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenTokens(value, path));
    }
  }
  return result;
}

/**
 * Resolve token references like {color.blue.blue-600}.
 */
function resolveReferences(flatTokens) {
  const resolved = {};
  const REF_REGEX = /\{([^}]+)\}/g;

  for (const [key, value] of Object.entries(flatTokens)) {
    if (typeof value === 'string' && value.includes('{')) {
      resolved[key] = value.replace(REF_REGEX, (_, ref) => {
        // Try to find the reference in resolved tokens or flat tokens
        if (resolved[ref] !== undefined) return resolved[ref];
        if (flatTokens[ref] !== undefined) return flatTokens[ref];
        console.warn(`  ⚠ Unresolved reference: ${ref} in ${key}`);
        return `/* UNRESOLVED: ${ref} */`;
      });
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

/**
 * Convert a flat token map to CSS custom properties.
 */
function toCssVariables(tokens, selector = ':root') {
  const lines = [`${selector} {`];

  for (const [key, value] of Object.entries(tokens)) {
    // Skip non-semantic tokens (primitives — prefixed with color.neutral, color.blue, etc.)
    // Only output tokens that are theme-level semantic tokens
    const varName = `--${key.replace(/\./g, '-')}`;
    const cssValue = typeof value === 'string' ? value : String(value);
    lines.push(`  ${varName}: ${cssValue};`);
  }

  lines.push('}');
  return lines.join('\n');
}

// ============ Main Build ============

function buildTheme(themeId) {
  const primitivesFile = join(TOKENS_DIR, 'primitives.tokens.json');
  const lightFile = join(TOKENS_DIR, `${themeId}.tokens.json`);
  const darkFile = join(TOKENS_DIR, `${themeId}.dark.tokens.json`);

  if (!existsSync(lightFile)) {
    console.log(`  ⚠ ${themeId}: No light tokens file, skipping.`);
    return;
  }

  // Load tokens
  const primitives = loadJson(primitivesFile);
  const lightTokens = loadJson(lightFile);
  const darkTokens = existsSync(darkFile) ? loadJson(darkFile) : null;

  // Flatten and resolve
  const primitivesFlat = flattenTokens(primitives);
  const lightFlat = flattenTokens(lightTokens);
  const darkFlat = darkTokens ? flattenTokens(darkTokens) : null;

  // Combine primitives + semantic, then resolve references
  const allLight = { ...primitivesFlat, ...lightFlat };
  const resolvedLight = resolveReferences(allLight);

  let resolvedDark = null;
  if (darkFlat) {
    const allDark = { ...primitivesFlat, ...darkFlat };
    resolvedDark = resolveReferences(allDark);
  }

  // Generate CSS
  const cssParts = [];

  // Light mode
  cssParts.push('/* Light mode (default) */');
  cssParts.push(toCssVariables(resolvedLight, ':root'));

  // Dark mode
  if (resolvedDark) {
    cssParts.push('');
    cssParts.push('/* Dark mode overrides */');
    cssParts.push(toCssVariables(resolvedDark, ':root[data-theme="dark"], [data-theme="dark"]'));
  }

  // Write output
  const outDir = join(DIST_DIR, themeId);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const cssContent = cssParts.join('\n') + '\n';
  const outFile = join(outDir, 'global.css');
  writeFileSync(outFile, cssContent);

  const lightCount = Object.keys(resolvedLight).length;
  const darkCount = resolvedDark ? Object.keys(resolvedDark).length : 0;
  console.log(`  ✓ ${themeId}: ${lightCount} light + ${darkCount} dark tokens → ${outFile}`);
}

// ============ Run ============

console.log('Building design tokens...\n');

for (const theme of THEMES) {
  buildTheme(theme);
}

console.log('\nDone. All theme CSS files generated.');
