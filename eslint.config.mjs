// Simplified ESLint config to avoid circular reference issue with FlatCompat
export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      '.turbo/**',
      'dist/**',
      'build/**',
      'data/**',
    ],
  },
];
