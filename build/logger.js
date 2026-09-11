/**
 * 日志模块
 * 提供统一的日志输出功能
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
/** 日志级别枚举 */
export var LogLevel;
(function (LogLevel) {
    LogLevel["DEBUG"] = "debug";
    LogLevel["INFO"] = "info";
    LogLevel["WARN"] = "warn";
    LogLevel["ERROR"] = "error";
})(LogLevel || (LogLevel = {}));
/** 全局日志文件路径 */
let logFilePath;
/**
 * 设置日志文件路径
 * @param filePath 日志文件路径
 */
export function setLogFile(filePath) {
    logFilePath = filePath;
    // 确保日志目录存在
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}
/**
 * 格式化日志值
 * @param value 要格式化的值
 * @returns 格式化后的字符串
 */
export function formatLogValue(value) {
    if (value === undefined)
        return 'undefined';
    if (value === null)
        return 'null';
    if (typeof value === 'string')
        return value;
    try {
        return JSON.stringify(value, null, 2);
    }
    catch {
        return String(value);
    }
}
/**
 * 通用日志函数
 * @param level 日志级别
 * @param message 日志消息
 * @param args 附加参数
 */
export function log(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    const fullMessage = args.length > 0
        ? `${prefix} ${message} ${formatLogValue(args)}`
        : `${prefix} ${message}`;
    // 输出到控制台
    if (level === LogLevel.ERROR) {
        console.error(fullMessage);
    }
    else {
        console.error(fullMessage);
    }
    // 写入日志文件
    if (logFilePath) {
        try {
            appendFileSync(logFilePath, fullMessage + '\n');
        }
        catch {
            // 忽略写入日志文件错误
        }
    }
}
/**
 * 调试级别日志
 */
export function debugLogger(message, ...args) {
    log(LogLevel.DEBUG, message, ...args);
}
/**
 * 信息级别日志
 */
export function infoLogger(message, ...args) {
    log(LogLevel.INFO, message, ...args);
}
/**
 * 警告级别日志
 */
export function warnLogger(message, ...args) {
    log(LogLevel.WARN, message, ...args);
}
/**
 * 错误级别日志
 */
export function errorLogger(message, ...args) {
    log(LogLevel.ERROR, message, ...args);
}
//# sourceMappingURL=logger.js.map