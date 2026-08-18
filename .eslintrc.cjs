module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  settings: { react: { version: 'detect' } },
  globals: {
    // Injected by Vite's `define`.
    __APP_VERSION__: 'readonly',
  },
  ignorePatterns: ['dist', 'android', 'node_modules', 'public/sw.js'],
  rules: {
    // The app passes plain objects around rather than declaring prop types.
    'react/prop-types': 'off',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'smart'],
  },
  overrides: [
    {
      // Build-time CLI scripts report progress on stdout.
      files: ['scripts/**'],
      rules: { 'no-console': 'off' },
    },
    {
      files: ['**/*.test.js'],
      env: { node: true },
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
  ],
};
