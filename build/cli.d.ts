/**
 * CLI 参数解析模块
 * 解析命令行参数
 */
/** CLI 选项接口 */
export interface CliOptions {
    /** 调试服务器端口（小程序连接） */
    debugPort: number;
    /** CDP 代理服务器端口（开发者工具连接） */
    cdpPort: number;
    /** 输出主进程调试信息 */
    debugMain: boolean;
    /** 输出 Frida 客户端信息 */
    debugFrida: boolean;
    /** 日志文件路径 */
    logFile?: string;
    /** 允许读写的根目录 */
    allowedRoots?: string[];
}
/**
 * 解析命令行参数
 * @returns 解析后的选项
 */
export declare function parseCliOptions(): CliOptions;
//# sourceMappingURL=cli.d.ts.map