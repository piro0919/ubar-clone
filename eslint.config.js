import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import css from "eslint-plugin-css";
import cssModules from "eslint-plugin-css-modules";
import ext from "eslint-plugin-ext";
import perfectionist from "eslint-plugin-perfectionist";
import promise from "eslint-plugin-promise";
import unusedImports from "eslint-plugin-unused-imports";
import writeGoodComments from "eslint-plugin-write-good-comments";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { fixupPluginRules } from "@eslint/compat";
import filenamesPlugin from "eslint-plugin-filenames";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import securityPlugin from "eslint-plugin-security";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({
  allConfig: js.configs.all,
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

const eslintConfig = [
  {
    files: ["**/*.{js,jsx,ts,tsx,mjs}"],
  },
  ...compat.extends(
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "plugin:css/recommended",
    "plugin:promise/recommended",
    "plugin:security/recommended-legacy",
    "prettier"
  ),
  {
    languageOptions: {
      ecmaVersion: 2024,
      parser: tsParser,
      parserOptions: {
        project: ["./tsconfig.json"],
        warnOnUnsupportedTypeScriptVersion: false,
        ecmaFeatures: {
          jsx: true,
        },
      },
      sourceType: "module",
      globals: {
        // Electron 特有のグローバル変数
        NodeJS: "readonly",
      },
    },
    plugins: {
      css,
      "css-modules": cssModules,
      ext,
      filenames: fixupPluginRules(filenamesPlugin),
      perfectionist,
      promise,
      "unused-imports": unusedImports,
      "write-good-comments": writeGoodComments,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      security: securityPlugin,
    },
    rules: {
      // TypeScript 関連
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          fixStyle: "inline-type-imports",
          prefer: "type-imports",
        },
      ],
      "@typescript-eslint/explicit-function-return-type": "warn",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unused-vars": "off", // unused-imports プラグインで代替
      "@typescript-eslint/strict-boolean-expressions": "off",

      // CSS Modules 関連
      "css-modules/no-unused-class": [2, { camelCase: true }],
      "css-modules/no-undef-class": [2, { camelCase: true }],

      // コード書式関連
      "ext/lines-between-object-properties": ["error", "never"],
      "filenames/match-exported": ["error", ["camel", "kebab", "pascal"]],
      "filenames/match-regex": "error",
      "filenames/no-index": "off",
      "no-duplicate-imports": "error",
      "no-multiple-empty-lines": ["error", { max: 1 }],
      "padding-line-between-statements": [
        "error",
        {
          blankLine: "always",
          next: [
            "block",
            "block-like",
            "break",
            "class",
            "const",
            "do",
            "export",
            "function",
            "let",
            "return",
            "switch",
            "try",
            "while",
          ],
          prev: "*",
        },
        {
          blankLine: "always",
          next: "*",
          prev: [
            "block",
            "block-like",
            "break",
            "class",
            "const",
            "do",
            "export",
            "function",
            "let",
            "return",
            "switch",
            "try",
            "while",
          ],
        },
        {
          blankLine: "never",
          next: "import",
          prev: "*",
        },
        {
          blankLine: "never",
          next: ["case", "default"],
          prev: "case",
        },
        {
          blankLine: "never",
          next: "const",
          prev: "const",
        },
        {
          blankLine: "never",
          next: "let",
          prev: "let",
        },
      ],

      // コード整形関連 (perfectionist)
      "perfectionist/sort-imports": [
        "error",
        {
          groups: [
            ["builtin", "external"],
            "internal",
            ["parent", "sibling"],
            "index",
            "object",
            "type",
            "unknown",
          ],
          newlinesBetween: "never",
          order: "asc",
          type: "natural",
        },
      ],
      "perfectionist/sort-interfaces": [
        "error",
        {
          order: "asc",
          type: "natural",
        },
      ],
      "perfectionist/sort-jsx-props": [
        "error",
        {
          groups: ["multiline", "shorthand", "unknown"],
          order: "asc",
          type: "natural",
        },
      ],
      "perfectionist/sort-named-imports": [
        "error",
        {
          order: "asc",
          type: "natural",
        },
      ],
      "perfectionist/sort-object-types": [
        "error",
        {
          type: "natural",
          order: "asc",
        },
      ],
      "perfectionist/sort-objects": [
        "error",
        {
          order: "asc",
          type: "natural",
        },
      ],

      // React 関連
      "react/react-in-jsx-scope": "off", // React 17以降では不要
      "react/prop-types": "off", // TypeScript で代替
      "react/jsx-boolean-value": ["error", "always"],
      "react/jsx-newline": [
        "error",
        {
          prevent: true,
        },
      ],
      "react-hooks/exhaustive-deps": [
        "warn",
        {
          enableDangerousAutofixThisMayCauseInfiniteLoops: true,
        },
      ],

      // 未使用 import 関連
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          vars: "all",
          varsIgnorePattern: "^_",
        },
      ],

      // その他
      quotes: ["error", "double"],
      semi: ["error", "always"],
      "write-good-comments/write-good-comments": "warn",
      "no-console": ["warn", { allow: ["error", "warn"] }],
    },
  },
  // メインプロセス用の設定
  {
    files: ["main.ts", "preload.ts"],
    rules: {
      "no-console": "off", // メインプロセスではコンソール出力を許可
      "@typescript-eslint/explicit-function-return-type": "off", // 厳密な戻り値の型指定を緩和
    },
  },
];

export default eslintConfig;
