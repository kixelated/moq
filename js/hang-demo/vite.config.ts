import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import fs from "fs";

export default defineConfig({
	root: "src",
	plugins: [tailwindcss()],
	build: {
		target: "esnext",
		rollupOptions: {
			input: {
				watch: "index.html",
				publish: "publish.html",
				support: "support.html",
				meet: "meet.html",
			},
		},
	},
	server: {
		// TODO: properly support HMR
		hmr: false,
		host: 'enter.domain.here',
		https: {
			key: fs.readFileSync('/path/to/tls/certificate/key'),
			cert: fs.readFileSync('/path/to/tls/certificate/cert'),
		}
	},
});
