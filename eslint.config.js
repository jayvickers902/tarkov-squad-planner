import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

const testFiles = ['**/*.test.js', '**/*.test.jsx']

export default [
  {
    ignores: [
      'companion/**',
      'design/**',
      'dist/**',
      'node_modules/**',
      'coverage/**',
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
      // The warning backlog these were softened for is gone: `eslint .
      // --max-warnings 0` exits 0 across the tree. They are errors now so a
      // regression fails the gate instead of accumulating quietly. If one
      // fires, fix the code rather than re-softening the rule.
      'no-unused-vars': 'error',
      'no-empty': 'error',
      'no-control-regex': 'error',
      'no-useless-escape': 'error',
      'require-yield': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: testFiles,
    languageOptions: {
      globals: {
        ...globals.vitest,
      },
    },
  },
]
