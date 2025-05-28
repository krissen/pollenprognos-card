// vite.config.js
import { defineConfig } from "vite";
import legacy from "@vitejs/plugin-legacy";
import { resolve } from "path";

export default defineConfig(({ command }) => {
  const isServe = command === "serve";

  return {
    plugins: [
      // Kör legacy-plugin endast i dev (vite serve), inte i build
      isServe &&
        legacy({
          targets: ["defaults", "not IE 11"],
        }),
    ].filter(Boolean),

    build: {
      lib: {
        entry: resolve(__dirname, "src/index.js"),
        name: "pollenprognosCard",
        // Skriv alltid ut .js-suffix
        fileName: () => "pollenprognos-card.js",
        formats: ["es"],
      },
      rollupOptions: {
        // Inga externals behövs – allt bundlas
        external: [],
        output: {
          sourcemap: false,
        },
      },
    },
  };
});
