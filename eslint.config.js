// @ts-check
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
	{ ignores: ["dist/**", "node_modules/**"] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		rules: {
			"@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
			"@typescript-eslint/no-explicit-any": "warn",
		},
	},
	{
		files: ["eslint.config.js"],
		languageOptions: { globals: { require: "readonly", module: "writable" } },
		rules: { "@typescript-eslint/no-require-imports": "off" },
	}
);
