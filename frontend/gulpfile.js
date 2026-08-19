// eslint-disable-next-line @typescript-eslint/no-var-requires
const gulp = require('gulp');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const webpack = require('webpack');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const webpackConfig = require('./webpack.config.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');

const currentPath = './';
const collectionPath = './../';
const assetsPath = `${currentPath}assets/`;

// Resolve a module dir whether it was hoisted to the repo root or installed
// locally in the workspace (npm workspaces hoist most deps to the root).
function funcFindNodeModules(nodesModuleName, subdir) {
    const pathIn = `${currentPath}node_modules/${nodesModuleName}`;
    try {
        if (fs.lstatSync(pathIn).isDirectory()) {
            return `${pathIn}/${subdir}`;
        }
    } catch (e) {
        // fall through to the hoisted location
    }
    const pathOut = `${collectionPath}node_modules/${nodesModuleName}`;
    try {
        if (fs.lstatSync(pathOut).isDirectory()) {
            return `${pathOut}/${subdir}`;
        }
    } catch (e) {
        // not found in either location
    }
    throw new Error(`Path not found for module: ${nodesModuleName}`);
}

gulp.task('copy-adminlte-css', () =>
    gulp.src(funcFindNodeModules('admin-lte', 'dist/css/**/*')).pipe(gulp.dest(`${assetsPath}css`)),
);

gulp.task('copy-adminlte-js', () =>
    gulp.src(funcFindNodeModules('admin-lte', 'dist/js/adminlte.js')).pipe(gulp.dest(assetsPath)),
);

gulp.task('copy-ionicons', () =>
    gulp.src(funcFindNodeModules('ionicons-css', 'dist/**/*')).pipe(gulp.dest(`${assetsPath}ionicons-css`)),
);

gulp.task('copy-bambooo-css', () =>
    gulp.src(funcFindNodeModules('bambooo', 'bambooo.css')).pipe(gulp.dest(`${assetsPath}css`)),
);

gulp.task('copy-jquery', () =>
    gulp.src(funcFindNodeModules('jquery', 'dist/jquery.min.js')).pipe(gulp.dest(`${assetsPath}plugins/jquery`)),
);

gulp.task('copy-bootstrap-js', () =>
    gulp
        .src(funcFindNodeModules('bootstrap', 'dist/js/bootstrap.bundle.min.js'))
        .pipe(gulp.dest(`${assetsPath}plugins/bootstrap/js`)),
);

gulp.task('copy-bootstrap-css', () =>
    gulp
        .src(funcFindNodeModules('bootstrap', 'dist/css/bootstrap.min.css'))
        .pipe(gulp.dest(`${assetsPath}plugins/bootstrap/css`)),
);

gulp.task('copy-fontawesome', () =>
    gulp
        .src(funcFindNodeModules('@fortawesome/fontawesome-free', '**/*'))
        .pipe(gulp.dest(`${assetsPath}plugins/fontawesome-free`)),
);

// AudioMesh's own theme, versioned under src/styles/, copied into assets/css/.
gulp.task('copy-theme', () => gulp.src('./src/styles/*.css').pipe(gulp.dest(`${assetsPath}css`)));

gulp.task(
    'copy-data',
    gulp.parallel(
        'copy-adminlte-css',
        'copy-adminlte-js',
        'copy-ionicons',
        'copy-bambooo-css',
        'copy-jquery',
        'copy-bootstrap-js',
        'copy-bootstrap-css',
        'copy-fontawesome',
        'copy-theme',
    ),
);

gulp.task('build-webpack', () => {
    return new Promise((resolve, reject) => {
        // eslint-disable-next-line consistent-return
        webpack(webpackConfig, (err, stats) => {
            if (err) {
                return reject(err);
            }
            if (stats.hasErrors()) {
                return reject(new Error(stats.compilation.errors.join('\n')));
            }
            resolve();
        });
    });
});

gulp.task('watch-webpack', () => {
    const devConfig = Object.assign({}, webpackConfig, { mode: 'development', watch: false });
    const compiler = webpack(devConfig);
    compiler.watch({}, (err, stats) => {
        const ts = new Date().toLocaleTimeString();
        if (err) {
            console.error(`[${ts}] webpack failed:`, err);
            return;
        }
        if (stats.hasErrors()) {
            console.error(`[${ts}] webpack errors:\n${stats.compilation.errors.join('\n')}`);
            return;
        }
        console.log(`[${ts}] webpack rebuilt — refresh the browser`);
    });
    return new Promise(() => {});
});

gulp.task('watch', gulp.series('copy-data', 'watch-webpack'));

gulp.task('default', gulp.series('copy-data', 'build-webpack'));
