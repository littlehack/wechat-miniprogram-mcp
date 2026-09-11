/**
 * Frida 注入模块
 * 负责将 hook 脚本注入到微信小程序进程
 * 基于 WMPFDebugger 的实现
 */
/**
 * 查找并注入到微信小程序进程
 * @param projectRoot 项目根目录
 * @param debugFrida 是否输出 Frida 调试信息
 */
export declare function fridaServer(projectRoot: string, debugFrida: boolean): Promise<void>;
//# sourceMappingURL=frida-inject.d.ts.map