/**
 * 日志模块
 * 提供统一的日志输出功能
 */
/** 日志级别枚举 */
export declare enum LogLevel {
    DEBUG = "debug",
    INFO = "info",
    WARN = "warn",
    ERROR = "error"
}
/**
 * 设置日志文件路径
 * @param filePath 日志文件路径
 */
export declare function setLogFile(filePath: string): void;
/**
 * 格式化日志值
 * @param value 要格式化的值
 * @returns 格式化后的字符串
 */
export declare function formatLogValue(value: unknown): string;
/**
 * 通用日志函数
 * @param level 日志级别
 * @param message 日志消息
 * @param args 附加参数
 */
export declare function log(level: LogLevel, message: string, ...args: unknown[]): void;
/**
 * 调试级别日志
 */
export declare function debugLogger(message: string, ...args: unknown[]): void;
/**
 * 信息级别日志
 */
export declare function infoLogger(message: string, ...args: unknown[]): void;
/**
 * 警告级别日志
 */
export declare function warnLogger(message: string, ...args: unknown[]): void;
/**
 * 错误级别日志
 */
export declare function errorLogger(message: string, ...args: unknown[]): void;
//# sourceMappingURL=logger.d.ts.map