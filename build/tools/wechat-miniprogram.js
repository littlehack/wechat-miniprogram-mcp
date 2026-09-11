/**
 * 微信小程序逆向工具定义
 * 提供微信小程序特有的逆向分析功能
 * 通过 CDP 协议与小程序通信
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { getCDPClient, resetCDPClient } from '../cdp-client.js';
import { ensureServersStarted, isProxyStarted, waitForMiniProgram, isMiniProgramConnected, getStartupIssues } from '../cdp-proxy.js';
import { infoLogger, errorLogger } from '../logger.js';
import { fridaServer } from '../frida-inject.js';
import { autoOpenDevTools } from '../browser-opener.js';
/** 工具分类枚举 */
export var ToolCategory;
(function (ToolCategory) {
    /** 小程序专用工具 */
    ToolCategory["MINIPROGRAM"] = "miniprogram";
    /** 网络相关工具 */
    ToolCategory["NETWORK"] = "network";
    /** 脚本相关工具 */
    ToolCategory["SCRIPT"] = "script";
    /** 调试相关工具 */
    ToolCategory["DEBUGGER"] = "debugger";
})(ToolCategory || (ToolCategory = {}));
/**
 * 连接 CDP 工具
 * 手动启动调试服务器和 CDP 代理，并连接到微信小程序
 */
