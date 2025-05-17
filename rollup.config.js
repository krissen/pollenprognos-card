// rollup.config.js
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import url from '@rollup/plugin-url';
import terser from '@rollup/plugin-terser';

export default {
  input: 'src/index.js',
  output: {
    file: 'dist/pollenprognos-card.js',
    format: 'es',
    sourcemap: true,
  },
  plugins: [
    // So Rollup can locate `lit` and your own modules under src/
    resolve(),
    // Convert any CommonJS deps (none here, but safe to keep)
    commonjs(),
    // Inline *all* PNGs as base64, no external assets needed
    url({
      include: ['**/*.png'],
      limit: Infinity,
    }),
    // Minify
    terser(),
  ],
};

