/**
 * JS 逆向分析扩展工具
 * 从 js-reverse-mcp 移植的调试功能
 * 通过 CDP 协议与小程序通信
 */
import { type ToolDefinition } from './wechat-miniprogram.js';
/**
 * 列出网络请求工具
 */
export declare const listNetworkRequests: ToolDefinition;
/**
 * 清除网络请求工具
 */
export declare const clearNetworkRequests: ToolDefinition;
/**
 * 获取请求发起者工具
 */
export declare const getRequestInitiator: ToolDefinition;
/**
 * XHR/Fetch 断点工具
 * 支持两种模式：
 * 1. AppService 模式（默认）：Hook wx.request 和内部网络层，在 AppService 逻辑层下断点
 * 2. WebView 模式：Hook window.fetch/XHR（仅渲染层有效）
 */
export declare const breakOnXhr: ToolDefinition;
/**
 * 列出脚本工具
 */
export declare const listScripts: ToolDefinition;
/**
 * 保存脚本源码工具
 * 优先从缓存读取，不命中时通过 Debugger.getScriptSource 获取并缓存
 */
export declare const saveScriptSource: ToolDefinition;
/**
 * 列出控制台消息工具
 */
export declare const listConsoleMessages: ToolDefinition;
/**
 * 截图工具
 */
export declare const takeScreenshot: ToolDefinition;
/**
 * 清除站点数据工具
 */
export declare const clearSiteData: ToolDefinition;
/**
 * 点击元素工具
 */
export declare const clickElement: ToolDefinition;
/**
 * 选择框架工具
 */
export declare const selectFrame: ToolDefinition;
/** 所有扩展 JS 逆向工具 */
export declare const jsReverseExtendedTools: ToolDefinition[];
//# sourceMappingURL=js-reverse-extended.d.ts.map