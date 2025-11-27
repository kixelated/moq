import solid from "unplugin-solid/rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import { string } from "rollup-plugin-string";

export default [
	{
		input: "src/Components/publish/element.tsx",
		output: {
			file: "dist/publish-controls.esm.js",
			format: "es",
			sourcemap: true,
		},
		plugins: [
			string({ include: "**/*.css" }),
			solid({ dev: false, hydratable: false }),
			nodeResolve({ extensions: [".js", ".ts", ".tsx"] }),
			typescript(),
		],
	},
	{
		input: "src/Components/watch/element.tsx",
		output: {
			file: "dist/watch-controls.esm.js",
			format: "es",
			sourcemap: true,
		},
		plugins: [
			string({ include: "**/*.css" }),
			solid({ dev: false, hydratable: false }),
			nodeResolve({ extensions: [".js", ".ts", ".tsx"] }),
			typescript(),
		],
	},
];
