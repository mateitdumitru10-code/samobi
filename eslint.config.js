import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'supabase/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TypeScript already catches undefined identifiers, and no-undef does not
      // know about ambient types like `process` or `import.meta`.
      'no-undef': 'off',
      // `any` is banned by CLAUDE.md, not merely discouraged.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Formulas are evaluated through expr-eval only. See CLAUDE.md.
      'no-eval': 'error',
      'no-new-func': 'error',
    },
  },
  prettier,
)
