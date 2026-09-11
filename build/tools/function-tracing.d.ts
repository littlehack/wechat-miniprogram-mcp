/**
 * 函数调用跟踪工具
 * 用于 Hook 函数并记录调用参数、返回值、执行时间
 */
import { type ToolDefinition } from './wechat-miniprogram.js';
/**
 * 函数调用跟踪工具
 * Hook 指定函数，记录每次调用的参数、返回值、调用栈、执行时间
 */
export declare const traceFunction: ToolDefinition;
/**
 * 获取函数跟踪结果工具
 */
export declare const getTraceResults: ToolDefinition;
/**
 * 停止函数跟踪工具
 */
export declare const stopTrace: ToolDefinition;
/**
 * 批量 Hook 工具
 * 同时 Hook 多个函数，常用于批量监控网络请求、加密函数等
 */
export declare const batchHook: ToolDefinition;
/** 函数跟踪工具 */
export declare const functionTracingTools: ToolDefinition[];
//# sourceMappingURL=function-tracing.d.ts.map