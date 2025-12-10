import { defineConfig } from "vitest/config";
import solid from "unplugin-solid/vite";

export default defineConfig({
	plugins: [solid()],
	test: {
		environment: "happy-dom",
		globals: true,
	},
});
