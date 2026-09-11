/**
 * CDP 客户端模块
 * 通过 WebSocket 连接到 CDP 代理服务器，发送 CDP 调试命令
 *
 * 支持两种连接模式：
 * 1. 代理模式：通过 WMPFDebugger 代理连接微信小程序
 * 2. 直连模式：直接连接到 Chrome/Chromium 的 CDP 端口（通用 JS 逆向）
 */
import WebSocket from 'ws';
import { infoLogger, errorLogger, debugLogger } from './logger.js';
/** CDP 客户端类 */
export class CDPClient {
    ws = null;
    requestId = 0;
    pendingRequests = new Map();
    eventListeners = new Map();
    connected = false;
    cdpPort;
    debugPort;
    debugMain;
    connectionMode = 'proxy';
    parsedScripts = new Map();
    // 调试状态管理
    pausedState = { isPaused: false, callFrames: [] };
    breakpoints = new Map();
    debuggerEnabled = false;
    // 网络请求管理
    networkRequests = new Map();
    networkRequestId = 0;
    networkEnabled = false;
    // XHR 断点管理
    xhrBreakpoints = new Set();
    // 控制台消息管理
    consoleMessages = [];
    consoleEnabled = false;
    // 心跳检测管理
    heartbeatTimer = null;
    lastMessageTime = 0;
    heartbeatInterval = 30000; // 30秒心跳间隔
    heartbeatTimeout = 10000; // 10秒心跳超时
    // AppService Target 管理（微信小程序特有）
    appServiceTarget = null;
    appServiceDebuggerEnabled = false;
    // 源码缓存（Script Registry 核心）
    sourceCache = new Map();
    // 直连模式的 WebSocket URL
    directWsUrl;
    constructor(cdpPort = 62000, debugPort = 9421, debugMain = false) {
        this.cdpPort = cdpPort;
        this.debugPort = debugPort;
        this.debugMain = debugMain;
    }
    /**
     * 连接到 CDP 目标
     * 支持两种模式：
     * - proxy 模式：通过 WMPFDebugger 代理连接微信小程序（默认）
     * - direct 模式：直接连接到 Chrome/Chromium 的 CDP WebSocket 端口
     * @param maxRetries 最大重试次数，默认 3
     * @param retryDelay 重试延迟（毫秒），默认 1000
     */
    async connect(maxRetries = 3, retryDelay = 1000) {
        if (this.connected && this.ws) {
            return;
        }
        // 如果是直连模式，跳过代理服务器启动
        if (this.connectionMode === 'direct' && this.directWsUrl) {
            infoLogger(`[CDP客户端] 直连模式: ${this.directWsUrl}`);
        }
        else {
            // 懒加载：首次连接时启动代理服务器
            try {
                const { ensureServersStarted } = await import('./cdp-proxy.js');
                ensureServersStarted(this.debugPort, this.cdpPort, this.debugMain);
            }
            catch (e) {
                debugLogger('[CDP客户端] 无法启动代理服务器（可能不是微信小程序环境）:', e);
            }
        }
        let lastError = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    infoLogger(`[CDP客户端] 重试连接 (${attempt}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
                await this.connectOnce();
                return; // 连接成功，直接返回
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                errorLogger(`[CDP客户端] 连接失败 (尝试 ${attempt + 1}/${maxRetries + 1}):`, lastError.message);
                // 如果是最后一次尝试，抛出错误
                if (attempt === maxRetries) {
                    throw lastError;
                }
            }
        }
    }
    /**
     * 直连到 Chrome DevTools WebSocket
     * 用于通用 JS 逆向场景（非微信小程序）
     * @param wsUrl WebSocket URL，如 ws://127.0.0.1:9222/devtools/page/xxx
     */
    async connectDirect(wsUrl) {
        this.connectionMode = 'direct';
        this.directWsUrl = wsUrl;
        await this.connect();
    }
    /**
     * 连接到 Chrome DevTools HTTP 端点并自动选择页面
     * @param host Chrome DevTools 主机（默认 127.0.0.1）
     * @param port Chrome DevTools 端口（默认 9222）
     */
    async connectToDevTools(host = '127.0.0.1', port = 9222) {
        const http = await import('node:http');
        return new Promise((resolve, reject) => {
            http.get(`http://${host}:${port}/json/list`, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', async () => {
                    try {
                        const targets = JSON.parse(data);
                        // 选择第一个 page 类型的 target
                        const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
                        if (!pageTarget?.webSocketDebuggerUrl) {
                            reject(new Error('未找到可用的调试目标'));
                            return;
                        }
                        infoLogger(`[CDP客户端] 发现调试目标: ${pageTarget.title} (${pageTarget.url})`);
                        await this.connectDirect(pageTarget.webSocketDebuggerUrl);
                        resolve();
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            }).on('error', reject);
        });
    }
    /**
     * 单次连接尝试（内部方法）
     */
    connectOnce() {
        return new Promise((resolve, reject) => {
            // 确定 WebSocket URL
            const wsUrl = this.connectionMode === 'direct' && this.directWsUrl
                ? this.directWsUrl
                : `ws://127.0.0.1:${this.cdpPort}`;
            infoLogger(`[CDP客户端] 连接到 ${wsUrl}`);
            // 清理之前的连接
            if (this.ws) {
                this.ws.removeAllListeners();
                this.ws.close();
                this.ws = null;
            }
            this.ws = new WebSocket(wsUrl);
            this.ws.on('open', () => {
                this.connected = true;
                this.lastMessageTime = Date.now();
                infoLogger('[CDP客户端] 已连接到 CDP 代理服务器');
                // 启动心跳检测
                this.startHeartbeat();
                // 注册小程序断开连接事件
                this.onEvent('MCP.miniprogramDisconnected', () => {
                    infoLogger('[CDP客户端] 小程序已断开，清空已收集脚本状态');
                    this.parsedScripts.clear();
                    this.pausedState = { isPaused: false, callFrames: [] };
                    this.breakpoints.clear();
                    this.debuggerEnabled = false;
                });
                // 监听 Debugger.paused 事件
                this.onEvent('Debugger.paused', (params) => {
                    infoLogger('[CDP客户端] 执行已暂停:', params.reason);
                    this.pausedState = {
                        isPaused: true,
                        reason: params.reason,
                        callFrames: params.callFrames || [],
                        data: params.data,
                        hitBreakpoints: params.hitBreakpoints,
                    };
                });
                // 监听 Debugger.resumed 事件
                this.onEvent('Debugger.resumed', () => {
                    infoLogger('[CDP客户端] 执行已恢复');
                    this.pausedState = { isPaused: false, callFrames: [] };
                });
                // 监听 Network.requestWillBeSent 事件
                this.onEvent('Network.requestWillBeSent', (params) => {
                    const request = {
                        id: params.requestId,
                        requestId: ++this.networkRequestId,
                        url: params.request.url,
                        method: params.request.method,
                        headers: params.request.headers || {},
                        timestamp: params.timestamp,
                    };
                    this.networkRequests.set(params.requestId, request);
                    debugLogger(`[CDP客户端] 网络请求: ${params.request.method} ${params.request.url}`);
                });
                // 监听 Network.responseReceived 事件
                this.onEvent('Network.responseReceived', (params) => {
                    const request = this.networkRequests.get(params.requestId);
                    if (request) {
                        request.status = params.response.status;
                        request.responseHeaders = params.response.headers || {};
                    }
                });
                // 监听 Network.loadingFinished 事件
                this.onEvent('Network.loadingFinished', (params) => {
                    debugLogger(`[CDP客户端] 网络请求完成: ${params.requestId}`);
                });
                // 监听 Runtime.consoleAPICalled 事件
                this.onEvent('Runtime.consoleAPICalled', (params) => {
                    const message = {
                        id: this.consoleMessages.length + 1,
                        type: params.type,
                        text: params.args?.map((a) => a.value || a.description || '').join(' ') || '',
                        timestamp: params.timestamp,
                        url: params.stackTrace?.callFrames?.[0]?.url,
                        lineNumber: params.stackTrace?.callFrames?.[0]?.lineNumber,
                        columnNumber: params.stackTrace?.callFrames?.[0]?.columnNumber,
                    };
                    this.consoleMessages.push(message);
                    debugLogger(`[CDP客户端] 控制台消息 [${params.type}]: ${message.text}`);
                });
                resolve();
            });
            this.ws.on('message', (data) => {
                this.lastMessageTime = Date.now();
                try {
                    const message = JSON.parse(data.toString());
                    // 处理 CDP 事件（没有 id 字段的是事件通知）
                    if (!message.id && message.method) {
                        const event = message;
                        debugLogger('[CDP客户端] 收到事件:', event.method);
                        // 收集 Debugger.scriptParsed 事件中的脚本
                        if (event.method === 'Debugger.scriptParsed' && event.params) {
                            const script = event.params;
                            this.parsedScripts.set(script.scriptId, script);
                            debugLogger(`[CDP客户端] 脚本已解析: ${script.scriptId} - ${script.url}`);
                        }
                        // 触发事件监听器
                        const listeners = this.eventListeners.get(event.method);
                        if (listeners) {
                            listeners.forEach((listener) => listener(event.params));
                        }
                        return;
                    }
                    // 处理 CDP 命令响应（有 id 字段）
                    const response = message;
                    const pending = this.pendingRequests.get(response.id);
                    if (pending) {
                        this.pendingRequests.delete(response.id);
                        if (response.error) {
                            pending.reject(new Error(`CDP 错误: ${response.error.message}`));
                        }
                        else {
                            pending.resolve(response.result);
                        }
                    }
                }
                catch (e) {
                    errorLogger('[CDP客户端] 解析响应失败:', e);
                }
            });
            this.ws.on('error', (err) => {
                errorLogger('[CDP客户端] WebSocket 错误:', err);
                this.connected = false;
                this.stopHeartbeat();
                reject(err);
            });
            this.ws.on('close', () => {
                infoLogger('[CDP客户端] WebSocket 连接已关闭');
                this.connected = false;
                this.ws = null;
                this.stopHeartbeat();
            });
            // 连接超时（增加到10秒）
            setTimeout(() => {
                if (!this.connected) {
                    reject(new Error('CDP 连接超时'));
                }
            }, 10000);
        });
    }
    /**
     * 发送 CDP 命令
     */
    async sendCommand(method, params = {}) {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        const id = ++this.requestId;
        const command = { id, method, params };
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            this.ws.send(JSON.stringify(command), (err) => {
                if (err) {
                    this.pendingRequests.delete(id);
                    reject(err);
                }
            });
            // 命令超时
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`CDP 命令超时: ${method}`));
                }
            }, 30000);
        });
    }
    /**
     * 在小程序环境中执行 JavaScript 代码
     * 不再自动回退到 AppService ExecutionContext
     * @param contextName 可选的上下文名称（如 'app'），优先于 contextId
     *
     * 重要原则：
     * - ExecutionContext 仅作为 Runtime.evaluate 的可选能力
     * - 不作为整个 JS 调试系统的前置条件
     * - 如果没有可用的 executionContextId，明确返回错误信息，
     *   但不阻塞 Debugger/source/breakpoint 功能
     */
    async evaluateScript(expression, contextId, contextName) {
        const params = {
            expression,
            returnByValue: true,
            awaitPromise: true,
        };
        // 如果指定了上下文名称，查找对应的 contextId
        if (contextName) {
            const contexts = await this.getContexts(false);
            const ctx = contexts.find(c => c.name === contextName || c.name.includes(contextName));
            if (ctx) {
                params.contextId = parseInt(ctx.id, 10);
                debugLogger(`[CDP客户端] evaluateScript 路由到上下文: ${ctx.name} (id=${ctx.id})`);
            }
            else {
                // 未找到指定上下文，返回明确错误（不阻塞调试流程）
                return {
                    result: {
                        type: 'string',
                        value: `[Runtime.evaluate 不可用] 未找到上下文 "${contextName}"。但 Debugger/source/breakpoint 功能仍然可用。请使用 Debugger.setBreakpoint + evaluateOnCallFrame 进行调试。`,
                        description: 'ExecutionContext not found',
                    },
                };
            }
        }
        else if (contextId !== undefined) {
            params.contextId = contextId;
        }
        // 注意：不再自动回退到 AppService ExecutionContext
        // 如果没有指定 contextId，Runtime.evaluate 将使用默认上下文
        return this.sendCommand('Runtime.evaluate', params);
    }
    /**
     * 获取所有执行上下文
     */
    async getExecutionContexts() {
        const result = await this.sendCommand('Runtime.enable');
        // 获取已有的执行上下文
        const contextsResult = await this.sendCommand('Runtime.evaluate', {
            expression: 'typeof window !== "undefined" ? "has_window" : "no_window"',
            returnByValue: true,
        });
        return [];
    }
    /**
     * 启用 Runtime 域
     */
    async enableRuntime() {
        await this.sendCommand('Runtime.enable');
    }
    /**
     * 注册 CDP 事件监听器
     */
    onEvent(eventMethod, listener) {
        if (!this.eventListeners.has(eventMethod)) {
            this.eventListeners.set(eventMethod, []);
        }
        this.eventListeners.get(eventMethod).push(listener);
    }
    /**
     * 移除 CDP 事件监听器
     */
    offEvent(eventMethod, listener) {
        const listeners = this.eventListeners.get(eventMethod);
        if (listeners) {
            const idx = listeners.indexOf(listener);
            if (idx !== -1)
                listeners.splice(idx, 1);
        }
    }
    /**
     * 获取已收集的解析脚本列表
     */
    getParsedScripts() {
        return Array.from(this.parsedScripts.values());
    }
    /**
     * 清空已收集的脚本
     */
    clearParsedScripts() {
        this.parsedScripts.clear();
    }
    /**
     * 启用 Debugger 域并等待脚本解析完成
     * @param waitMs 等待脚本解析的时间（毫秒），默认 3000
     * @param reset 是否重置已收集的脚本（默认 false，保持累积）
     */
    async enableDebuggerAndWaitScripts(waitMs = 3000, reset = false) {
        if (reset) {
            this.parsedScripts.clear();
        }
        // 启用 Debugger 域（幂等操作）
        await this.sendCommand('Debugger.enable');
        infoLogger('[CDP客户端] Debugger 域已启用，等待脚本解析...');
        // 设置脚本解析事件监听器
        const scriptParsedHandler = (params) => {
            // 使用复合键去重（上下文+scriptId）
            const key = `${params.__jscontext ?? ''}|${params.scriptId}`;
            this.parsedScripts.set(key, params);
            debugLogger(`[CDP客户端] 脚本已解析: ${params.scriptId} - ${params.url || '(no url)'} (${params.__jscontext || 'host默认'})`);
        };
        this.onEvent('Debugger.scriptParsed', scriptParsedHandler);
        // 等待一段时间让小程序引擎上报所有脚本
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        // 移除事件监听器
        this.offEvent('Debugger.scriptParsed', scriptParsedHandler);
        const scripts = this.getParsedScripts();
        infoLogger(`[CDP客户端] 当前累计收集 ${scripts.length} 个脚本`);
        return scripts;
    }
    /**
     * 获取所有脚本（旧方法，保留兼容）
     */
    async getScripts() {
        const scripts = await this.enableDebuggerAndWaitScripts();
        return scripts;
    }
    /**
     * 获取脚本源代码
     * @param scriptId 脚本 ID
     * @param jscontextId 可选的上下文 ID，用于路由到特定上下文
     */
    async getScriptSource(scriptId, jscontextId) {
        try {
            infoLogger(`[CDP客户端] 获取脚本源代码: ${scriptId}${jscontextId ? ` (context=${jscontextId})` : ''}`);
            const params = { scriptId };
            if (jscontextId) {
                params.__mcpJsContextId = jscontextId;
            }
            const result = await this.sendCommand('Debugger.getScriptSource', params);
            const source = result?.scriptSource || null;
            if (source) {
                infoLogger(`[CDP客户端] 成功获取脚本源代码: ${scriptId}, 长度: ${source.length}`);
            }
            else {
                infoLogger(`[CDP客户端] 脚本源代码为空: ${scriptId}`);
            }
            return source;
        }
        catch (e) {
            errorLogger('[CDP客户端] 获取脚本源代码失败:', e);
            return null;
        }
    }
    /**
     * 批量获取所有已解析脚本的源代码
     * @param waitMs 启用 Debugger 后等待脚本解析的时间
     */
    async getAllScriptSources(waitMs = 3000) {
        try {
            const scripts = await this.enableDebuggerAndWaitScripts(waitMs);
            const results = [];
            for (const script of scripts) {
                const source = await this.getScriptSource(script.scriptId);
                results.push({
                    scriptId: script.scriptId,
                    url: script.url,
                    source,
                });
            }
            return results;
        }
        catch (e) {
            errorLogger('[CDP客户端] 批量获取脚本源代码失败:', e);
            return [];
        }
    }
    /**
     * 获取所有执行上下文的脚本（旧方法，保留兼容）
     */
    async getAllScripts() {
        return this.getAllScriptSources();
    }
    /**
     * 搜索源代码
     * @param scriptId 脚本 ID
     * @param query 搜索查询
     */
    async searchInScripts(scriptId, query) {
        try {
            const result = await this.sendCommand('Debugger.searchInContent', {
                scriptId,
                query,
            });
            return result?.result || [];
        }
        catch (e) {
            errorLogger('[CDP客户端] 搜索源代码失败:', e);
            return [];
        }
    }
    // ==================== 源码缓存与索引 ====================
    /**
     * 获取脚本源码（带缓存）
     * 第一次调用通过 Debugger.getScriptSource 获取，之后从缓存读取
     * 对于压缩 JS（单行超大文件），自动标记 isCompressed
     */
    async getSourceWithCache(scriptId, forceRefresh = false) {
        // 检查缓存
        if (!forceRefresh) {
            const cached = this.sourceCache.get(scriptId);
            if (cached) {
                return cached;
            }
        }
        // 通过 CDP 获取源码
        const source = await this.getScriptSource(scriptId);
        if (!source) {
            return null;
        }
        const script = this.parsedScripts.get(scriptId);
        const url = script?.url || `scriptId://${scriptId}`;
        // 检测是否为压缩 JS（少于 10 行但长度很大）
        const lineCount = (source.match(/\n/g) || []).length + 1;
        const isCompressed = lineCount <= 3 && source.length > 10000;
        const entry = {
            scriptId,
            url,
            source,
            sourceLength: source.length,
            isCompressed,
            cachedAt: Date.now(),
        };
        this.sourceCache.set(scriptId, entry);
        infoLogger(`[CDP客户端] 源码已缓存: ${scriptId} (${url}), ${source.length} 字符, ${lineCount} 行, compressed=${isCompressed}`);
        return entry;
    }
    /**
     * 预缓存所有已解析脚本的源码
     */
    async cacheAllSources() {
        let cached = 0;
        for (const [scriptId] of this.parsedScripts) {
            if (!this.sourceCache.has(scriptId)) {
                const entry = await this.getSourceWithCache(scriptId);
                if (entry)
                    cached++;
            }
        }
        infoLogger(`[CDP客户端] 预缓存完成: ${cached} 个脚本`);
        return cached;
    }
    /**
     * 在指定脚本的缓存源码中搜索
     * 支持压缩 JS（单行超大文件）的精确列号定位
     */
    searchInSourceCache(query, scriptId, options = {}) {
        const results = [];
        const maxResults = options.maxResults || 100;
        const scriptsToSearch = scriptId
            ? [this.sourceCache.get(scriptId)].filter(Boolean)
            : Array.from(this.sourceCache.values());
        for (const entry of scriptsToSearch) {
            if (results.length >= maxResults)
                break;
            if (options.isRegex) {
                try {
                    const regex = new RegExp(query, 'gi');
                    let match;
                    while ((match = regex.exec(entry.source)) !== null && results.length < maxResults) {
                        const { lineNumber, columnNumber } = this.offsetToLineColumn(entry, match.index);
                        const contextStart = Math.max(0, match.index - 80);
                        const contextEnd = Math.min(entry.source.length, match.index + match[0].length + 80);
                        results.push({
                            scriptId: entry.scriptId,
                            url: entry.url,
                            lineNumber,
                            columnNumber,
                            match: match[0],
                            context: entry.source.substring(contextStart, contextEnd),
                        });
                    }
                }
                catch {
                    // 无效正则，跳过
                }
            }
            else {
                let pos = 0;
                const lowerSource = entry.source.toLowerCase();
                const lowerQuery = query.toLowerCase();
                while ((pos = lowerSource.indexOf(lowerQuery, pos)) !== -1 && results.length < maxResults) {
                    const { lineNumber, columnNumber } = this.offsetToLineColumn(entry, pos);
                    const contextStart = Math.max(0, pos - 80);
                    const contextEnd = Math.min(entry.source.length, pos + query.length + 80);
                    results.push({
                        scriptId: entry.scriptId,
                        url: entry.url,
                        lineNumber,
                        columnNumber,
                        match: entry.source.substring(pos, pos + query.length),
                        context: entry.source.substring(contextStart, contextEnd),
                    });
                    pos += query.length;
                }
            }
        }
        return results;
    }
    /**
     * 将字符偏移量转换为行号+列号
     * 对压缩 JS（单行）也能正确计算列号
     */
    offsetToLineColumn(entry, offset) {
        // 延迟计算行分割
        if (!entry.lines) {
            entry.lines = entry.source.split('\n');
        }
        let consumed = 0;
        for (let i = 0; i < entry.lines.length; i++) {
            const lineLen = entry.lines[i].length;
            if (offset <= consumed + lineLen) {
                return { lineNumber: i, columnNumber: offset - consumed };
            }
            consumed += lineLen + 1; // +1 for \n
        }
        // fallback
        return { lineNumber: 0, columnNumber: offset };
    }
    /**
     * 获取源码窗口（指定行范围）
     * 对压缩 JS 自动展开为可读格式
     */
    getSourceRange(scriptId, startLine, endLine) {
        const entry = this.sourceCache.get(scriptId);
        if (!entry) {
            return null;
        }
        if (!entry.lines) {
            entry.lines = entry.source.split('\n');
        }
        const totalLines = entry.lines.length;
        const safeStart = Math.max(0, startLine);
        const safeEnd = Math.min(totalLines - 1, endLine);
        const lines = [];
        for (let i = safeStart; i <= safeEnd; i++) {
            lines.push({
                lineNumber: i,
                content: entry.lines[i],
            });
        }
        return {
            scriptId: entry.scriptId,
            url: entry.url,
            startLine: safeStart,
            endLine: safeEnd,
            totalLines,
            lines,
            isCompressed: entry.isCompressed,
        };
    }
    /**
     * 获取源码缓存统计
     */
    getSourceCacheStats() {
        let totalSize = 0;
        let compressedCount = 0;
        for (const entry of this.sourceCache.values()) {
            totalSize += entry.sourceLength;
            if (entry.isCompressed)
                compressedCount++;
        }
        return {
            cachedScripts: this.sourceCache.size,
            totalSizeBytes: totalSize,
            compressedCount,
        };
    }
    /**
     * 清空源码缓存
     */
    clearSourceCache() {
        this.sourceCache.clear();
        infoLogger('[CDP客户端] 源码缓存已清空');
    }
    /**
     * 断开连接
     */
    disconnect() {
        this.stopHeartbeat();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.connected = false;
        }
        this.pendingRequests.clear();
        this.eventListeners.clear();
        this.parsedScripts.clear();
        this.networkRequests.clear();
        this.consoleMessages = [];
        this.networkEnabled = false;
        this.consoleEnabled = false;
        this.appServiceTarget = null;
        this.appServiceDebuggerEnabled = false;
        this.sourceCache.clear();
        // 通知小程序断开连接
        this.onEvent('MCP.miniprogramDisconnected', () => {
            infoLogger('[CDP客户端] 小程序已断开，清空已收集脚本状态');
            this.parsedScripts.clear();
            this.networkRequests.clear();
            this.consoleMessages = [];
        });
    }
    /**
     * 启动心跳检测
     */
    startHeartbeat() {
        this.stopHeartbeat();
        this.lastMessageTime = Date.now();
        this.heartbeatTimer = setInterval(() => {
            this.checkHeartbeat();
        }, this.heartbeatInterval);
        debugLogger('[CDP客户端] 心跳检测已启动');
    }
    /**
     * 停止心跳检测
     */
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
            debugLogger('[CDP客户端] 心跳检测已停止');
        }
    }
    /**
     * 检查心跳
     */
    checkHeartbeat() {
        if (!this.connected || !this.ws) {
            this.stopHeartbeat();
            return;
        }
        const now = Date.now();
        const timeSinceLastMessage = now - this.lastMessageTime;
        if (timeSinceLastMessage > this.heartbeatTimeout) {
            // 如果超过心跳超时时间没有收到消息，尝试发送ping
            try {
                this.ws.ping();
                debugLogger('[CDP客户端] 发送心跳 ping');
                // 设置ping响应超时
                const pingTimeout = setTimeout(() => {
                    // 如果没有收到pong响应，认为连接已断开
                    if (this.connected) {
                        errorLogger('[CDP客户端] 心跳 ping 超时，连接可能已断开');
                        this.handleConnectionLost();
                    }
                }, 5000);
                // 监听pong响应
                this.ws.once('pong', () => {
                    clearTimeout(pingTimeout);
                    this.lastMessageTime = Date.now();
                    debugLogger('[CDP客户端] 收到心跳 pong 响应');
                });
            }
            catch (error) {
                errorLogger('[CDP客户端] 发送心跳失败:', error);
                this.handleConnectionLost();
            }
        }
    }
    /**
     * 处理连接丢失
     */
    handleConnectionLost() {
        errorLogger('[CDP客户端] 检测到连接丢失，尝试重连...');
        this.connected = false;
        this.ws = null;
        this.stopHeartbeat();
        // 尝试重连
        this.connect(3, 2000).catch(err => {
            errorLogger('[CDP客户端] 自动重连失败:', err);
        });
    }
    /**
     * 获取所有已注册的执行上下文
     * 如果为空会自动触发刷新并重试
     */
    async getContexts(retryIfEmpty = true) {
        try {
            const id = ++this.requestId;
            const command = {
                id,
                method: 'MCP.getContexts',
                params: {},
            };
            const result = await new Promise((resolve, reject) => {
                this.pendingRequests.set(id, { resolve, reject });
                this.ws.send(JSON.stringify(command), (err) => {
                    if (err) {
                        this.pendingRequests.delete(id);
                        reject(err);
                    }
                });
                setTimeout(() => {
                    if (this.pendingRequests.has(id)) {
                        this.pendingRequests.delete(id);
                        reject(new Error('CDP 命令超时: MCP.getContexts'));
                    }
                }, 8000);
            });
            let contexts = result?.contexts || [];
            // 如果上下文为空，等待刷新后重试
            if (contexts.length === 0 && retryIfEmpty) {
                infoLogger('[CDP客户端] 上下文列表为空，等待刷新后重试...');
                await new Promise(r => setTimeout(r, 3000));
                return this.getContexts(false);
            }
            return contexts;
        }
        catch (e) {
            errorLogger('[CDP客户端] 获取上下文列表失败:', e);
            return [];
        }
    }
    /**
     * 获取 AppService（逻辑层）上下文 ID
     * 小程序的 AppService 上下文名称通常包含 'app'
     */
    async getAppServiceContextId() {
        const contexts = await this.getContexts();
        // 优先精确匹配 'app'
        let found = contexts.find(c => c.name === 'app');
        if (!found) {
            // 包含匹配 'app'
            found = contexts.find(c => c.name.toLowerCase().includes('app'));
        }
        if (!found) {
            // 如果只有一个上下文，使用它
            if (contexts.length === 1) {
                found = contexts[0];
            }
        }
        return found?.id || null;
    }
    /**
     * 确保 AppService 上下文可用，设置为目标上下文
     */
    async ensureAppServiceContext() {
        const appCtxId = await this.getAppServiceContextId();
        if (appCtxId) {
            const contexts = await this.getContexts(false);
            const appCtx = contexts.find(c => c.id === appCtxId);
            if (appCtx) {
                await this.setTargetContext(appCtx.name);
                infoLogger(`[CDP客户端] AppService 上下文已设置: ${appCtx.name} (id=${appCtxId})`);
                return true;
            }
        }
        return false;
    }
    /**
     * 设置目标执行上下文（按名称）
     * @param contextName 上下文名称（如 'app' 表示 appContext），null 则自动选择
     */
    async setTargetContext(contextName) {
        try {
            const id = ++this.requestId;
            const command = {
                id,
                method: 'MCP.setTargetContext',
                params: { name: contextName },
            };
            const result = await new Promise((resolve, reject) => {
                this.pendingRequests.set(id, { resolve, reject });
                this.ws.send(JSON.stringify(command), (err) => {
                    if (err) {
                        this.pendingRequests.delete(id);
                        reject(err);
                    }
                });
                setTimeout(() => {
                    if (this.pendingRequests.has(id)) {
                        this.pendingRequests.delete(id);
                        reject(new Error('CDP 命令超时: MCP.setTargetContext'));
                    }
                }, 5000);
            });
            return result;
        }
        catch (e) {
            errorLogger('[CDP客户端] 设置目标上下文失败:', e);
            return null;
        }
    }
    /**
     * 获取上下文名称对应的 executionContextId（数值）
     * 用于 Debugger.setBreakpoint 等需要 contextId 的命令
     */
    async getContextIdByName(name) {
        const contexts = await this.getContexts(false);
        const ctx = contexts.find(c => c.name === name || c.name.includes(name));
        if (ctx) {
            const numId = parseInt(ctx.id, 10);
            return isNaN(numId) ? null : numId;
        }
        return null;
    }
    /**
     * 获取当前目标上下文的 executionContextId
     */
    async getTargetContextId() {
        const contexts = await this.getContexts(false);
        if (contexts.length === 0)
            return null;
        // 返回第一个可用的上下文（通常是 AppService）
        const first = contexts[0];
        const numId = parseInt(first.id, 10);
        return isNaN(numId) ? null : numId;
    }
    // ==================== AppService Target 管理 ====================
    /**
     * 通过 Target.getTargets 自动发现 AppService Target
     * AppService Target 的 URL 通常包含 appservice 或 name 为 'app'
     */
    async discoverAppServiceTarget() {
        try {
            const result = await this.sendCommand('Target.getTargets');
            const targets = result?.targetInfos || [];
            // 查找 AppService target（type=page 且 URL 包含 appservice 或 name 包含 app）
            const appTarget = targets.find((t) => {
                const isPage = t.type === 'page';
                const isAppService = (t.url && t.url.includes('appservice')) ||
                    (t.title && t.title.toLowerCase().includes('app')) ||
                    (t.url && t.url.includes('miniprogram://'));
                return isPage && isAppService;
            });
            if (!appTarget) {
                infoLogger('[CDP客户端] 未找到 AppService Target');
                return null;
            }
            infoLogger(`[CDP客户端] 发现 AppService Target: targetId=${appTarget.targetId}, url=${appTarget.url}`);
            return {
                targetId: appTarget.targetId,
                sessionId: '', // 未 attach 前为空
                name: appTarget.title || appTarget.url,
                attached: false,
            };
        }
        catch (e) {
            errorLogger('[CDP客户端] 发现 AppService Target 失败:', e);
            return null;
        }
    }
    /**
     * 通过 Target.attachToTarget 附加到 AppService Target
     * 附加后所有 CDP 命令通过 sessionId 路由到该 target
     */
    async attachToAppServiceTarget() {
        try {
            // 先尝试发现
            let target = this.appServiceTarget;
            if (!target || !target.targetId) {
                target = await this.discoverAppServiceTarget();
                if (!target) {
                    // 回退：通过 contexts 获取
                    const ctxId = await this.getAppServiceContextId();
                    if (ctxId) {
                        target = {
                            targetId: ctxId,
                            sessionId: '',
                            name: 'app',
                            attached: false,
                        };
                    }
                    else {
                        return null;
                    }
                }
            }
            if (target.attached && target.sessionId) {
                return target.sessionId;
            }
            // 附加到 target
            const result = await this.sendCommand('Target.attachToTarget', {
                targetId: target.targetId,
                flatten: true,
            });
            const sessionId = result?.sessionId;
            if (!sessionId) {
                errorLogger('[CDP客户端] Target.attachToTarget 未返回 sessionId');
                return null;
            }
            this.appServiceTarget = {
                ...target,
                sessionId,
                attached: true,
            };
            infoLogger(`[CDP客户端] 已附加到 AppService Target: sessionId=${sessionId}`);
            return sessionId;
        }
        catch (e) {
            errorLogger('[CDP客户端] 附加到 AppService Target 失败:', e);
            return null;
        }
    }
    /**
     * 通过 sessionId 发送 CDP 命令到 AppService Target
     * 这是真正的 AppService 调试：命令直接路由到逻辑层 V8 Inspector
     */
    async sendCommandToAppService(method, params = {}) {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        // 确保已附加到 AppService Target
        let sessionId = this.appServiceTarget?.sessionId;
        if (!sessionId) {
            sessionId = await this.attachToAppServiceTarget() || undefined;
            if (!sessionId) {
                throw new Error('无法附加到 AppService Target');
            }
        }
        const id = ++this.requestId;
        const command = { id, method, params, sessionId };
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            this.ws.send(JSON.stringify(command), (err) => {
                if (err) {
                    this.pendingRequests.delete(id);
                    reject(err);
                }
            });
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`CDP 命令超时: ${method} (AppService)`));
                }
            }, 30000);
        });
    }
    /**
     * 在 AppService 中启用 Debugger 域
     *
     * 重要：不依赖 Target 附加
     * 直接调用 enableDebugger()，不通过 sendCommandToAppService
     * 正确链路：Debugger.enable → scriptParsed → scriptId → breakpoint
     */
    async enableAppServiceDebugger() {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        // 直接启用 Debugger，不依赖 Target 附加
        await this.enableDebugger();
        this.appServiceDebuggerEnabled = true;
        infoLogger('[CDP客户端] AppService Debugger 域已启用（不依赖 Target 附加）');
    }
    /**
     * 在 AppService 中设置断点（直接使用 scriptId，不依赖 Target 附加）
     *
     * 正确调试链路：
     * scriptParsed → scriptId → breakpoint → paused
     * 不需要 Target.attachToTarget，直接使用 Debugger.setBreakpoint
     */
    async setBreakpointOnAppService(scriptId, lineNumber, columnNumber = 0, condition) {
        // 直接委托给通用的 setBreakpointOnScript，不依赖 ExecutionContext
        return this.setBreakpointOnScript(scriptId, lineNumber, columnNumber, condition);
    }
    /**
     * 通过 URL 在 AppService 中设置断点（兼容旧接口）
     * 内部查找 scriptId 后调用 setBreakpointOnAppService
     */
    async setBreakpointOnAppServiceByUrl(url, lineNumber, columnNumber = 0, condition) {
        // 在已解析脚本中查找匹配的 scriptId
        const scripts = this.getParsedScripts();
        const matched = scripts.find(s => s.url === url || s.url.includes(url));
        if (matched) {
            return this.setBreakpointOnAppService(matched.scriptId, lineNumber, columnNumber, condition);
        }
        // 回退到 URL 方式
        return this.setBreakpointByUrl(url, lineNumber, columnNumber, condition);
    }
    /**
     * 在 AppService 中启用 Runtime 域（不依赖 Target 附加）
     */
    async enableAppServiceRuntime() {
        try {
            await this.sendCommand('Runtime.enable');
            infoLogger('[CDP客户端] AppService Runtime 域已启用');
        }
        catch (e) {
            errorLogger('[CDP客户端] 启用 AppService Runtime 失败:', e);
        }
    }
    /**
     * 在 AppService 中启用 Network 域（不依赖 Target 附加）
     * 关键：AppService 的网络请求通过这个域捕获
     */
    async enableAppServiceNetwork() {
        try {
            await this.sendCommand('Network.enable');
            this.networkEnabled = true;
            infoLogger('[CDP客户端] AppService Network 域已启用');
        }
        catch (e) {
            errorLogger('[CDP客户端] 启用 AppService Network 失败:', e);
        }
    }
    /**
     * 在 AppService 中启用 Debugger 并收集脚本
     *
     * 重要：不依赖 Target 附加
     * 直接调用 enableDebuggerAndWaitScripts
     */
    async enableAppServiceDebuggerAndWaitScripts(waitMs = 5000) {
        // 直接调用通用方法，不依赖 Target 附加
        return this.enableDebuggerAndWaitScripts(waitMs);
    }
    /**
     * 获取 AppService 调用栈详情
     * 包含函数参数、局部变量、this 引用
     */
    async getAppServiceCallStackDetails() {
        if (!this.pausedState.isPaused) {
            throw new Error('执行未暂停');
        }
        const frames = [];
        for (const frame of this.pausedState.callFrames) {
            const frameDetail = {
                callFrameId: frame.callFrameId,
                functionName: frame.functionName || '<anonymous>',
                location: frame.location,
                url: frame.url || `appservice://script:${frame.location.scriptId}`,
                this: frame.this,
            };
            // 提取函数参数
            const thisObj = frame.this;
            if (thisObj?.objectId) {
                try {
                    const thisProps = await this.sendCommand('Runtime.getProperties', {
                        objectId: thisObj.objectId,
                        ownProperties: true,
                    });
                    frameDetail.thisProperties = (thisProps.result || [])
                        .filter((p) => p.enumerable)
                        .map((p) => ({
                        name: p.name,
                        value: p.value?.value ?? p.value?.description ?? `[${p.value?.type}]`,
                        type: p.value?.type,
                    }));
                }
                catch {
                    // 忽略
                }
            }
            // 提取作用域链中的变量
            frameDetail.scopes = [];
            if (frame.scopeChain) {
                for (const scope of frame.scopeChain) {
                    if (scope.type === 'global')
                        continue;
                    if (scope.object?.objectId) {
                        try {
                            const scopeResult = await this.sendCommand('Runtime.getProperties', {
                                objectId: scope.object.objectId,
                                ownProperties: true,
                            });
                            const vars = (scopeResult.result || [])
                                .filter((p) => !p.name.startsWith('__') && p.enumerable)
                                .map((p) => ({
                                name: p.name,
                                value: p.value?.value ?? p.value?.description ?? `[${p.value?.type}]`,
                                type: p.value?.type,
                                isFunction: p.value?.type === 'function',
                            }));
                            frameDetail.scopes.push({
                                type: scope.type,
                                name: scope.name || scope.type,
                                variables: vars.slice(0, 50),
                            });
                        }
                        catch {
                            // 忽略
                        }
                    }
                }
            }
            frames.push(frameDetail);
        }
        return {
            callFrames: frames,
            reason: this.pausedState.reason || 'unknown',
            hitBreakpoints: this.pausedState.hitBreakpoints,
        };
    }
    /**
     * 通过 scriptId 在所有已解析脚本中查找匹配的脚本
     */
    findParsedScript(scriptId) {
        return this.parsedScripts.get(scriptId);
    }
    /**
     * 通过 URL 模糊查找脚本
     */
    findScriptsByUrl(urlPattern) {
        const lower = urlPattern.toLowerCase();
        return Array.from(this.parsedScripts.values())
            .filter(s => s.url && s.url.toLowerCase().includes(lower));
    }
    /**
     * 通过关键词搜索所有已解析脚本的源代码
     * 返回包含匹配的脚本及其行号
     */
    async searchInAllScripts(query) {
        const results = [];
        for (const [scriptId, script] of this.parsedScripts) {
            try {
                const matches = await this.searchInScripts(scriptId, query);
                for (const match of matches || []) {
                    results.push({
                        scriptId,
                        url: script.url,
                        lineNumber: match.lineNumber,
                        lineContent: match.lineContent,
                        columnNumber: match.columnNumber,
                    });
                }
            }
            catch {
                // 忽略搜索失败
            }
        }
        return results;
    }
    /**
     * 获取 AppService Target 信息
     */
    getAppServiceTarget() {
        return this.appServiceTarget;
    }
    /**
     * 检查 AppService Debugger 是否已启用
     */
    isAppServiceDebuggerEnabled() {
        return this.appServiceDebuggerEnabled;
    }
    /**
     * 检查是否已连接
     */
    isConnected() {
        return this.connected;
    }
    // ==================== 调试状态管理 ====================
    /**
     * 检查执行是否暂停
     */
    isPaused() {
        return this.pausedState.isPaused;
    }
    /**
     * 获取当前暂停状态
     */
    getPausedState() {
        return this.pausedState;
    }
    /**
     * 恢复执行
     */
    async resume() {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        if (!this.pausedState.isPaused) {
            throw new Error('执行未暂停');
        }
        await this.sendCommand('Debugger.resume');
    }
    /**
     * 暂停执行
     */
    async pause() {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        await this.sendCommand('Debugger.pause');
    }
    /**
     * 单步跳过
     */
    async stepOver() {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        if (!this.pausedState.isPaused) {
            throw new Error('执行未暂停');
        }
        const pausedPromise = this.waitForPaused();
        await this.sendCommand('Debugger.stepOver');
        return pausedPromise;
    }
    /**
     * 单步进入
     */
    async stepInto() {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        if (!this.pausedState.isPaused) {
            throw new Error('执行未暂停');
        }
        const pausedPromise = this.waitForPaused();
        await this.sendCommand('Debugger.stepInto');
        return pausedPromise;
    }
    /**
     * 单步跳出
     */
    async stepOut() {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        if (!this.pausedState.isPaused) {
            throw new Error('执行未暂停');
        }
        const pausedPromise = this.waitForPaused();
        await this.sendCommand('Debugger.stepOut');
        return pausedPromise;
    }
    /**
     * 等待下一次暂停
     */
    waitForPaused(timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.offEvent('Debugger.paused', onPaused);
                reject(new Error('等待调试器暂停超时'));
            }, timeoutMs);
            const onPaused = (params) => {
                clearTimeout(timer);
                this.offEvent('Debugger.paused', onPaused);
                const topFrame = params.callFrames?.[0];
                if (topFrame) {
                    resolve({
                        callFrameId: topFrame.callFrameId,
                        functionName: topFrame.functionName || '<anonymous>',
                        location: {
                            scriptId: topFrame.location.scriptId,
                            lineNumber: topFrame.location.lineNumber,
                            columnNumber: topFrame.location.columnNumber ?? 0,
                        },
                        url: topFrame.url || '',
                        scopeChain: [],
                        this: { type: topFrame.this?.type || 'object' },
                    });
                }
                else {
                    reject(new Error('暂停时没有调用帧'));
                }
            };
            this.onEvent('Debugger.paused', onPaused);
        });
    }
    /**
     * 在调用帧上评估表达式
     */
    async evaluateOnCallFrame(callFrameId, expression, options = {}) {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        if (!this.pausedState.isPaused) {
            throw new Error('执行未暂停');
        }
        return this.sendCommand('Debugger.evaluateOnCallFrame', {
            callFrameId,
            expression,
            returnByValue: options.returnByValue ?? false,
            generatePreview: options.generatePreview ?? true,
        });
    }
    /**
     * 获取作用域变量
     */
    async getScopeVariables(objectId) {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        const result = await this.sendCommand('Runtime.getProperties', {
            objectId,
            ownProperties: true,
            accessorPropertiesOnly: false,
            generatePreview: true,
        });
        const variables = [];
        for (const prop of result.result || []) {
            if (prop.name.startsWith('__') || prop.name === 'this') {
                continue;
            }
            const value = prop.value;
            if (!value) {
                continue;
            }
            variables.push({
                name: prop.name,
                type: value.type,
                value: value.value ?? value.description ?? `[${value.type}]`,
                description: value.description,
            });
        }
        return variables;
    }
    // ==================== 断点管理 ====================
    /**
     * 通过 URL 设置断点
     *
     * 重要原则：不依赖 ExecutionContext 路由
     * 直接发送 Debugger.setBreakpointByUrl，不附加 __mcpJsContextId
     * 代理层会自动路由到正确的 Inspector
     */
    async setBreakpointByUrl(url, lineNumber, columnNumber = 0, condition) {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        const params = {
            url,
            lineNumber,
            columnNumber,
        };
        if (condition) {
            params.condition = condition;
        }
        // 不再附加 __mcpJsContextId，让代理层自动路由
        const result = await this.sendCommand('Debugger.setBreakpointByUrl', params);
        const breakpointInfo = {
            breakpointId: result.breakpointId,
            url,
            lineNumber,
            columnNumber,
            condition,
            locations: (result.locations || []).map((loc) => ({
                scriptId: loc.scriptId,
                lineNumber: loc.lineNumber,
                columnNumber: loc.columnNumber ?? 0,
            })),
        };
        this.breakpoints.set(result.breakpointId, breakpointInfo);
        infoLogger(`[CDP客户端] 断点已设置 (URL方式): ${url}:${lineNumber}`);
        return breakpointInfo;
    }
    /**
     * 移除断点
     */
    async removeBreakpoint(breakpointId) {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        await this.sendCommand('Debugger.removeBreakpoint', { breakpointId });
        this.breakpoints.delete(breakpointId);
    }
    /**
     * 通过 scriptId + lineNumber + columnNumber 设置断点
     *
     * 正确调试链路：
     * CDP connect → Debugger.enable → Debugger.scriptParsed → 建立 scriptId/url/源码索引
     * → 搜索源码 → 定位函数 → Debugger.setBreakpoint(scriptId, lineNumber, columnNumber)
     * → Debugger.paused → 获取 callFrames → evaluateOnCallFrame → step → resume
     *
     * 不依赖 ExecutionContext，直接使用 Debugger.setBreakpoint
     */
    async setBreakpointOnScript(scriptId, lineNumber, columnNumber = 0, condition) {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        const params = {
            location: {
                scriptId,
                lineNumber,
                columnNumber,
            },
        };
        if (condition) {
            params.condition = condition;
        }
        // 直接使用 Debugger.setBreakpoint，不依赖 ExecutionContext
        const result = await this.sendCommand('Debugger.setBreakpoint', params);
        const resolvedLocations = [];
        if (result.actualLocation) {
            resolvedLocations.push({
                scriptId: result.actualLocation.scriptId || scriptId,
                lineNumber: result.actualLocation.lineNumber ?? lineNumber,
                columnNumber: result.actualLocation.columnNumber ?? 0,
            });
        }
        const breakpointInfo = {
            breakpointId: result.breakpointId,
            url: `scriptId://${scriptId}`,
            lineNumber,
            columnNumber,
            condition,
            locations: resolvedLocations,
        };
        this.breakpoints.set(result.breakpointId, breakpointInfo);
        // 验证断点是否解析到实际执行位置
        const resolved = resolvedLocations.length > 0;
        infoLogger(`[CDP客户端] 断点已设置 (scriptId方式): scriptId=${scriptId}, line=${lineNumber}, col=${columnNumber}, resolved=${resolved}`);
        return breakpointInfo;
    }
    /**
     * 获取所有断点
     */
    getBreakpoints() {
        return Array.from(this.breakpoints.values());
    }
    /**
     * 移除所有断点
     */
    async removeAllBreakpoints() {
        const breakpointIds = Array.from(this.breakpoints.keys());
        let removed = 0;
        const failed = [];
        for (const breakpointId of breakpointIds) {
            try {
                await this.removeBreakpoint(breakpointId);
                removed++;
            }
            catch {
                failed.push(breakpointId);
            }
        }
        return { removed, failed };
    }
    /**
     * 启用 Debugger 域
     *
     * 重要原则：不依赖 ExecutionContext
     * Debugger.enable 直接发送，不附加 __mcpJsContextId
     * 代理层会自动路由到当前活跃的 Inspector
     * 如果 CDP 连接能够获取 appservice.app.js 或 https://usr/*.js，
     * 直接认为该连接具备对应 JS 的 Debugger 能力
     */
    async enableDebugger() {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        // 直接发送 Debugger.enable，不依赖 ExecutionContext 路由
        await this.sendCommand('Debugger.enable');
        this.debuggerEnabled = true;
        // 设置异步调用栈深度
        try {
            await this.sendCommand('Debugger.setAsyncCallStackDepth', { maxDepth: 32 });
        }
        catch {
            // 忽略错误
        }
        infoLogger('[CDP客户端] Debugger 域已启用（不依赖 ExecutionContext）');
    }
    /**
     * 禁用 Debugger 域
     */
    async disableDebugger() {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        await this.sendCommand('Debugger.disable');
        this.debuggerEnabled = false;
        this.pausedState = { isPaused: false, callFrames: [] };
    }
    /**
     * 检查 Debugger 是否已启用
     */
    isDebuggerEnabled() {
        return this.debuggerEnabled;
    }
    // ==================== 网络请求管理 ====================
    /**
     * 启用 Network 域
     */
    async enableNetwork() {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        await this.sendCommand('Network.enable');
        this.networkEnabled = true;
        infoLogger('[CDP客户端] Network 域已启用');
    }
    /**
     * 禁用 Network 域
     */
    async disableNetwork() {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        await this.sendCommand('Network.disable');
        this.networkEnabled = false;
    }
    /**
     * 检查 Network 是否已启用
     */
    isNetworkEnabled() {
        return this.networkEnabled;
    }
    /**
     * 获取所有网络请求
     */
    getNetworkRequests() {
        return Array.from(this.networkRequests.values());
    }
    /**
     * 获取网络请求（带分页和过滤）
     */
    getNetworkRequestsFiltered(options = {}) {
        let requests = Array.from(this.networkRequests.values());
        // URL 过滤
        if (options.urlFilter) {
            const lowerFilter = options.urlFilter.toLowerCase();
            requests = requests.filter(r => r.url.toLowerCase().includes(lowerFilter));
        }
        // HTTP 方法过滤
        if (options.methods && options.methods.length > 0) {
            const lowerMethods = options.methods.map(m => m.toUpperCase());
            requests = requests.filter(r => lowerMethods.includes(r.method.toUpperCase()));
        }
        const total = requests.length;
        const pageSize = options.pageSize || 20;
        const page = options.pageIdx || 0;
        const start = page * pageSize;
        const end = start + pageSize;
        return {
            requests: requests.slice(start, end),
            total,
            page,
            pageSize,
        };
    }
    /**
     * 获取指定的网络请求
     */
    getNetworkRequestById(requestId) {
        return Array.from(this.networkRequests.values()).find(r => r.requestId === requestId);
    }
    /**
     * 清除所有网络请求
     */
    clearNetworkRequests() {
        const requestCount = this.networkRequests.size;
        // 估算回收的字节数
        let reclaimedBytes = 0;
        for (const request of this.networkRequests.values()) {
            reclaimedBytes += JSON.stringify(request).length;
        }
        this.networkRequests.clear();
        this.networkRequestId = 0;
        infoLogger(`[CDP客户端] 已清除 ${requestCount} 个网络请求`);
        return { requestCount, reclaimedBytes };
    }
    // ==================== XHR 断点管理 ====================
    /**
     * 设置 XHR/Fetch 断点
     */
    async setXHRBreakpoint(url) {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        this.xhrBreakpoints.add(url);
        // 注入脚本监控 XHR/Fetch
        const script = `
      (function() {
        if (window.__mcp_xhr_hook__) return;
        window.__mcp_xhr_hook__ = true;
        
        const urls = ${JSON.stringify(Array.from(this.xhrBreakpoints))};
        
        const originalXHROpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...args) {
          for (const pattern of urls) {
            if (url.includes(pattern)) {
              console.log('[MCP XHR Breakpoint] Pausing for:', url);
              debugger;
              break;
            }
          }
          return originalXHROpen.call(this, method, url, ...args);
        };
        
        const originalFetch = window.fetch;
        window.fetch = function(input, init) {
          const url = typeof input === 'string' ? input : input.url;
          for (const pattern of urls) {
            if (url.includes(pattern)) {
              console.log('[MCP Fetch Breakpoint] Pausing for:', url);
              debugger;
              break;
            }
          }
          return originalFetch.call(this, input, init);
        };
      })()
    `;
        await this.evaluateScript(script);
        infoLogger(`[CDP客户端] XHR 断点已设置: ${url}`);
    }
    /**
     * 移除 XHR/Fetch 断点
     */
    async removeXHRBreakpoint(url) {
        this.xhrBreakpoints.delete(url);
        infoLogger(`[CDP客户端] XHR 断点已移除: ${url}`);
    }
    /**
     * 获取所有 XHR 断点
     */
    getXHRBreakpoints() {
        return Array.from(this.xhrBreakpoints);
    }
    // ==================== 控制台消息管理 ====================
    /**
     * 启用 Runtime 域（用于捕获控制台消息）
     */
    async enableConsole() {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        await this.sendCommand('Runtime.enable');
        this.consoleEnabled = true;
        infoLogger('[CDP客户端] Console 域已启用');
    }
    /**
     * 检查 Console 是否已启用
     */
    isConsoleEnabled() {
        return this.consoleEnabled;
    }
    /**
     * 获取所有控制台消息
     */
    getConsoleMessages() {
        return this.consoleMessages;
    }
    /**
     * 获取控制台消息（带分页）
     */
    getConsoleMessagesPaginated(options = {}) {
        let messages = [...this.consoleMessages];
        // 类型过滤
        if (options.types && options.types.length > 0) {
            const lowerTypes = options.types.map(t => t.toLowerCase());
            messages = messages.filter(m => lowerTypes.includes(m.type.toLowerCase()));
        }
        const total = messages.length;
        const pageSize = options.pageSize || 20;
        const page = options.pageIdx || 0;
        const start = page * pageSize;
        const end = start + pageSize;
        return {
            messages: messages.slice(start, end),
            total,
            page,
            pageSize,
        };
    }
    /**
     * 清除控制台消息
     */
    clearConsoleMessages() {
        const count = this.consoleMessages.length;
        this.consoleMessages = [];
        infoLogger(`[CDP客户端] 已清除 ${count} 条控制台消息`);
        return count;
    }
    // ==================== 截图功能 ====================
    /**
     * 截取页面截图
     */
    async captureScreenshot(options = {}) {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        const params = {
            format: options.format || 'png',
        };
        if (options.quality && options.format !== 'png') {
            params.quality = options.quality;
        }
        if (options.fullPage) {
            params.captureBeyondViewport = true;
        }
        const result = await this.sendCommand('Page.captureScreenshot', params);
        return result.data; // base64 编码的图片
    }
    // ==================== 站点数据管理 ====================
    /**
     * 清除站点数据（cookies、存储等）
     */
    async clearSiteData(options = {}) {
        const cleared = [];
        // 清除 cookies
        if (options.cookies !== false) {
            try {
                await this.sendCommand('Network.clearBrowserCookies');
                cleared.push('cookies');
            }
            catch (e) {
                errorLogger('[CDP客户端] 清除 cookies 失败:', e);
            }
        }
        // 清除缓存
        if (options.cache !== false) {
            try {
                await this.sendCommand('Network.clearBrowserCache');
                cleared.push('cache');
            }
            catch (e) {
                errorLogger('[CDP客户端] 清除缓存失败:', e);
            }
        }
        // 清除 localStorage 和 sessionStorage（通过脚本）
        if (options.localStorage !== false || options.sessionStorage !== false) {
            try {
                const script = `
          (function() {
            if (${options.localStorage !== false}) {
              try { localStorage.clear(); } catch(e) {}
            }
            if (${options.sessionStorage !== false}) {
              try { sessionStorage.clear(); } catch(e) {}
            }
          })()
        `;
                await this.evaluateScript(script);
                if (options.localStorage !== false)
                    cleared.push('localStorage');
                if (options.sessionStorage !== false)
                    cleared.push('sessionStorage');
            }
            catch (e) {
                errorLogger('[CDP客户端] 清除存储失败:', e);
            }
        }
        infoLogger(`[CDP客户端] 已清除站点数据: ${cleared.join(', ')}`);
        return { cleared };
    }
    // ==================== 页面框架管理 ====================
    /**
     * 获取所有框架
     */
    async getFrames() {
        if (!this.connected || !this.ws) {
            await this.connect();
        }
        const result = await this.sendCommand('Page.getFrameTree');
        const frames = [];
        const traverse = (frameTree) => {
            if (frameTree.frame) {
                frames.push({
                    id: frameTree.frame.id,
                    url: frameTree.frame.url,
                    name: frameTree.frame.name,
                    parentId: frameTree.frame.parentId,
                });
            }
            if (frameTree.childFrames) {
                for (const child of frameTree.childFrames) {
                    traverse(child);
                }
            }
        };
        traverse(result.frameTree);
        return frames;
    }
}
/** 全局 CDP 客户端实例 */
let globalClient = null;
/**
 * 获取全局 CDP 客户端实例
 * @param cdpPort CDP 代理端口
 * @param debugPort 调试服务器端口
 * @param debugMain 是否输出主进程调试信息
 */
export function getCDPClient(cdpPort = 62000, debugPort = 9421, debugMain = false) {
    if (!globalClient) {
        globalClient = new CDPClient(cdpPort, debugPort, debugMain);
    }
    return globalClient;
}
/**
 * 重置全局 CDP 客户端
 */
export function resetCDPClient() {
    if (globalClient) {
        globalClient.disconnect();
        globalClient = null;
    }
}
//# sourceMappingURL=cdp-client.js.map