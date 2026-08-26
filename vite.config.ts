import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

import { viteStaticCopy } from 'vite-plugin-static-copy';

const backendTarget = process.env.WEBUI_BACKEND_URL || 'http://localhost:8080';

export const getVitestExclude = (platform: NodeJS.Platform = process.platform) => [
	'.worktrees/**',
	...(platform === 'win32' ? ['scripts/verify-ted-bot-direction-evidence.test.mjs'] : [])
];

export default defineConfig({
	plugins: [
		sveltekit(),
		viteStaticCopy({
			targets: [
				{
					src: 'node_modules/onnxruntime-web/dist/*.jsep.*',

					dest: 'wasm'
				}
			]
		})
	],
	define: {
		APP_VERSION: JSON.stringify(process.env.npm_package_version),
		APP_BUILD_HASH: JSON.stringify(process.env.APP_BUILD_HASH || 'dev-build')
	},
	build: {
		sourcemap: true,
		rollupOptions: {
			// CompanionPanel.svelte dynamically imports @tauri-apps/api/core
			// to call the native show_main_window command. In the browser
			// (and in this static build) the import target is not available,
			// so externalize the Tauri runtime API. The dynamic import is
			// gated behind a 'window.__TAURI_INTERNALS__' guard and never
			// executes outside a Tauri webview; in a normal browser the
			// openMainWindow fallback navigates to '/' instead.
			external: [/^@tauri-apps\/api/]
		}
	},
	server: {
		proxy: {
			'/api': {
				target: backendTarget,
				changeOrigin: true,
				ws: true
			},
			'/ollama': {
				target: backendTarget,
				changeOrigin: true
			},
			'/openai': {
				target: backendTarget,
				changeOrigin: true
			},
			'/oauth': {
				target: backendTarget,
				changeOrigin: true
			},
			'/ws': {
				target: backendTarget,
				changeOrigin: true,
				ws: true
			}
		}
	},
	worker: {
		format: 'es'
	},
	test: {
		exclude: [...configDefaults.exclude, ...getVitestExclude()],
		environmentMatchGlobs: [['src/lib/components/ted-bot/TedBotPet.test.ts', 'jsdom']],
		alias: [
			{
				find: /^svelte$/,
				replacement: new URL('./node_modules/svelte/src/index-client.js', import.meta.url).pathname
			}
		]
	},
	esbuild: {
		pure: process.env.ENV === 'dev' ? [] : ['console.log', 'console.debug', 'console.error']
	}
});
