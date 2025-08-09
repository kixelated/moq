import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["**/dist", "**/node_modules", "**/target"],
	},
	eslint.configs.recommended,
	tseslint.configs.recommended,
	{
		rules: {
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
