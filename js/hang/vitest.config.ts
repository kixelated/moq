import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
	plugins: [solidPlugin()],
	test: {
		globals: true,
		environment: "happy-dom",
		setupFiles: [],
		include: ["src/**/*.test.{ts,tsx}"],
	},
});
