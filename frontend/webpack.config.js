// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const webpack = require('webpack');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

// bambooo's v2 barrel re-exports optional Map/PDF/Scanner widgets that pull heavy
// deps (OpenLayers, pdfjs-dist, jsvectormap, barcode-detector). AudioMesh uses none
// of them, so we ignore those module requests instead of installing ~30 MB of deps.
// The referencing classes are only ever touched if instantiated, which we never do.
const IGNORED_OPTIONAL = /^(pdfjs-dist|barcode-detector|ol|ol-layerswitcher|jsvectormap)(\/|$)/u;

// eslint-disable-next-line no-undef
module.exports = {

    devtool: 'source-map',

    mode: 'production',

    entry: {
        index: './src/index.ts',
    },

    output: {
        // eslint-disable-next-line no-undef
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
    },

    resolve: {
        extensions: ['.ts', '.js', '.mjs'],
        extensionAlias: {
            '.js': ['.js', '.ts'],
        },
    },

    module: {
        rules: [
            {
                test: /\.mjs$/u,
                type: 'javascript/auto',
            },
            {
                // eslint-disable-next-line require-unicode-regexp
                test: /\.tsx?/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        transpileOnly: true,
                    },
                },
                exclude: '/node_modules/',
            },
        ],
    },

    plugins: [
        new ForkTsCheckerWebpackPlugin(),
        new webpack.IgnorePlugin({ resourceRegExp: IGNORED_OPTIONAL }),
    ],

    watch: false,
};
