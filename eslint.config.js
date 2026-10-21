import js from '@eslint/js';
import parser from '@babel/eslint-parser';
import globals from 'globals';
export default [
  { ignores: ['node_modules/**', 'dist/**', '.cache/**', '.agents/**', '.spec-team/**', '.github/**', 'supabase/functions/**', 'playwright-report/**', 'test-results/**'] },
  { ...js.configs.recommended, files: ['**/*.js'], languageOptions: { globals: globals.node } },
  { files: ['**/*.ts', '**/*.tsx'], languageOptions: { parser, globals: { ...globals.browser, ...globals.node }, parserOptions: { requireConfigFile: false, babelOptions: { plugins: [['@babel/plugin-syntax-typescript', { isTSX: true }], '@babel/plugin-syntax-jsx'] } } }, rules: { 'no-debugger': 'error', 'no-constant-condition': 'error', 'no-duplicate-case': 'error', 'no-unreachable': 'error' } },
];
