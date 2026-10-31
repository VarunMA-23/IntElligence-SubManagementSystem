// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-namespace": "warn",
      "@typescript-eslint/triple-slash-reference": "warn",
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
    },
  },
  {
    // Relax rules for test files and CLI tools
    files: ["**/*.test.ts", "**/test/**/*.ts", "scripts/**/*.ts", "**/cli/**/*.ts", "**/logger.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },
  {
    files: ["**/types.ts"],
    rules: {
      "@typescript-eslint/no-namespace": "off",
    },
  },
  {
    // Ignore generated files and build artifacts
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "coverage/**",
      "**/*.js",
      "**/*.d.ts",
    ],
  },
);
