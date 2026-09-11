/**
 * JS 逆向分析工具
 * 整合 js-reverse-mcp 的调试功能
 * 通过 CDP 协议与小程序通信
 */
import { type ToolDefinition } from './wechat-miniprogram.js';
/**
 * 执行 JavaScript 代码工具
 * 在目标页面中执行任意 JavaScript 代码
 */
export declare const evaluateScript: ToolDefinition;
/**
 * 搜索源代码工具（基于 Script Registry）
 * 优先使用本地源码缓存搜索，不依赖 ExecutionContext
 */
export declare const searchInSources: ToolDefinition;
/**
 * 设置断点工具
 * 基于 scriptId + lineNumber + columnNumber 直接设置断点
 * 支持虚拟脚本（appservice.app.js、https://usr/xxx.js 等）
 */
export declare const setBreakpoint: ToolDefinition;
/**
 * 获取调用栈工具
 */
export declare const getCallStack: ToolDefinition;
/**
 * 监控变量变化工具
 */
export declare const watchVariable: ToolDefinition;
/**
 * 反混淆代码工具
 */
export declare const deobfuscateCode: ToolDefinition;
/**
 * 暂停/恢复执行工具
 */
export declare const pauseOrResume: ToolDefinition;
/**
 * 单步执行工具
 */
export declare const step: ToolDefinition;
/**
 * 获取暂停状态工具
 * 增强版：显示函数参数、局部变量、this 引用和完整调用栈
 */
export declare const getPausedInfo: ToolDefinition;
/**
 * 列出所有断点工具
 */
export declare const listBreakpoints: ToolDefinition;
/**
 * 移除断点工具
 */
export declare const removeBreakpoint: ToolDefinition;
/**
 * 在代码文本处设置断点工具
 * 基于 Script Registry 的本地缓存搜索，在匹配位置设置断点
 */
export declare const setBreakpointOnText: ToolDefinition;
/**
 * 在调用帧上评估表达式工具
 * 在断点暂停时，在指定的调用帧上下文中执行 JavaScript 表达式
 * 可以访问该帧的局部变量、参数和闭包变量
 */
export declare const evaluateOnCallFrame: ToolDefinition;
/**
 * 在指定脚本中搜索工具
 * 针对单个脚本的精确搜索，比 search_in_sources 更快
 */
export declare const searchInScript: ToolDefinition;
/**
 * 获取源码窗口工具
 * 返回指定脚本的指定行范围，对压缩 JS 自动展开
 */
export declare const getSourceRange: ToolDefinition;
/** 所有 JS 逆向工具 */
export declare const jsReverseTools: ToolDefinition[];
//# sourceMappingURL=js-reverse.d.ts.map