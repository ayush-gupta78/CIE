import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "prompts/**", "release/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/*.mjs"],
    languageOptions: {
      globals: {
        URL: "readonly",
        process: "readonly",
        fetch: "readonly",
        AbortSignal: "readonly",
        console: "readonly",
      },
    },
  },
);
