import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            '**/*.d.ts',
            'frontend/public/**',
            'frontend/assets/**',
            // Vendored third-party bundle (minified lib-jitsi-meet) — not ours to lint.
            'backend/vendor/**',
            // Build configs are CommonJS by necessity (webpack / gulp); the strict TS rules
            // don't apply to them.
            'frontend/webpack.config.js',
            'frontend/webpack-empty.js',
            'frontend/gulpfile.js',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
        },
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
    {
        // Plain Node scripts (maintenance + manual smoke tests): pure JS run by
        // node/tsx, so they need Node's runtime globals (process, console, …).
        files: ['**/scripts/**/*.mjs'],
        languageOptions: {
            globals: globals.node,
        },
    },
);
