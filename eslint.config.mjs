import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    // Not "build/**": here build/ holds the Sites packaging plugin, which is
    // source, not build output.
    "next-env.d.ts",
    // Local agent worktrees carry their own builds.
    ".claude/**",
    // Generated SDK declarations and the site build are not source.
    "sdk/dist/**",
    "dist/**",
    // eslint-config-next ignores build/** itself; re-include the plugin.
    "!build/**",
  ]),
]);

export default eslintConfig;
