// rollup.config.js
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import url from "@rollup/plugin-url";
import json from "@rollup/plugin-json"; // ← ny rad
import terser from "@rollup/plugin-terser";

export default {
  input: "src/index.js",
  output: {
    file: "dist/pollenprognos-card.js",
    format: "es",
    sourcemap: false,
  },
  plugins: [
    json(), // ← se till att JSON-filer packas in
    resolve(),
    commonjs(),
    url({
      include: ["**/*.png"],
      limit: Infinity,
    }),
    terser(),
  ],
};
