import tsparser from '@typescript-eslint/parser';
import tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  ...tseslint.configs.recommended,
  {
    ignores: ['node_modules', 'dist', '.dockerignore', '.gitignore'],
  },
  {
    files: ['**/*.ts,js'],
  },
  {
    languageOptions: {
      parser: tsparser,
      sourceType: 'module',
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      ...prettierConfig.rules,
      'prettier/prettier': [
        'warn',
        {
          trailingComma: 'es5',
          singleQuote: true,
          semi: true,
          endOfLine: 'auto',
        },
      ],
      'no-console': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/ban-ts-comment': ['warn'],
    },
  },
];
