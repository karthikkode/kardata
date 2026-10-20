import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "src/db/migrations/"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "all HTTP goes through src/collect/fetch.ts — no other code may call fetch",
        },
      ],
    },
  },
  {
    files: ["src/collect/fetch.ts", "tests/**", "scripts/**"],
    rules: { "no-restricted-globals": "off" },
  },
);
