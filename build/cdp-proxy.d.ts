/**
 * CDP 代理服务器模块
 * 整合 WMPFDebugger 的微信小程序调试协议转换功能
 * 将微信小程序的私有调试协议转换为标准 Chrome DevTools Protocol
 *
 * 支持懒加载：仅在 ensureServersStarted() 被调用时启动服务器
 */
/**
 * 等待上下文刷新完成（最多等待 waitMs 毫秒）
 * 当 CDP 客户端连接但 jsContextMap 为空时调用
 */
export declare function waitForContextRefresh(waitMs?: number): Promise<boolean>;
/**
 * 设置目标上下文名称
 * @param name 上下文名称（如 'app', 'page-frame_100' 等），null 则使用最新的
 */
export declare function setTargetContext(name: string | null): void;
/**
 * 获取所有已注册的上下文信息
 */
export declare function getRegisteredContexts(): Array<{
    id: string;
    name: string;
}>;
/**
 * 停止所有服务器
 */
export declare function stopServers(): void;
/**
 * 检查代理服务器是否已启动
 */
export declare function isProxyStarted(): boolean;
/**
 * 检查小程序是否已连接
 */
export declare function isMiniProgramConnected(): boolean;
/**
 * 等待小程序连接
 * @param timeout 超时时间（毫秒）
 * @returns 是否连接成功
 */
export declare function waitForMiniProgram(timeout?: number): Promise<boolean>;
/**
 * 获取服务器启动警告（端口占用等），供工具层向用户报告
 */
export declare function getStartupIssues(): string[];
/**
 * 获取路由诊断信息（上下文、脚本归属数量等）
 */
export declare function getRoutingDiagnostics(): {
    contexts: Array<{
        id: string;
        name: string;
    }>;
    trackedScripts: number;
    targetContextName: string | null;
};
/**
 * 确保服务器已启动（懒加载）
 * 仅在首次调用时启动调试服务器和 CDP 代理服务器
 * 如果端口已被占用（如独立运行的 WMPFDebugger），则跳过启动并记录警告
 * @param debugPort 调试服务器端口
 * @param cdpPort CDP 代理服务器端口
 * @param debugMain 是否输出主进程调试信息
 */
export declare function ensureServersStarted(debugPort: number, cdpPort: number, debugMain: boolean): void;
/**
 * 启动调试服务器（小程序连接端）
 * 接收微信小程序的私有协议消息，解码后转发给 CDP 客户端
 * @param debugPort 调试服务器端口
 * @param debugMain 是否输出主进程调试信息
 */
export declare function startDebugServer(debugPort: number, debugMain: boolean): void;
/**
 * 启动 CDP 代理服务器（开发者工具连接端）
 * 接收标准 CDP 消息，转发给小程序调试服务器
 * @param cdpPort CDP 代理服务器端口
 */
export declare function startCdpProxyServer(cdpPort: number): void;
//# sourceMappingURL=cdp-proxy.d.ts.map