/**
 * JS 逆向分析扩展工具
 * 从 js-reverse-mcp 移植的调试功能
 * 通过 CDP 协议与小程序通信
 */
import { z } from 'zod';
import { getCDPClient } from '../cdp-client.js';
import { ToolCategory } from './wechat-miniprogram.js';
/**
 * 列出网络请求工具
 */
export const listNetworkRequests = {
    name: 'list_network_requests',
    description: '列出捕获的 HTTP/HTTPS 网络请求，支持按方法、URL 等过滤',
    category: ToolCategory.NETWORK,
    schema: {
        reqid: z.number().optional().describe('请求 ID（从列表中获取）'),
        pageSize: z.number().optional().describe('每页数量（默认 20）'),
        pageIdx: z.number().optional().describe('页码（从 0 开始）'),
        methods: z.array(z.string()).optional().describe('HTTP 方法过滤（GET, POST 等）'),
        urlFilter: z.string().optional().describe('URL 过滤关键词'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            // 确保 Network 域已启用
            if (!client.isNetworkEnabled()) {
                await client.enableNetwork();
            }
            // 如果指定了 reqid，返回单个请求详情
            if (params.reqid !== undefined) {
                const request = client.getNetworkRequestById(params.reqid);
                if (!request) {
                    return {
                        status: 'not_found',
                        message: `未找到请求 ID: ${params.reqid}`,
                    };
                }
                return {
                    status: 'success',
                    request,
                    message: `请求详情: ${request.method} ${request.url}`,
                };
            }
            // 获取过滤后的请求列表
            const result = client.getNetworkRequestsFiltered({
                pageSize: params.pageSize,
                pageIdx: params.pageIdx,
                methods: params.methods,
                urlFilter: params.urlFilter,
            });
            return {
                status: 'success',
                requests: result.requests.map(r => ({
                    reqid: r.requestId,
                    method: r.method,
                    url: r.url,
                    status: r.status,
                    timestamp: r.timestamp,
                })),
                total: result.total,
                page: result.page,
                pageSize: result.pageSize,
                message: `共 ${result.total} 个请求，显示第 ${result.page + 1} 页`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `获取网络请求失败: ${e.message}`,
            };
        }
    },
};
/**
 * 清除网络请求工具
 */
export const clearNetworkRequests = {
    name: 'clear_network_requests',
    description: '清除所有捕获的网络请求记录',
    category: ToolCategory.NETWORK,
    schema: {
        confirm: z.boolean().optional().describe('确认清除（默认 true）'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            if (params.confirm === false) {
                return {
                    status: 'cancelled',
                    message: '已取消清除操作',
                };
            }
            const result = client.clearNetworkRequests();
            return {
                status: 'cleared',
                requestCount: result.requestCount,
                reclaimedBytes: result.reclaimedBytes,
                message: `已清除 ${result.requestCount} 个请求，释放 ${result.reclaimedBytes} 字节`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `清除网络请求失败: ${e.message}`,
            };
        }
    },
};
/**
 * 获取请求发起者工具
 */
export const getRequestInitiator = {
    name: 'get_request_initiator',
    description: '获取网络请求的发起调用栈，用于追踪请求来源',
    category: ToolCategory.NETWORK,
    schema: {
        reqid: z.number().describe('请求 ID'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            const request = client.getNetworkRequestById(params.reqid);
            if (!request) {
                return {
                    status: 'not_found',
                    message: `未找到请求 ID: ${params.reqid}`,
                };
            }
            // 如果有 initiator 信息，返回它
            if (request.initiator) {
                return {
                    status: 'success',
                    request: {
                        url: request.url,
                        method: request.method,
                    },
                    initiator: request.initiator,
                    message: `请求发起者类型: ${request.initiator.type}`,
                };
            }
            // 否则提示用户设置 XHR 断点
            return {
                status: 'no_initiator',
                request: {
                    url: request.url,
                    method: request.method,
                },
                message: '未捕获到发起者信息。建议使用 break_on_xhr 设置断点后重新触发请求',
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `获取请求发起者失败: ${e.message}`,
            };
        }
    },
};
/**
 * XHR/Fetch 断点工具
 * 支持两种模式：
 * 1. AppService 模式（默认）：Hook wx.request 和内部网络层，在 AppService 逻辑层下断点
 * 2. WebView 模式：Hook window.fetch/XHR（仅渲染层有效）
 */
