/**
 * Template Engine
 *
 * Simple mustache-style placeholder replacement for HTML templates.
 * Supports: {{variable}}, {{#section}}...{{/section}}, {{^inverted}}...{{/inverted}}
 *
 * No external dependencies — regex-based, sufficient for server-side template rendering.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const TEMPLATES_DIR = join(process.cwd(), 'src/lib/site-gen/templates');

/**
 * Render a template string with data.
 * Supports basic mustache syntax: {{var}}, {{#block}}, {{^inverted}}
 */
export function renderTemplate(
  template: string,
  data: Record<string, unknown>
): string {
  let result = template;

  // Handle sections {{#section}}...{{/section}}
  result = result.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, key: string, content: string) => {
      const value = data[key];
      if (!value) return '';
      if (Array.isArray(value)) {
        return value.map((item: Record<string, unknown>) =>
          renderTemplate(content, item)
        ).join('');
      }
      if (typeof value === 'object' && value !== null) {
        return renderTemplate(content, value as Record<string, unknown>);
      }
      // Truthy scalar: render once with the value
      return renderTemplate(content, { '.': value });
    }
  );

  // Handle inverted sections {{^section}}...{{/section}}
  result = result.replace(
    /\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, key: string, content: string) => {
      const value = data[key];
      if (!value || (Array.isArray(value) && value.length === 0)) {
        return renderTemplate(content, data);
      }
      return '';
    }
  );

  // Handle simple variables {{variable}}
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (key in data && data[key] !== null && data[key] !== undefined) {
      return String(data[key]);
    }
    return '';
  });

  return result;
}

/**
 * Load a page type template HTML file.
 */
export function loadTemplate(pageType: string): string {
  const templatePath = join(TEMPLATES_DIR, 'page-types', pageType, 'template.html');
  return readFileSync(templatePath, 'utf8');
}

/**
 * Load a shared component template.
 */
export function loadComponent(componentName: string): string {
  const componentPath = join(TEMPLATES_DIR, 'components', `${componentName}.html`);
  return readFileSync(componentPath, 'utf8');
}

/**
 * Check if a template exists for a page type.
 */
export function templateExists(pageType: string): boolean {
  try {
    const templatePath = join(TEMPLATES_DIR, 'page-types', pageType, 'template.html');
    readFileSync(templatePath, 'utf8');
    return true;
  } catch {
    return false;
  }
}
