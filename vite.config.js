// vite.config.js
import { defineConfig } from "vite";
import legacy from "@vitejs/plugin-legacy";
import { resolve } from "path";
import { execSync } from "child_process";

export default defineConfig(({ command }) => {
  const isServe = command === "serve";

  let version = "";
  try {
    version = execSync("git describe --exact-match --tags")
      .toString()
      .trim();
  } catch (e) {
    version = execSync("git rev-parse --short HEAD").toString().trim();
  }

  return {
    plugins: [
      // Kör legacy-plugin endast i dev (vite serve), inte i build
      isServe &&
        legacy({
          targets: ["defaults", "not IE 11"],
        }),
    ].filter(Boolean),

    define: {
      __VERSION__: JSON.stringify(version),
    },

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