export const breakOnXhr = {
    name: 'break_on_xhr',
    description: '设置网络请求断点。AppService 模式下 hook wx.request 和内部 t.request/Ka 等网络函数，在逻辑层业务代码中暂停；WebView 模式 hook fetch/XHR（仅渲染层）',
    category: ToolCategory.DEBUGGER,
    schema: {
        url: z.string().describe('URL 匹配关键词（区分大小写）'),
        mode: z.enum(['appservice', 'webview']).optional().describe('断点模式：appservice=逻辑层（默认），webview=渲染层'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            const mode = params.mode || 'appservice';
            if (mode === 'webview') {
                // 原有 WebView 模式：Hook fetch/XHR
                if (!client.isDebuggerEnabled()) {
                    await client.enableDebugger();
                }
                await client.setXHRBreakpoint(params.url);
                return {
                    status: 'breakpoint_set',
                    mode: 'webview',
                    urlPattern: params.url,
                    message: `WebView XHR 断点已设置，当请求 URL 包含 "${params.url}" 时将暂停执行（仅渲染层有效）`,
                };
            }
            // AppService 模式：Hook wx.request 和内部网络层
            // 确保 AppService Debugger 已启用
            await client.ensureAppServiceContext();
            if (!client.isAppServiceDebuggerEnabled()) {
                try {
                    await client.enableAppServiceDebugger();
                }
                catch {
                    await client.sendCommand('Debugger.enable');
                }
            }
            await new Promise(r => setTimeout(r, 1000));
            // 方案1：在 AppService 中注入 wx.request Hook
            const hookScript = `
        (function() {
          if (window.__mcp_appservice_xhr_hook__) return 'already_hooked';
          window.__mcp_appservice_xhr_hook__ = true;
          
          const targetUrl = ${JSON.stringify(params.url)};
          
          // Hook wx.request
          if (typeof wx !== 'undefined' && typeof wx.request === 'function') {
            const originalWxRequest = wx.request;
            wx.request = function(options) {
              const url = (options && options.url) || '';
              if (url.includes(targetUrl)) {
                console.log('[MCP AppService Breakpoint] wx.request:', url);
                debugger; // 触发 Debugger.paused
              }
              return originalWxRequest.apply(this, arguments);
            };
          }
          
          // Hook wx.downloadFile
          if (typeof wx !== 'undefined' && typeof wx.downloadFile === 'function') {
            const originalWxDownload = wx.downloadFile;
            wx.downloadFile = function(options) {
              const url = (options && options.url) || '';
              if (url.includes(targetUrl)) {
                console.log('[MCP AppService Breakpoint] wx.downloadFile:', url);
                debugger;
              }
              return originalWxDownload.apply(this, arguments);
            };
          }
          
          // Hook wx.uploadFile
          if (typeof wx !== 'undefined' && typeof wx.uploadFile === 'function') {
            const originalWxUpload = wx.uploadFile;
            wx.uploadFile = function(options) {
              const url = (options && options.url) || '';
              if (url.includes(targetUrl)) {
                console.log('[MCP AppService Breakpoint] wx.uploadFile:', url);
                debugger;
              }
              return originalWxUpload.apply(this, arguments);
            };
          }
          
          // Hook 内部网络层（尝试常见的混淆变量名）
          // 小程序框架内部网络请求函数通常存储在全局或模块闭包中
          try {
            // 常见的内部请求函数名模式
            const internalNames = ['t', 'e', 'n', 'r', 'i', 'o', 'a'];
            for (const name of internalNames) {
              if (typeof window[name] === 'function') {
                const originalFn = window[name];
                const fnStr = originalFn.toString();
                // 检查是否是网络请求函数（包含 request/https/http 等关键词）
                if (fnStr.includes('request') || fnStr.includes('https://') || fnStr.includes('http://')) {
                  window[name] = function() {
                    const args = Array.from(arguments);
                    const urlArg = args.find(a => typeof a === 'string' && (a.includes('http') || a.includes('/')));
                    if (urlArg && urlArg.includes(targetUrl)) {
                      console.log('[MCP AppService Breakpoint] internal:', name, urlArg);
                      debugger;
                    }
                    return originalFn.apply(this, arguments);
                  };
                }
              }
            }
          } catch(e) {
            // 忽略内部 Hook 错误
          }
          
          return JSON.stringify({
            status: 'hooked',
            target: targetUrl,
            hooked_apis: ['wx.request', 'wx.downloadFile', 'wx.uploadFile'],
          });
        })()
      `;
            const result = await client.evaluateScript(hookScript, undefined, 'app');
            const hookResult = result?.result?.value ? JSON.parse(result.result.value) : null;
            // 方案2：搜索 AppService 脚本中的网络请求函数并设置 Debugger 断点
            const networkMatches = await client.searchInAllScripts('t.request') || [];
            const wxRequestMatches = await client.searchInAllScripts('wx.request') || [];
            // 尝试在找到的网络请求函数处设置断点
            let autoBreakpointId = null;
            const allNetworkMatches = [...networkMatches, ...wxRequestMatches];
            if (allNetworkMatches.length > 0) {
                const firstMatch = allNetworkMatches[0];
                try {
                    const bpInfo = await client.setBreakpointOnAppService(firstMatch.scriptId, firstMatch.lineNumber, firstMatch.columnNumber || 0);
                    autoBreakpointId = bpInfo.breakpointId;
                }
                catch {
                    // 忽略
                }
            }
            return {
                status: 'breakpoint_set',
                mode: 'appservice',
                urlPattern: params.url,
                hook_result: hookResult,
                auto_breakpoint: autoBreakpointId ? {
                    breakpoint_id: autoBreakpointId,
                    source: allNetworkMatches[0] ? {
                        script_id: allNetworkMatches[0].scriptId,
                        url: allNetworkMatches[0].url,
                        line: allNetworkMatches[0].lineNumber + 1,
                    } : null,
                } : null,
                message: `AppService 网络断点已设置。当 URL 包含 "${params.url}" 的 wx.request/wx.downloadFile/wx.uploadFile 调用时将暂停`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `设置 XHR 断点失败: ${e.message}`,
            };
        }
    },
};
/**
 * 列出脚本工具
 */