export const connectCdp = {
    name: 'connect_cdp',
    description: '手动启动 CDP 代理服务器并连接到微信小程序。在使用其他工具前调用此工具，或在连接断开后重新连接',
    category: ToolCategory.MINIPROGRAM,
    schema: {
        cdp_port: z.number().optional().describe('CDP 代理端口（默认 62000）'),
        debug_port: z.number().optional().describe('调试服务器端口（默认 9421）'),
        inject_frida: z.boolean().optional().describe('是否注入 Frida hook（默认 true，需要 WeChatAppEx.exe 进程运行）'),
        wait_for_miniprogram: z.boolean().optional().describe('是否等待小程序连接（默认 true）'),
        timeout: z.number().optional().describe('等待小程序连接的超时时间，毫秒（默认 60000）'),
        auto_open_devtools: z.boolean().optional().describe('是否自动打开 Chrome DevTools（默认 true）'),
    },
    handler: async (params) => {
        const cdpPort = params.cdp_port || 62000;
        const debugPort = params.debug_port || 9421;
        const injectFrida = params.inject_frida !== false;
        const wait_for_miniprogram = params.wait_for_miniprogram !== false;
        const timeout = params.timeout || 60000;
        const autoOpen = params.auto_open_devtools !== false;
        try {
            // 启动服务器（如果尚未启动）
            ensureServersStarted(debugPort, cdpPort, false);
            // 获取启动警告
            const startupIssues = getStartupIssues();
            if (startupIssues.length > 0) {
                infoLogger('[connect_cdp] 启动警告:', startupIssues.join('\n'));
            }
            // 自动打开 Chrome DevTools（除非用户明确禁用）
            if (autoOpen) {
                autoOpenDevTools(cdpPort, 1000);
            }
            // 注入 Frida hook（如果启用）
            if (injectFrida) {
                infoLogger('[connect_cdp] 正在注入 Frida hook...');
                const __filename = fileURLToPath(import.meta.url);
                const projectRoot = path.join(path.dirname(__filename), '../..');
                try {
                    await fridaServer(projectRoot, false);
                    infoLogger('[connect_cdp] Frida 注入完成');
                }
                catch (fridaError) {
                    const errMsg = fridaError instanceof Error ? fridaError.message : String(fridaError);
                    errorLogger('[connect_cdp] Frida 注入失败:', errMsg);
                    infoLogger('[connect_cdp] 继续 without Frida，但小程序可能无法连接');
                }
            }
            // 等待小程序连接（如果启用）
            if (wait_for_miniprogram && !isMiniProgramConnected()) {
                infoLogger(`[connect_cdp] 等待小程序连接... (超时: ${timeout / 1000}秒)`);
                const connected = await waitForMiniProgram(timeout);
                if (!connected) {
                    return {
                        status: 'waiting',
                        cdp_connected: false,
                        cdp_port: cdpPort,
                        debug_port: debugPort,
                        frida_injected: injectFrida,
                        startup_issues: startupIssues,
                        message: `等待小程序连接超时 (${timeout / 1000}秒)。请确保：\n1. PC 端微信已打开小程序\n2. 小程序已加载完成\n\nCDP 代理已就绪: devtools://devtools/bundled/inspector.html?ws=127.0.0.1:${cdpPort}`,
                    };
                }
                infoLogger('[connect_cdp] 小程序已连接');
            }
            // 连接 CDP 客户端
            const client = getCDPClient(cdpPort, debugPort, false);
            await client.connect();
            // 等待小程序完全加载
            infoLogger('[connect_cdp] 等待小程序完全加载...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            // 启用 Debugger 域并收集脚本
            // 重要原则：不依赖 ExecutionContext
            // 直接启用 Debugger，收集 scriptParsed 事件
            infoLogger('[connect_cdp] 启用 Debugger 域，收集脚本...');
            let scripts = await client.enableDebuggerAndWaitScripts(5000);
            infoLogger(`[connect_cdp] 首次收集到 ${scripts.length} 个脚本`);
            // 如果脚本数量太少，尝试刷新页面并重新收集
            if (scripts.length < 5) {
                infoLogger('[connect_cdp] 脚本数量较少，尝试刷新页面触发完整加载...');
                try {
                    await client.sendCommand('Page.enable');
                    await client.sendCommand('Page.reload', { ignoreCache: false });
                    // 等待页面刷新完成
                    await new Promise(resolve => setTimeout(resolve, 8000));
                    // 重新收集脚本
                    scripts = await client.enableDebuggerAndWaitScripts(8000);
                    infoLogger(`[connect_cdp] 刷新后收集到 ${scripts.length} 个脚本`);
                }
                catch (reloadError) {
                    infoLogger(`[connect_cdp] 刷新页面失败: ${reloadError}`);
                }
            }
            // 等待更多脚本加载
            if (scripts.length > 0 && scripts.length < 50) {
                infoLogger('[connect_cdp] 等待更多脚本加载...');
                await new Promise(resolve => setTimeout(resolve, 5000));
                const moreScripts = await client.enableDebuggerAndWaitScripts(3000);
                if (moreScripts.length > scripts.length) {
                    scripts = moreScripts;
                    infoLogger(`[connect_cdp] 最终收集到 ${scripts.length} 个脚本`);
                }
            }
            // 启用 Network 域
            try {
                await client.enableNetwork();
                infoLogger('[connect_cdp] Network 域已启用');
            }
            catch (e) {
                infoLogger(`[connect_cdp] 启用 Network 域失败: ${e}`);
            }
            // 预缓存所有脚本源码
            infoLogger('[connect_cdp] 预缓存脚本源码...');
            const cachedCount = await client.cacheAllSources();
            infoLogger(`[connect_cdp] 已缓存 ${cachedCount} 个脚本源码`);
            const cacheStats = client.getSourceCacheStats();
            // 检测层信息（通过脚本 URL 判断，不依赖 ExecutionContext）
            let layer = 'unknown';
            const scriptUrls = scripts.map(s => s.url);
            if (scriptUrls.some(u => u.includes('appservice.app.js') || u.includes('appservice'))) {
                layer = 'appservice(逻辑层)';
            }
            else if (scriptUrls.some(u => u.includes('webview') || u.includes('render'))) {
                layer = 'webview(渲染层)';
            }
            infoLogger('[connect_cdp] 连接成功');
            return {
                status: 'connected',
                cdp_connected: true,
                cdp_port: cdpPort,
                debug_port: debugPort,
                frida_injected: injectFrida,
                miniprogram_connected: isMiniProgramConnected(),
                startup_issues: startupIssues,
                layer_info: {
                    layer,
                    script_urls_sample: scriptUrls.slice(0, 5),
                },
                scripts_count: scripts.length,
                source_cache: {
                    cached_scripts: cacheStats.cachedScripts,
                    total_size_bytes: cacheStats.totalSizeBytes,
                    compressed_count: cacheStats.compressedCount,
                },
                message: `CDP 已连接，收集到 ${scripts.length} 个脚本，已缓存 ${cachedCount} 个源码。当前层：${layer}。Debugger 已启用，可直接使用 source/breakpoint 功能。`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                cdp_connected: false,
                startup_issues: getStartupIssues(),
                message: `连接失败: ${e.message}。请确保微信小程序已打开`,
            };
        }
    },
};
/**
 * 断开 CDP 连接工具
 */
export const disconnectCdp = {
    name: 'disconnect_cdp',
    description: '断开 CDP 连接并关闭代理服务器',
    category: ToolCategory.MINIPROGRAM,
    schema: {},
    handler: async () => {
        try {
            resetCDPClient();
            infoLogger('[disconnect_cdp] 已断开连接');
            return {
                status: 'disconnected',
                message: 'CDP 连接已断开',
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `断开失败: ${e.message}`,
            };
        }
    },
};
/**
 * 获取微信小程序状态工具
 */
export const getMiniProgramStatus = {
    name: 'get_miniprogram_status',
    description: '获取当前微信小程序运行状态，包括进程信息、WMPF 版本、连接状态等',
    category: ToolCategory.MINIPROGRAM,
    schema: {},
    handler: async () => {
        const client = getCDPClient();
        try {
            await client.connect();
            const result = await client.evaluateScript(`
        JSON.stringify({
          url: window.location?.href || 'unknown',
          title: document.title || 'unknown',
          hasWindow: typeof window !== 'undefined',
          hasDocument: typeof document !== 'undefined',
          cookies: document.cookie || '',
          userAgent: navigator.userAgent || '',
        })
      `);
            return {
                status: 'connected',
                cdp_connected: true,
                proxy_started: isProxyStarted(),
                page_info: result?.result?.value ? JSON.parse(result.result.value) : null,
                message: '微信小程序调试服务运行中，CDP 已连接',
            };
        }
        catch (e) {
            return {
                status: 'disconnected',
                cdp_connected: false,
                proxy_started: isProxyStarted(),
                message: `CDP 未连接: ${e.message}。请先调用 connect_cdp 工具`,
            };
        }
    },
};
/**
 * 拦截小程序网络请求工具
 */
export const interceptNetworkRequests = {
    name: 'intercept_network_requests',
    description: '拦截微信小程序的网络请求，记录 API 调用和数据传输',
    category: ToolCategory.NETWORK,
    schema: {
        url_filter: z.string().optional().describe('URL 过滤条件（支持通配符）'),
        method: z.string().optional().describe('HTTP 方法过滤（GET, POST 等）'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        const urlFilter = params.url_filter || '*';
        const method = params.method || 'ALL';
        try {
            await client.connect();
            // 注入网络请求拦截脚本
            const script = `
        (function() {
          if (window.__mcp_network_interceptor__) {
            return 'already_intercepting';
          }
          window.__mcp_network_interceptor__ = true;
          window.__mcp_network_requests__ = [];

          const originalFetch = window.fetch;
          window.fetch = function(...args) {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
            const method = args[1]?.method || 'GET';
            window.__mcp_network_requests__.push({
              type: 'fetch',
              url: url,
              method: method,
              time: Date.now(),
            });
            return originalFetch.apply(this, args);
          };

          const originalXHR = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this.__mcp_url = url;
            this.__mcp_method = method;
            window.__mcp_network_requests__.push({
              type: 'xhr',
              url: url,
              method: method,
              time: Date.now(),
            });
            return originalXHR.call(this, method, url, ...rest);
          };

          return 'interceptor_installed';
        })()
      `;
            await client.evaluateScript(script);
            return {
                status: 'intercepting',
                url_filter: urlFilter,
                method: method,
                message: '网络请求拦截已安装。使用 get_captured_requests 获取捕获的请求',
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `拦截失败: ${e.message}`,
            };
        }
    },
};
/**
 * 提取小程序代码包工具
 * 保存脚本到本地目录，按虚拟文件系统组织（类似 Chrome DevTools Sources 面板）
 */
export const extractCodeBundle = {
    name: 'extract_code_bundle',
    description: '提取微信小程序的 JavaScript 代码包，按虚拟文件系统保存到本地目录',
    category: ToolCategory.SCRIPT,
    schema: {
        save_path: z.string().optional().describe('代码包保存路径（默认 ./miniprogram_scripts）'),
        wait_ms: z.number().optional().describe('启用 Debugger 后等待脚本解析的时间（毫秒），默认 8000'),
        retry_count: z.number().optional().describe('刷新页面重试次数（默认 2），用于确保获取完整脚本'),
    },
    handler: async (params) => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const client = getCDPClient();
        try {
            await client.connect();
            const waitMs = params.wait_ms || 8000;
            const savePath = params.save_path || './miniprogram_scripts';
            const retryCount = params.retry_count || 2;
            let allScripts = [];
            // 多次尝试收集脚本，确保完整性
            // 重要：不依赖 ExecutionContext，直接使用 Debugger 收集
            for (let attempt = 0; attempt <= retryCount; attempt++) {
                if (attempt > 0) {
                    infoLogger(`[extract_code_bundle] 第 ${attempt + 1} 次尝试，刷新页面...`);
                    try {
                        await client.sendCommand('Page.enable');
                        await client.sendCommand('Page.reload', { ignoreCache: false });
                        // 等待页面刷新完成
                        await new Promise(resolve => setTimeout(resolve, 8000));
                    }
                    catch (e) {
                        infoLogger(`[extract_code_bundle] 刷新失败: ${e}`);
                    }
                }
                // 启用 Debugger 域，收集所有 scriptParsed 事件
                // 重要：不依赖 ExecutionContext，直接使用 Debugger
                infoLogger(`[extract_code_bundle] 第 ${attempt + 1} 次尝试: 启用 Debugger 域，等待 ${waitMs}ms...`);
                const scripts = await client.enableDebuggerAndWaitScripts(waitMs);
                infoLogger(`[extract_code_bundle] 本次收集到 ${scripts.length} 个脚本`);
                // 合并脚本（去重）
                for (const script of scripts) {
                    if (!allScripts.find(s => s.scriptId === script.scriptId)) {
                        allScripts.push(script);
                    }
                }
                // 如果收集到足够多的脚本，停止重试
                if (allScripts.length >= 20) {
                    infoLogger(`[extract_code_bundle] 已收集到 ${allScripts.length} 个脚本，停止重试`);
                    break;
                }
            }
            infoLogger(`[extract_code_bundle] 总共收集到 ${allScripts.length} 个唯一脚本`);
            // 步骤 2: 逐个获取源码并按 URL 保存到文件系统
            const fileTree = {};
            let savedCount = 0;
            let totalBytes = 0;
            const scriptDetails = [];
            for (const script of allScripts) {
                try {
                    const source = await client.getScriptSource(script.scriptId);
                    if (!source || source.length === 0)
                        continue;
                    // 从 URL 构建文件路径
                    let relativePath = script.url;
                    if (!relativePath || relativePath === '' || relativePath.startsWith('eval:')) {
                        // 为没有 URL 的脚本生成路径
                        const hash = script.scriptId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
                        relativePath = `eval/script_${hash}.js`;
                    }
                    else {
                        // 移除协议前缀: https://usr/... -> usr/...
                        relativePath = relativePath.replace(/^https?:\/\//, '');
                        // 移除域名: servicewechat.com/... -> ...
                        relativePath = relativePath.replace(/^[^/]+\//, '');
                        // 清理路径
                        relativePath = relativePath.replace(/\?.*$/, ''); // 移除查询参数
                    }
                    // 确保路径有效
                    if (!relativePath.endsWith('.js')) {
                        relativePath += '.js';
                    }
                    // 构建完整保存路径
                    const fullPath = path.join(savePath, relativePath);
                    const dir = path.dirname(fullPath);
                    // 创建目录并保存文件
                    fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(fullPath, source, 'utf8');
                    savedCount++;
                    totalBytes += source.length;
                    // 构建文件树结构
                    const parts = relativePath.split('/');
                    let current = fileTree;
                    for (let i = 0; i < parts.length - 1; i++) {
                        if (!current[parts[i]])
                            current[parts[i]] = { _type: 'directory', _children: {} };
                        current = current[parts[i]]._children;
                    }
                    current[parts[parts.length - 1]] = {
                        _type: 'file',
                        _size: source.length,
                        _scriptId: script.scriptId,
                    };
                    scriptDetails.push({
                        scriptId: script.scriptId,
                        url: script.url,
                        filePath: relativePath,
                        sourceLength: source.length,
                    });
                }
                catch (e) {
                    errorLogger(`[extract_code_bundle] 处理脚本失败: ${script.scriptId}`, e);
                }
            }
            // 构建可读的文件树
            const formatTree = (tree, prefix = '') => {
                const lines = [];
                const entries = Object.entries(tree).filter(([k]) => !k.startsWith('_'));
                entries.sort((a, b) => {
                    const aIsDir = a[1]._type === 'directory';
                    const bIsDir = b[1]._type === 'directory';
                    if (aIsDir && !bIsDir)
                        return -1;
                    if (!aIsDir && bIsDir)
                        return 1;
                    return a[0].localeCompare(b[0]);
                });
                for (const [name, info] of entries) {
                    if (info._type === 'directory') {
                        lines.push(`${prefix}${name}/`);
                        lines.push(...formatTree(info._children, prefix + '  '));
                    }
                    else {
                        const sizeKB = (info._size / 1024).toFixed(1);
                        lines.push(`${prefix}${name} (${sizeKB}KB)`);
                    }
                }
                return lines;
            };
            const readableTree = formatTree(fileTree);
            infoLogger(`[extract_code_bundle] 完成: ${savedCount} 个文件, ${totalBytes} 字节`);
            return {
                status: 'extracted',
                save_path: savePath,
                summary: {
                    total_scripts: allScripts.length,
                    saved_files: savedCount,
                    total_bytes: totalBytes,
                    total_kb: (totalBytes / 1024).toFixed(1),
                },
                file_tree: readableTree,
                script_details: scriptDetails.slice(0, 50), // 返回前50个脚本详情
                message: `${savedCount} 个脚本已保存到 ${savePath}，共 ${(totalBytes / 1024).toFixed(1)}KB`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `提取失败: ${e.message}`,
            };
        }
    },
};
/**
 * Hook 小程序 API 工具
 */
export const hookMiniProgramApi = {
    name: 'hook_miniprogram_api',
    description: 'Hook 微信小程序的 API 调用，监控和修改 API 请求/响应',
    category: ToolCategory.DEBUGGER,
    schema: {
        api_name: z.string().describe('要 Hook 的 API 名称（如 wx.request, wx.login 等）'),
        action: z.enum(['log', 'modify', 'block']).describe('Hook 动作类型'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            const script = `
        (function() {
          const apiName = '${params.api_name}';
          const action = '${params.action}';

          // 查找 API 对象（在 AppService 中 wx 是全局对象）
          let apiObj = null;
          if (typeof wx !== 'undefined' && wx[apiName]) {
            apiObj = wx;
          } else if (typeof window !== 'undefined' && typeof window[apiName] !== 'undefined') {
            apiObj = window;
          }

          if (!apiObj) {
            return JSON.stringify({error: 'API not found: ' + apiName});
          }

          const original = apiObj[apiName];
          if (typeof original !== 'function') {
            return JSON.stringify({error: 'API is not a function: ' + apiName});
          }

          apiObj[apiName] = function(...args) {
            if (action === 'log') {
              console.log('[MCP Hook]', apiName, 'args:', JSON.stringify(args));
            } else if (action === 'block') {
              console.log('[MCP Hook]', apiName, 'BLOCKED');
              return;
            }
            return original.apply(this, args);
          };

          return JSON.stringify({status: 'hooked', api: apiName, action: action});
        })()
      `;
            // 路由到 AppService（逻辑层），wx 在那里定义
            const result = await client.evaluateScript(script, undefined, 'app');
            return {
                status: 'hooked',
                api_name: params.api_name,
                action: params.action,
                result: result?.result?.value ? JSON.parse(result.result.value) : null,
                message: `已 Hook ${params.api_name}，动作: ${params.action}`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `Hook 失败: ${e.message}`,
            };
        }
    },
};
/**
 * 列出所有执行上下文工具
 */
export const listContexts = {
    name: 'list_contexts',
    description: '列出微信小程序所有可用的 JavaScript 执行上下文（appContext=逻辑层, page-frame=渲染层等）',
    category: ToolCategory.MINIPROGRAM,
    schema: {},
    handler: async () => {
        const client = getCDPClient();
        try {
            await client.connect();
            const contexts = await client.getContexts();
            return {
                status: 'success',
                contexts: contexts,
                total: contexts.length,
                message: `找到 ${contexts.length} 个执行上下文`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `获取上下文失败: ${e.message}`,
            };
        }
    },
};
/**
 * 切换执行上下文工具
 */
export const switchContext = {
    name: 'switch_context',
    description: '切换到指定的执行上下文（如 "app"=逻辑层, "page-frame"=渲染层）',
    category: ToolCategory.MINIPROGRAM,
    schema: {
        context_name: z.string().describe('要切换到的上下文名称'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            const result = await client.setTargetContext(params.context_name);
            return {
                status: 'switched',
                result: result,
                message: `已切换到上下文: ${params.context_name}`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `切换失败: ${e.message}`,
            };
        }
    },
};
/**
 * 获取小程序存储数据工具
 */
export const getStorageData = {
    name: 'get_storage_data',
    description: '获取微信小程序的本地存储数据（wx.getStorageSync）',
    category: ToolCategory.MINIPROGRAM,
    schema: {
        key: z.string().optional().describe('存储的 key，为空则获取所有'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            let script;
            if (params.key) {
                script = `
          (function() {
            try {
              const value = wx.getStorageSync('${params.key}');
              return JSON.stringify({key: '${params.key}', value: value});
            } catch(e) {
              return JSON.stringify({error: e.message});
            }
          })()
        `;
            }
            else {
                script = `
          (function() {
            try {
              const info = wx.getStorageInfoSync();
              const data = {};
              info.keys.forEach(key => {
                try {
                  data[key] = wx.getStorageSync(key);
                } catch(e) {}
              });
              return JSON.stringify({keys: info.keys, data: data, currentSize: info.currentSize, limitSize: info.limitSize});
            } catch(e) {
              return JSON.stringify({error: e.message});
            }
          })()
        `;
            }
            const result = await client.evaluateScript(script, undefined, 'app');
            return {
                status: 'reading',
                key: params.key || 'all',
                data: result?.result?.value ? JSON.parse(result.result.value) : null,
                message: '存储数据读取完成',
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `读取失败: ${e.message}`,
            };
        }
    },
};
/**
 * 分析小程序加密参数工具
 */
export const analyzeEncryptionParams = {
    name: 'analyze_encryption_params',
    description: '分析微信小程序的加密参数、签名算法、反爬虫机制',
    category: ToolCategory.DEBUGGER,
    schema: {
        target_url: z.string().describe('目标请求 URL'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            const script = `
        (function() {
          const targetUrl = '${params.target_url}';
          const result = {
            target_url: targetUrl,
            anti_content: null,
            cookies: document.cookie,
            localStorage_keys: Object.keys(localStorage),
            analysis: {},
          };

          // 检查常见的加密参数
          if (typeof window.__next_data__ !== 'undefined') {
            result.analysis.next_data = 'found';
          }

          // 检查拼多多特有的变量
          if (typeof window.rawData !== 'undefined') {
            result.analysis.rawData = 'found';
          }
          if (typeof window.__INITIAL_STATE__ !== 'undefined') {
            result.analysis.initialState = 'found';
          }

          return JSON.stringify(result);
        })()
      `;
            // 路由到 AppService
            const result = await client.evaluateScript(script, undefined, 'app');
            return {
                status: 'analyzing',
                target_url: params.target_url,
                result: result?.result?.value ? JSON.parse(result.result.value) : null,
                message: '加密参数分析完成',
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `分析失败: ${e.message}`,
            };
        }
    },
};
/**
 * 获取脚本源代码工具
 * 优先使用本地缓存，不命中时通过 Debugger.getScriptSource 获取并缓存
 */
export const getScriptSource = {
    name: 'get_script_source',
    description: '获取指定脚本的完整源代码内容（支持 scriptId、URL、或从已保存的文件读取）。优先使用本地缓存',
    category: ToolCategory.SCRIPT,
    schema: {
        script_id: z.string().optional().describe('脚本 ID（从 list_scripts 获取）'),
        script_url: z.string().optional().describe('脚本 URL（直接指定脚本路径）'),
        file_path: z.string().optional().describe('已保存的文件路径（从 extract_code_bundle 保存的目录读取）'),
        start_line: z.number().optional().describe('起始行号（从 1 开始）'),
        end_line: z.number().optional().describe('结束行号'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            let scriptContent = '';
            let scriptInfo = {};
            // 优先从本地文件读取
            if (params.file_path) {
                const fs = await import('node:fs');
                if (fs.existsSync(params.file_path)) {
                    scriptContent = fs.readFileSync(params.file_path, 'utf8');
                    scriptInfo = { filePath: params.file_path, source: 'local_file' };
                }
                else {
                    return { status: 'error', message: `文件不存在: ${params.file_path}` };
                }
            }
            else if (params.script_id) {
                // 优先使用缓存
                const entry = await client.getSourceWithCache(params.script_id);
                if (entry) {
                    scriptContent = entry.source;
                    scriptInfo = {
                        scriptId: params.script_id,
                        url: entry.url,
                        source: 'cache',
                        isCompressed: entry.isCompressed,
                        sourceLength: entry.sourceLength,
                    };
                }
                else {
                    return { status: 'error', message: `无法获取脚本 ${params.script_id} 的源码` };
                }
            }
            else if (params.script_url) {
                // 通过 URL 获取：先在已解析的脚本中查找
                const scripts = client.getParsedScripts();
                const url = params.script_url;
                const matched = scripts.find(s => s.url === url || s.url.includes(url));
                if (matched) {
                    const entry = await client.getSourceWithCache(matched.scriptId);
                    if (entry) {
                        scriptContent = entry.source;
                        scriptInfo = {
                            scriptId: matched.scriptId,
                            url: matched.url,
                            source: 'cache',
                            isCompressed: entry.isCompressed,
                            sourceLength: entry.sourceLength,
                        };
                    }
                    else {
                        return { status: 'error', message: `无法获取脚本 ${matched.scriptId} 的源码` };
                    }
                }
                else {
                    return { status: 'error', message: `未找到脚本: ${params.script_url}` };
                }
            }
            else {
                return { status: 'error', message: '请提供 script_id、script_url 或 file_path 参数' };
            }
            // 处理行号范围（使用 getSourceRange 对压缩 JS 更友好）
            if (params.start_line || params.end_line) {
                if (scriptInfo.scriptId) {
                    const range = client.getSourceRange(scriptInfo.scriptId, (params.start_line || 1) - 1, (params.end_line || scriptContent.split('\n').length) - 1);
                    if (range) {
                        scriptContent = range.lines.map(l => l.content).join('\n');
                    }
                }
                else {
                    const lines = scriptContent.split('\n');
                    const start = (params.start_line || 1) - 1;
                    const end = params.end_line || lines.length;
                    scriptContent = lines.slice(start, end).join('\n');
                }
            }
            return {
                status: 'success',
                content: scriptContent,
                info: scriptInfo,
                line_count: scriptContent.split('\n').length,
                size_bytes: scriptContent.length,
                message: `脚本源代码获取完成 (${scriptInfo.source})`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `获取失败: ${e.message}`,
            };
        }
    },
};
/**
 * 提取当前页面业务逻辑工具
 * 从当前显示的页面中提取所有业务逻辑代码（Page/Component 定义）
 */
export const extractPageBusinessLogic = {
    name: 'extract_page_business_logic',
    description: '提取当前显示页面的业务逻辑代码（Page/Component 定义、生命周期方法、事件处理函数等）。支持保存到文件',
    category: ToolCategory.MINIPROGRAM,
    schema: {
        save_path: z.string().optional().describe('保存路径（默认 ./miniprogram_scripts/business_logic）'),
        include_data: z.boolean().optional().describe('是否包含页面数据（默认 true）'),
        include_methods: z.boolean().optional().describe('是否包含方法源码（默认 true）'),
        include_components: z.boolean().optional().describe('是否包含子组件信息（默认 true）'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            const savePath = params.save_path || './miniprogram_scripts/business_logic';
            const includeData = params.include_data !== false;
            const includeMethods = params.include_methods !== false;
            const includeComponents = params.include_components !== false;
            // 脚本：提取当前页面的所有业务逻辑
            const script = `
        (() => {
          const result = {
            timestamp: new Date().toISOString(),
            pages: [],
            globalInfo: {}
          };

          // 获取所有 frames
          for (let frameIndex = 0; frameIndex < window.frames.length; frameIndex++) {
            try {
              const frame = window.frames[frameIndex];
              
              // 检查是否有 getCurrentPages
              if (typeof frame.getCurrentPages !== 'function') continue;

              const pages = frame.getCurrentPages();
              if (!pages || pages.length === 0) continue;

              for (const page of pages) {
                const pageData = {
                  frameIndex,
                  route: page.route,
                  pageId: page.getPageId?.() || 'unknown',
                  options: page.options || {},
                  data: ${includeData ? 'page.data' : 'null'},
                  methods: {},
                  lifeTimes: {},
                  protoMethods: {},
                  components: []
                };

                // 提取实例方法
                ${includeMethods ? `
                const instanceMethods = Object.getOwnPropertyNames(page).filter(k => {
                  try {
                    return typeof page[k] === 'function' && k !== 'constructor';
                  } catch (e) {
                    return false;
                  }
                });

                for (const name of instanceMethods) {
                  try {
                    const method = page[name];
                    if (method) {
                      const source = method.toString();
                      // 过滤掉包装函数，只保留有实际内容的
                      if (source.length > 50 && !source.includes('[native code]')) {
                        pageData.methods[name] = {
                          length: source.length,
                          source: source
                        };
                      }
                    }
                  } catch (e) {}
                }
                ` : ''}

                // 提取原型方法（生命周期和业务方法）
                ${includeMethods ? `
                try {
                  const proto = Object.getPrototypeOf(page);
                  const protoKeys = Object.getOwnPropertyNames(proto).filter(k => {
                    try {
                      return typeof proto[k] === 'function' && k !== 'constructor';
                    } catch (e) {
                      return false;
                    }
                  });

                  for (const key of protoKeys) {
                    try {
                      const method = proto[key];
                      if (method) {
                        const source = method.toString();
                        // 分类：生命周期方法 vs 业务方法
                        const lifeTimes = ['onLoad', 'onShow', 'onReady', 'onHide', 'onUnload', 'onPageScroll', 'onReachBottom', 'onShareAppMessage', 'onTabItemTap', 'onResize', 'onRouteDone'];
                        
                        if (lifeTimes.includes(key)) {
                          pageData.lifeTimes[key] = {
                            length: source.length,
                            source: source
                          };
                        } else if (source.length > 30 && !source.includes('[native code]')) {
                          pageData.protoMethods[key] = {
                            length: source.length,
                            source: source
                          };
                        }
                      }
                    } catch (e) {}
                  }
                } catch (e) {}
                ` : ''}

                // 提取子组件信息
                ${includeComponents ? `
                try {
                  // 尝试获取页面中的组件实例
                  const componentNames = Object.getOwnPropertyNames(page).filter(k => {
                    try {
                      const val = page[k];
                      return val && typeof val === 'object' && typeof val.selectComponent === 'function';
                    } catch (e) {
                      return false;
                    }
                  });

                  for (const name of componentNames.slice(0, 10)) {
                    try {
                      const component = page[name];
                      if (component && component.route) {
                        pageData.components.push({
                          name: name,
                          route: component.route,
                          data: Object.keys(component.data || {}).slice(0, 20)
                        });
                      }
                    } catch (e) {}
                  }
                } catch (e) {}
                ` : ''}

                result.pages.push(pageData);
              }

              // 获取全局信息
              if (frameIndex === 1) {
                // 服务层 frame
                try {
                  const app = frame.getApp ? frame.getApp() : null;
                  if (app) {
                    result.globalInfo.app = {
                      type: typeof app,
                      keys: Object.keys(app),
                      methods: Object.getOwnPropertyNames(Object.getPrototypeOf(app)).filter(k => typeof app[k] === 'function')
                    };
                  }
                } catch (e) {}

                // 获取模块系统信息
                try {
                  const defineStr = frame.define?.toString() || '';
                  result.globalInfo.moduleSystem = {
                    hasDefine: typeof frame.define === 'function',
                    hasRequire: typeof frame.require === 'function',
                    defineLength: defineStr.length
                  };
                } catch (e) {}

                // 获取 __wxAppCode__ 信息
                try {
                  const wxAppCode = frame.__wxAppCode__ || {};
                  const keys = Object.keys(wxAppCode);
                  result.globalInfo.wxAppCode = {
                    totalModules: keys.length,
                    jsonFiles: keys.filter(k => k.endsWith('.json')).length,
                    wxmlFiles: keys.filter(k => k.endsWith('.wxml')).length,
                    jsFiles: keys.filter(k => k.endsWith('.js')).length,
                    sampleKeys: keys.slice(0, 20)
                  };
                } catch (e) {}
              }

            } catch (e) {
              // 跳过无法访问的 frame
            }
          }

          return JSON.stringify(result);
        })()
      `;
            const result = await client.evaluateScript(script);
            const parsed = result?.result?.value ? JSON.parse(result.result.value) : null;
            if (!parsed) {
                return {
                    status: 'error',
                    message: '无法解析页面数据',
                };
            }
            // 保存到文件
            const fs = await import('node:fs');
            const pathModule = await import('node:path');
            // 创建保存目录
            if (!fs.existsSync(savePath)) {
                fs.mkdirSync(savePath, { recursive: true });
            }
            // 保存主文件
            const mainFilePath = pathModule.join(savePath, 'page_business_logic.json');
            fs.writeFileSync(mainFilePath, JSON.stringify(parsed, null, 2), 'utf8');
            // 保存每个页面的方法为单独的 JS 文件
            const savedFiles = [mainFilePath];
            for (const page of parsed.pages) {
                const pageName = page.route.replace(/\//g, '_');
                const pageDir = pathModule.join(savePath, pageName);
                if (!fs.existsSync(pageDir)) {
                    fs.mkdirSync(pageDir, { recursive: true });
                }
                // 保存页面配置
                const configPath = pathModule.join(pageDir, 'config.json');
                fs.writeFileSync(configPath, JSON.stringify({
                    route: page.route,
                    pageId: page.pageId,
                    options: page.options,
                    components: page.components
                }, null, 2), 'utf8');
                savedFiles.push(configPath);
                // 保存页面数据
                if (page.data) {
                    const dataPath = pathModule.join(pageDir, 'data.json');
                    fs.writeFileSync(dataPath, JSON.stringify(page.data, null, 2), 'utf8');
                    savedFiles.push(dataPath);
                }
                // 保存生命周期方法
                if (Object.keys(page.lifeTimes).length > 0) {
                    const lifeTimesPath = pathModule.join(pageDir, 'lifetimes.js');
                    let lifeTimesContent = '// 页面生命周期方法\n\n';
                    for (const [name, info] of Object.entries(page.lifeTimes)) {
                        lifeTimesContent += `// ${name}\n`;
                        lifeTimesContent += `${info.source}\n\n`;
                    }
                    fs.writeFileSync(lifeTimesPath, lifeTimesContent, 'utf8');
                    savedFiles.push(lifeTimesPath);
                }
                // 保存业务方法
                const allMethods = { ...page.methods, ...page.protoMethods };
                if (Object.keys(allMethods).length > 0) {
                    const methodsPath = pathModule.join(pageDir, 'methods.js');
                    let methodsContent = '// 页面业务方法\n\n';
                    for (const [name, info] of Object.entries(allMethods)) {
                        methodsContent += `// ${name}\n`;
                        methodsContent += `${info.source}\n\n`;
                    }
                    fs.writeFileSync(methodsPath, methodsContent, 'utf8');
                    savedFiles.push(methodsPath);
                }
            }
            // 保存全局信息
            if (parsed.globalInfo) {
                const globalPath = pathModule.join(savePath, 'global_info.json');
                fs.writeFileSync(globalPath, JSON.stringify(parsed.globalInfo, null, 2), 'utf8');
                savedFiles.push(globalPath);
            }
            // 生成摘要
            const summary = {
                timestamp: parsed.timestamp,
                pagesExtracted: parsed.pages.length,
                totalPages: parsed.pages.reduce((sum, p) => sum + Object.keys(p.methods).length + Object.keys(p.protoMethods).length + Object.keys(p.lifeTimes).length, 0),
                savedFiles: savedFiles.length,
                files: savedFiles
            };
            return {
                status: 'success',
                summary,
                message: `成功提取 ${parsed.pages.length} 个页面的业务逻辑`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `提取失败: ${e.message}`,
            };
        }
    },
};
/**
 * 搜索并自动下断点工具
 * 搜索 AppService 脚本中的网络请求函数（t.request/Ka/wx.request 等），自动在匹配位置设置断点
 */
export const searchAndAutoBreak = {
    name: 'search_and_auto_break',
    description: '搜索 AppService 脚本中的网络请求函数（t.request/Ka/wx.request 等），自动在匹配位置用 scriptId 直接下断点',
    category: ToolCategory.DEBUGGER,
    schema: {
        patterns: z.array(z.string()).optional().describe('搜索模式列表（默认: ["t.request", "wx.request", "Ka.request", "request({", "request("]）'),
        url_filter: z.string().optional().describe('URL 过滤条件，限定在特定脚本中搜索'),
        auto_break: z.boolean().optional().describe('是否自动在第一个匹配处设置断点（默认 true）'),
        max_breakpoints: z.number().optional().describe('最多设置的断点数量（默认 5）'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            // 重要：不依赖 ExecutionContext
            // 直接启用 Debugger（如果尚未启用），不调用 ensureAppServiceContext()
            if (!client.isAppServiceDebuggerEnabled()) {
                await client.enableAppServiceDebugger();
            }
            // 等待脚本收集
            await new Promise(r => setTimeout(r, 2000));
            const patterns = params.patterns || [
                't.request',
                'wx.request',
                'Ka.request',
                'request({',
                'request(',
                '__wxRequest',
                'networkRequest',
            ];
            const autoBreak = params.auto_break !== false;
            const maxBps = params.max_breakpoints || 5;
            // 搜索所有匹配
            const allMatches = [];
            for (const pattern of patterns) {
                const matches = await client.searchInAllScripts(pattern);
                for (const match of matches) {
                    // URL 过滤
                    if (params.url_filter) {
                        if (!match.url.toLowerCase().includes(params.url_filter.toLowerCase())) {
                            continue;
                        }
                    }
                    // 去重（同一位置不重复）
                    const key = `${match.scriptId}:${match.lineNumber}:${match.columnNumber || 0}`;
                    if (!allMatches.find(m => `${m.scriptId}:${m.lineNumber}:${m.columnNumber || 0}` === key)) {
                        allMatches.push({ ...match, pattern });
                    }
                }
            }
            // 按脚本 URL 分组统计
            const groupedByScript = {};
            for (const match of allMatches) {
                const key = match.url || match.scriptId;
                groupedByScript[key] = (groupedByScript[key] || 0) + 1;
            }
            // 自动设置断点
            const breakpoints = [];
            if (autoBreak && allMatches.length > 0) {
                // 优先选择包含 appservice/app.js 的脚本
                const sortedMatches = allMatches.sort((a, b) => {
                    const aIsApp = a.url.includes('appservice') || a.url.includes('app.js') ? 1 : 0;
                    const bIsApp = b.url.includes('appservice') || b.url.includes('app.js') ? 1 : 0;
                    return bIsApp - aIsApp;
                });
                for (const match of sortedMatches.slice(0, maxBps)) {
                    try {
                        // 获取脚本源码确定精确列
                        const source = await client.getScriptSource(match.scriptId);
                        let columnNumber = match.columnNumber || 0;
                        if (source) {
                            const lines = source.split('\n');
                            if (match.lineNumber < lines.length) {
                                const lineContent = lines[match.lineNumber];
                                const colPos = lineContent.indexOf(match.pattern);
                                if (colPos >= 0) {
                                    columnNumber = colPos;
                                }
                            }
                        }
                        // 使用 setBreakpointOnAppService（现在不依赖 ExecutionContext）
                        const bpInfo = await client.setBreakpointOnAppService(match.scriptId, match.lineNumber, columnNumber);
                        breakpoints.push({
                            breakpoint_id: bpInfo.breakpointId,
                            pattern: match.pattern,
                            script_id: match.scriptId,
                            url: match.url,
                            line: match.lineNumber + 1,
                        });
                    }
                    catch (bpError) {
                        infoLogger(`[search_and_auto_break] 设置断点失败: ${bpError}`);
                    }
                }
            }
            return {
                status: 'searched',
                patterns,
                total_matches: allMatches.length,
                matches_by_script: groupedByScript,
                breakpoints_set: breakpoints.length,
                breakpoints,
                all_matches: allMatches.slice(0, 50).map(m => ({
                    pattern: m.pattern,
                    script_id: m.scriptId,
                    url: m.url,
                    line: m.lineNumber + 1,
                    context: m.lineContent.trim(),
                })),
                message: `搜索完成: ${allMatches.length} 个匹配，已设置 ${breakpoints.length} 个断点`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `搜索并自动断点失败: ${e.message}`,
            };
        }
    },
};
/**
 * AppService 网络请求捕获工具
 * 通过 AppService Network 域捕获逻辑层网络请求
 * 也可注入 Hook 捕获 wx.request 调用
 */
export const captureAppServiceNetwork = {
    name: 'capture_appservice_network',
    description: '捕获 AppService 逻辑层的网络请求（wx.request/wx.downloadFile/wx.uploadFile），支持 URL 过滤和请求体捕获',
    category: ToolCategory.NETWORK,
    schema: {
        url_filter: z.string().optional().describe('URL 过滤关键词'),
        capture_body: z.boolean().optional().describe('是否捕获请求/响应体（默认 false）'),
        duration_ms: z.number().optional().describe('捕获持续时间（毫秒，默认 10000）'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            // 确保 AppService Network 域已启用
            await client.ensureAppServiceContext();
            try {
                await client.enableAppServiceNetwork();
            }
            catch {
                // 回退到普通 Network
                await client.enableNetwork();
            }
            // 注入 AppService 网络请求捕获 Hook
            const captureScript = `
        (function() {
          if (window.__mcp_appservice_network_capture__) return 'already_capturing';
          window.__mcp_appservice_network_capture__ = true;
          window.__mcp_appservice_requests__ = [];
          
          const urlFilter = ${JSON.stringify(params.url_filter || '')};
          
          // Hook wx.request
          if (typeof wx !== 'undefined' && typeof wx.request === 'function') {
            const origRequest = wx.request;
            wx.request = function(options) {
              const url = (options && options.url) || '';
              if (!urlFilter || url.includes(urlFilter)) {
                const entry = {
                  type: 'request',
                  url: url,
                  method: (options && options.method) || 'GET',
                  header: options && options.header,
                  data: options && options.data,
                  time: Date.now(),
                  requestId: 'wx_req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                };
                window.__mcp_appservice_requests__.push(entry);
                console.log('[MCP Network] wx.request:', url);
                
                // 如果有 success 回调，包装它以捕获响应
                if (options && typeof options.success === 'function') {
                  const origSuccess = options.success;
                  options.success = function(res) {
                    entry.status = res.statusCode;
                    entry.responseData = res.data;
                    entry.responseHeader = res.header;
                    return origSuccess.apply(this, arguments);
                  };
                }
                if (options && typeof options.fail === 'function') {
                  const origFail = options.fail;
                  options.fail = function(err) {
                    entry.error = err.errMsg || String(err);
                    return origFail.apply(this, arguments);
                  };
                }
              }
              return origRequest.apply(this, arguments);
            };
          }
          
          // Hook wx.downloadFile
          if (typeof wx !== 'undefined' && typeof wx.downloadFile === 'function') {
            const origDownload = wx.downloadFile;
            wx.downloadFile = function(options) {
              const url = (options && options.url) || '';
              if (!urlFilter || url.includes(urlFilter)) {
                window.__mcp_appservice_requests__.push({
                  type: 'download',
                  url: url,
                  method: 'DOWNLOAD',
                  time: Date.now(),
                });
                console.log('[MCP Network] wx.downloadFile:', url);
              }
              return origDownload.apply(this, arguments);
            };
          }
          
          // Hook wx.uploadFile
          if (typeof wx !== 'undefined' && typeof wx.uploadFile === 'function') {
            const origUpload = wx.uploadFile;
            wx.uploadFile = function(options) {
              const url = (options && options.url) || '';
              if (!urlFilter || url.includes(urlFilter)) {
                window.__mcp_appservice_requests__.push({
                  type: 'upload',
                  url: url,
                  method: 'UPLOAD',
                  filePath: options && options.filePath,
                  time: Date.now(),
                });
                console.log('[MCP Network] wx.uploadFile:', url);
              }
              return origUpload.apply(this, arguments);
            };
          }
          
          return 'capture_installed';
        })()
      `;
            await client.evaluateScript(captureScript, undefined, 'app');
            // 等待一段时间捕获请求
            const duration = params.duration_ms || 10000;
            await new Promise(r => setTimeout(r, Math.min(duration, 5000)));
            // 获取已捕获的请求
            const getRequestsScript = `
        JSON.stringify(window.__mcp_appservice_requests__ || [])
      `;
            const result = await client.evaluateScript(getRequestsScript, undefined, 'app');
            const requests = result?.result?.value ? JSON.parse(result.result.value) : [];
            // 同时获取 Network 域捕获的请求
            const networkRequests = client.getNetworkRequestsFiltered({
                urlFilter: params.url_filter,
            });
            return {
                status: 'capturing',
                url_filter: params.url_filter || '*',
                hook_requests: requests,
                cdp_network_requests: networkRequests.requests.map(r => ({
                    reqid: r.requestId,
                    method: r.method,
                    url: r.url,
                    status: r.status,
                    timestamp: r.timestamp,
                })),
                total_hook: requests.length,
                total_cdp: networkRequests.total,
                message: `AppService 网络请求捕获中。Hook 捕获 ${requests.length} 个，CDP 捕获 ${networkRequests.total} 个。使用 duration_ms 参数延长捕获时间`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `捕获 AppService 网络请求失败: ${e.message}`,
            };
        }
    },
};
/** 所有微信小程序工具 */
export const wechatTools = [
    connectCdp,
    disconnectCdp,
    getMiniProgramStatus,
    listContexts,
    switchContext,
    interceptNetworkRequests,
    extractCodeBundle,
    getScriptSource,
    hookMiniProgramApi,
    getStorageData,
    analyzeEncryptionParams,
    extractPageBusinessLogic,
    searchAndAutoBreak,
    captureAppServiceNetwork,
];
//# sourceMappingURL=wechat-miniprogram.js.map