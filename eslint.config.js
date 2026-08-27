import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Convention maison : foundation.jsx et les modules exportent composants ET
      // helpers/constantes dans le même fichier. Cette règle (pure DX fast-refresh)
      // noyait le lint sous ~160 erreurs sans valeur ; neutralisée en Phase 0.
      'react-refresh/only-export-components': 'off',
    },
  },
])