export const listScripts = {
    name: 'list_scripts',
    description: '列出所有已加载的 JavaScript 脚本',
    category: ToolCategory.SCRIPT,
    schema: {
        filter: z.string().optional().describe('URL 过滤关键词'),
        pageSize: z.number().optional().describe('每页数量（默认 20）'),
        pageIdx: z.number().optional().describe('页码（从 0 开始）'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            // 确保 Debugger 已启用
            if (!client.isDebuggerEnabled()) {
                await client.enableDebuggerAndWaitScripts(3000);
            }
            let scripts = client.getParsedScripts();
            // 应用过滤
            if (params.filter) {
                const lowerFilter = params.filter.toLowerCase();
                scripts = scripts.filter(s => s.url && s.url.toLowerCase().includes(lowerFilter));
            }
            const total = scripts.length;
            const pageSize = params.pageSize || 20;
            const page = params.pageIdx || 0;
            const start = page * pageSize;
            const end = start + pageSize;
            const paginatedScripts = scripts.slice(start, end);
            const cacheStats = client.getSourceCacheStats();
            return {
                status: 'success',
                scripts: paginatedScripts.map(s => ({
                    scriptId: s.scriptId,
                    url: s.url || '(inline)',
                    startLine: s.startLine,
                    endLine: s.endLine,
                    hash: s.hash,
                })),
                total,
                page,
                pageSize,
                cache: {
                    cachedScripts: cacheStats.cachedScripts,
                    totalSizeBytes: cacheStats.totalSizeBytes,
                    compressedCount: cacheStats.compressedCount,
                },
                message: `共 ${total} 个脚本，显示第 ${page + 1} 页，已缓存 ${cacheStats.cachedScripts} 个`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `获取脚本列表失败: ${e.message}`,
            };
        }
    },
};
/**
 * 保存脚本源码工具
 * 优先从缓存读取，不命中时通过 Debugger.getScriptSource 获取并缓存
 */
