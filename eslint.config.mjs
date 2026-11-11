import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['build/**', 'node_modules/**', 'src/pkjs/debug_env.js'] },
  js.configs.recommended,
  {
    files: ['src/pkjs/**/*.js'],
    languageOptions: {
      ecmaVersion: 5,
      sourceType: 'commonjs',
      globals: {
        Pebble: 'readonly', localStorage: 'readonly', XMLHttpRequest: 'readonly',
        console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        Uint8Array: 'readonly', Float32Array: 'readonly'
      }
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }]
    }
  },
  {
    files: ['src/pkjs/image_transfer.js', 'src/pkjs/spotify_auth.js'],
    // Existing ES5 loops reuse function-scoped var declarations.
    rules: { 'no-redeclare': 'off' }
  },
  {
    files: ['src/pkjs/index.js'],
    // Existing write-only track bookkeeping; retain behavior for this tooling change.
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^lastTrackUri$' }] }
  },
  {
    files: ['web/public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2017, sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly', ConfigCore: 'readonly' }
    },
    rules: { 'no-unused-vars': ['error', { caughtErrors: 'none' }] }
  },
  {
    files: ['test/js/**/*.cjs', 'eslint.config.mjs', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node }
  }
];
