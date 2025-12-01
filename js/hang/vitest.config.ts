import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
	plugins: [solid()],
	test: {
		globals: true,
		environment: "happy-dom",
		setupFiles: [],
		include: ["src/**/*.test.{ts,tsx}"],
	},
});
