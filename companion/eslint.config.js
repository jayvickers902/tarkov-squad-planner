import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'src-tauri/target/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // Keep the existing application lintable while the warning backlog is
      // reduced. New correctness rules remain errors; these legacy hygiene
      // diagnostics are visible and can be ratcheted to errors incrementally.
      'no-unused-vars': 'warn',
      'no-empty': 'warn',
      'no-control-regex': 'warn',
      'no-useless-escape': 'warn',
      'require-yield': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['**/*.test.js', '**/*.test.jsx'],
    languageOptions: {
      globals: {
        ...globals.vitest,
      },
    },
  },
]
