import solid from "eslint-plugin-solid/configs/typescript";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["**/dist", "**/node_modules", "**/target"],
	},
	eslint.configs.recommended,
	tseslint.configs.recommended,
	solid,
	{
		rules: {
			// Too many false positives, and it's based on the names of variables...
			"solid/reactivity": "off",
			// We use _ to indicate unused variables.
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
				},
			],
		},
	},
);
