// Simplified ESLint config to avoid circular reference issue with FlatCompat
export default [
  {
    ignores: [
      '.next/**',
      '**/.next/**',
      'node_modules/**',
      'out/**',
      '.turbo/**',
      'dist/**',
      'build/**',
      'data/**',
    ],
  },
];
