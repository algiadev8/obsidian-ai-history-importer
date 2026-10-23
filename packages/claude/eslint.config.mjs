import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
	{ ignores: ["dist/**"] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["**/*.ts"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "obsidian",
							message: "claude package must not import obsidian"
						}
					]
				}
			]
		}
	}
];
