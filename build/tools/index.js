/**
 * 工具模块索引
 * 导出所有工具定义
 *
 * 工具分类：
 * - jsReverseTools: JS 逆向核心工具（脚本枚举、搜索、源码、断点、调试）
 * - jsReverseExtendedTools: JS 逆向扩展工具（网络、控制台、截图、交互）
 * - functionTracingTools: 函数调用跟踪工具（Hook、记录调用参数返回值）
 * - wechatTools: 微信小程序专用工具（仅在微信环境使用）
 */
export { wechatTools, connectCdp, disconnectCdp, getMiniProgramStatus, listContexts, switchContext, interceptNetworkRequests, extractCodeBundle, getScriptSource, hookMiniProgramApi, getStorageData, analyzeEncryptionParams, extractPageBusinessLogic, searchAndAutoBreak, captureAppServiceNetwork } from './wechat-miniprogram.js';
export { jsReverseTools, evaluateScript, searchInSources, searchInScript, getSourceRange, setBreakpoint, getCallStack, watchVariable, deobfuscateCode, getPausedInfo, listBreakpoints, removeBreakpoint, setBreakpointOnText, evaluateOnCallFrame } from './js-reverse.js';
export { jsReverseExtendedTools, listNetworkRequests, clearNetworkRequests, getRequestInitiator, breakOnXhr, listScripts, saveScriptSource, listConsoleMessages, takeScreenshot, clearSiteData, clickElement, selectFrame } from './js-reverse-extended.js';
export { functionTracingTools, traceFunction, getTraceResults, stopTrace, batchHook } from './function-tracing.js';
export { ToolCategory } from './wechat-miniprogram.js';
//# sourceMappingURL=index.js.map