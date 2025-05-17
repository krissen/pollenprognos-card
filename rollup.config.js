// rollup.config.js
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

export default {
  input: 'src/index.js',
  output: {
    file: 'dist/pollenprognos-card.js',
    format: 'es',
    sourcemap: true,
  },
  // Inga externa CDN-URL:er längre – allt från npm packas in
  external: [],
  plugins: [
    resolve({
      browser: true,
    }),
    commonjs(),
    terser(),
  ],
};

