/**
 * 浏览器自动打开模块
 * 在 MCP 服务器启动时自动打开 Chrome DevTools 调试链接
 * 参考 chrome-devtools-mcp 的实现方式，使用 puppeteer 启动 Chrome
 */
/**
 * 自动打开 Chrome DevTools 调试链接
 * @param cdpPort CDP 端口号
 * @param delay 延迟时间（毫秒），等待服务器启动
 */
export declare function autoOpenDevTools(cdpPort: number, delay?: number): void;
/**
 * 关闭浏览器实例
 */
export declare function closeBrowser(): void;
//# sourceMappingURL=browser-opener.d.ts.map