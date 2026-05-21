import { defineConfig } from "vite-plus";

export default defineConfig({
	pack: {
		entry: ["src/index.ts"],
		format: ["esm", "cjs"],
		dts: true,
		clean: true,
		outDir: "lib",
		exports: true,
		// image-renderer.ts 用 __dirname 加载 lib/static/*.js(词云脚本)。ESM 产物
		// (.mjs)里 __dirname 不存在 —— 开 shims 让 vp pack 给 ESM 注入 __dirname /
		// __filename shim。CJS 产物原生有 __dirname,shims 对它是 no-op。
		shims: true,
		deps: { onlyBundle: false },
		copy: [{ from: "src/static", to: "lib" }],
	},
});