export const saveScriptSource = {
    name: 'save_script_source',
    description: '保存脚本源码到本地文件。优先使用本地缓存，不命中时通过 Debugger.getScriptSource 获取',
    category: ToolCategory.SCRIPT,
    schema: {
        scriptId: z.string().optional().describe('脚本 ID'),
        url: z.string().optional().describe('脚本 URL（与 scriptId 二选一）'),
        filePath: z.string().describe('保存路径'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            let scriptId = params.scriptId;
            // 如果提供了 URL，查找对应的 scriptId
            if (!scriptId && params.url) {
                const scripts = client.getParsedScripts();
                const script = scripts.find(s => s.url && s.url.includes(params.url));
                if (script) {
                    scriptId = script.scriptId;
                }
                else {
                    return {
                        status: 'not_found',
                        message: `未找到 URL 包含 "${params.url}" 的脚本`,
                    };
                }
            }
            if (!scriptId) {
                return {
                    status: 'error',
                    message: '请提供 scriptId 或 url 参数',
                };
            }
            // 优先从缓存获取
            let entry = await client.getSourceWithCache(scriptId);
            if (!entry) {
                return {
                    status: 'not_found',
                    message: `无法获取脚本 ${scriptId} 的源码`,
                };
            }
            const source = entry.source;
            // 保存到文件
            const fs = await import('node:fs');
            const path = await import('node:path');
            const dir = path.dirname(params.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(params.filePath, source, 'utf8');
            return {
                status: 'saved',
                scriptId,
                filePath: params.filePath,
                size: source.length,
                is_compressed: entry.isCompressed,
                url: entry.url,
                message: `脚本源码已保存到 ${params.filePath} (${source.length} 字符, compressed=${entry.isCompressed})`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `保存脚本源码失败: ${e.message}`,
            };
        }
    },
};
/**
 * 列出控制台消息工具
 */
export const listConsoleMessages = {
    name: 'list_console_messages',
    description: '列出捕获的控制台消息',
    category: ToolCategory.DEBUGGER,
    schema: {
        pageSize: z.number().optional().describe('每页数量（默认 20）'),
        pageIdx: z.number().optional().describe('页码（从 0 开始）'),
        types: z.array(z.string()).optional().describe('消息类型过滤（log, error, warn, info 等）'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            // 确保 Runtime 已启用
            if (!client.isConsoleEnabled()) {
                await client.enableConsole();
            }
            const result = client.getConsoleMessagesPaginated({
                pageSize: params.pageSize,
                pageIdx: params.pageIdx,
                types: params.types,
            });
            return {
                status: 'success',
                messages: result.messages.map(m => ({
                    id: m.id,
                    type: m.type,
                    text: m.text,
                    timestamp: m.timestamp,
                    url: m.url,
                    lineNumber: m.lineNumber,
                })),
                total: result.total,
                page: result.page,
                pageSize: result.pageSize,
                message: `共 ${result.total} 条消息，显示第 ${result.page + 1} 页`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `获取控制台消息失败: ${e.message}`,
            };
        }
    },
};
/**
 * 截图工具
 */
export const takeScreenshot = {
    name: 'take_screenshot',
    description: '截取当前页面的截图',
    category: ToolCategory.SCRIPT,
    schema: {
        format: z.enum(['png', 'jpeg', 'webp']).optional().describe('图片格式（默认 png）'),
        quality: z.number().optional().describe('图片质量（仅 jpeg/webp，0-100）'),
        fullPage: z.boolean().optional().describe('是否截取整个页面（默认 false）'),
        savePath: z.string().optional().describe('保存路径（不指定则返回 base64）'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            const base64Data = await client.captureScreenshot({
                format: params.format,
                quality: params.quality,
                fullPage: params.fullPage,
            });
            // 如果指定了保存路径，保存到文件
            if (params.savePath) {
                const fs = await import('node:fs');
                const path = await import('node:path');
                const dir = path.dirname(params.savePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                const buffer = Buffer.from(base64Data, 'base64');
                fs.writeFileSync(params.savePath, buffer);
                return {
                    status: 'saved',
                    filePath: params.savePath,
                    size: buffer.length,
                    format: params.format || 'png',
                    message: `截图已保存到 ${params.savePath} (${buffer.length} 字节)`,
                };
            }
            // 否则返回 base64 数据
            return {
                status: 'captured',
                format: params.format || 'png',
                data: base64Data.substring(0, 100) + '...(truncated)',
                fullDataLength: base64Data.length,
                message: `截图已捕获 (${base64Data.length} 字符 base64)`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `截图失败: ${e.message}`,
            };
        }
    },
};
/**
 * 清除站点数据工具
 */
export const clearSiteData = {
    name: 'clear_site_data',
    description: '清除站点数据（cookies、缓存、存储等）',
    category: ToolCategory.NETWORK,
    schema: {
        cookies: z.boolean().optional().describe('是否清除 cookies（默认 true）'),
        localStorage: z.boolean().optional().describe('是否清除 localStorage（默认 true）'),
        sessionStorage: z.boolean().optional().describe('是否清除 sessionStorage（默认 true）'),
        cache: z.boolean().optional().describe('是否清除缓存（默认 true）'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            const result = await client.clearSiteData({
                cookies: params.cookies,
                localStorage: params.localStorage,
                sessionStorage: params.sessionStorage,
                cache: params.cache,
            });
            return {
                status: 'cleared',
                cleared: result.cleared,
                message: `已清除: ${result.cleared.join(', ') || '无'}`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `清除站点数据失败: ${e.message}`,
            };
        }
    },
};
/**
 * 点击元素工具
 */
export const clickElement = {
    name: 'click_element',
    description: '点击页面元素（使用 CSS 选择器）',
    category: ToolCategory.DEBUGGER,
    schema: {
        selector: z.string().describe('CSS 选择器'),
        index: z.number().optional().describe('匹配索引（当多个元素匹配时，默认 0）'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            const index = params.index || 0;
            const script = `
        (function() {
          const elements = document.querySelectorAll('${params.selector.replace(/'/g, "\\'")}');
          if (elements.length === 0) {
            return JSON.stringify({error: 'No elements found'});
          }
          if (${index} >= elements.length) {
            return JSON.stringify({error: 'Index out of range', count: elements.length});
          }
          const element = elements[${index}];
          element.click();
          return JSON.stringify({
            success: true,
            tagName: element.tagName,
            id: element.id,
            className: element.className,
          });
        })()
      `;
            const result = await client.evaluateScript(script);
            const parsed = result?.result?.value ? JSON.parse(result.result.value) : null;
            if (parsed?.error) {
                return {
                    status: 'error',
                    message: parsed.error,
                };
            }
            return {
                status: 'clicked',
                selector: params.selector,
                index,
                element: parsed,
                message: `已点击元素: ${parsed?.tagName}#${parsed?.id || ''}`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `点击元素失败: ${e.message}`,
            };
        }
    },
};
/**
 * 选择框架工具
 */
export const selectFrame = {
    name: 'select_frame',
    description: '获取页面中的所有框架（iframe）',
    category: ToolCategory.DEBUGGER,
    schema: {},
    handler: async () => {
        const client = getCDPClient();
        try {
            await client.connect();
            const frames = await client.getFrames();
            return {
                status: 'success',
                frames: frames.map((f, index) => ({
                    index,
                    id: f.id,
                    url: f.url,
                    name: f.name,
                    parentId: f.parentId,
                })),
                total: frames.length,
                message: `找到 ${frames.length} 个框架`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `获取框架列表失败: ${e.message}`,
            };
        }
    },
};
/** 所有扩展 JS 逆向工具 */
export const jsReverseExtendedTools = [
    listNetworkRequests,
    clearNetworkRequests,
    getRequestInitiator,
    breakOnXhr,
    listScripts,
    saveScriptSource,
    listConsoleMessages,
    takeScreenshot,
    clearSiteData,
    clickElement,
    selectFrame,
];
//# sourceMappingURL=js-reverse-extended.js.map