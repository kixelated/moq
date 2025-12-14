import { defineConfig } from "vitepress";

export default defineConfig({
	title: "Media over QUIC",
	description: "Real-time latency at massive scale",
	base: "/",

	head: [["link", { rel: "icon", href: "/icon.svg", type: "image/svg+xml" }]],

	appearance: "force-dark",

	themeConfig: {
		logo: "/icon.svg",

		nav: [
			{ text: "Setup", link: "/setup/" },
			{ text: "Guide", link: "/guide/architecture" },
			{
				text: "API",
				items: [
					{ text: "Rust", link: "/rust/" },
					{ text: "TypeScript", link: "/typescript/" },
				],
			},
			{ text: "Contributing", link: "/contributing/" },
		],

		sidebar: {
			"/setup/": [
				{
					text: "Setup",
					items: [
						{ text: "Quick Start", link: "/setup/" },
						{ text: "Development", link: "/setup/development" },
						{ text: "Production", link: "/setup/production" },
					],
				},
			],

			"/guide/": [
				{
					text: "Guide",
					items: [
						{ text: "Architecture", link: "/guide/architecture" },
						{ text: "Protocol", link: "/guide/protocol" },
						{ text: "Authentication", link: "/guide/authentication" },
						{ text: "Deployment", link: "/guide/deployment" },
					],
				},
			],

			"/rust/": [
				{
					text: "Rust Libraries",
					items: [
						{ text: "Overview", link: "/rust/" },
						{ text: "moq-lite", link: "/rust/moq-lite" },
						{ text: "hang", link: "/rust/hang" },
						{ text: "moq-relay", link: "/rust/moq-relay" },
						{ text: "Examples", link: "/rust/examples" },
					],
				},
			],

			"/typescript/": [
				{
					text: "TypeScript Libraries",
					items: [
						{ text: "Overview", link: "/typescript/" },
						{ text: "@moq/lite", link: "/typescript/lite" },
						{ text: "@moq/hang", link: "/typescript/hang" },
						{ text: "Web Components", link: "/typescript/web-components" },
						{ text: "Examples", link: "/typescript/examples" },
					],
				},
			],

			"/api/": [
				{
					text: "API Reference",
					items: [{ text: "Rust API", link: "/api/rust" }],
				},
			],

			"/contributing/": [
				{
					text: "Contributing",
					items: [
						{ text: "Overview", link: "/contributing/" },
						{ text: "Development Setup", link: "/contributing/development" },
					],
				},
			],
		},

		socialLinks: [
			{ icon: "github", link: "https://github.com/moq-dev/moq" },
			{ icon: "discord", link: "https://discord.gg/FCYF3p99mr" },
		],

		editLink: {
			pattern: "https://github.com/moq-dev/moq/edit/main/docs/:path",
			text: "Edit this page on GitHub",
		},

		search: {
			provider: "local",
		},

		lastUpdated: {
			text: "Last updated",
		},

		footer: {
			message: "Licensed under MIT or Apache-2.0",
			copyright: "Copyright © 2025-present MoQ Contributors",
		},
	},

	markdown: {
		theme: "github-dark",
		lineNumbers: true,
	},

	ignoreDeadLinks: [
		// Localhost links are for local development
		/^https?:\/\/localhost/,
	],
});
