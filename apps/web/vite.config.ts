/// <reference types="vitest" />
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwind()],
	// 4 个 channel hook 的事件分发逻辑已经拆成纯 handler 函数(handleAuthEnvelope /
	// handleLogEnvelope / handleStateEnvelope / handlePushEnvelope),测试不渲染 React,
	// 也就不需要 jsdom — 直接用 vitest 默认 node 环境就够。其余 web 内的工具函数测试
	// 也走这一套。
	test: {
		environment: "node",
		include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
	},
	server: {
		port: 5173,
		proxy: {
			"/api": {
				target: "http://127.0.0.1:8787",
				// http-proxy's default on ECONNREFUSED is 500 + plain-text "Internal
				// Server Error" — indistinguishable from a real server bug. Shape
				// it into 503 + JSON so the dashboard can render "backend down"
				// instead of "something exploded".
				configure(proxy) {
					proxy.on("error", (err, _req, res) => {
						if ("writeHead" in res && !res.headersSent) {
							res.writeHead(503, { "content-type": "application/json" });
							res.end(
								JSON.stringify({
									error: "backend_unreachable",
									message: `apps/server (127.0.0.1:8787) 未启动: ${err.message}`,
								}),
							);
						}
					});
				},
			},
			"/ws": { target: "ws://127.0.0.1:8787", ws: true },
		},
	},
});
