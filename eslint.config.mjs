import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript", "prettier"),
  {
    // CLAUDE.md: the engine is pure TypeScript. No DB, no Next.js, no I/O, and no import from the server layer.
    files: ["src/engine/**/*.ts"],
    ignores: ["src/engine/**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@prisma/*", "next", "next/*", "react", "react-dom"],
              message: "The engine must stay pure.",
            },
            {
              group: ["node:*", "fs", "path", "crypto", "child_process"],
              message: "The engine does no I/O.",
            },
            {
              group: ["**/server/*", "**/prisma/*"],
              message: "The engine must not depend on the server layer.",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", "process", "window", "document", "fetch"],
    },
  },
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
