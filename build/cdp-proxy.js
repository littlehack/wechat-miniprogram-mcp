/**
 * CDP 代理服务器模块
 * 整合 WMPFDebugger 的微信小程序调试协议转换功能
 * 将微信小程序的私有调试协议转换为标准 Chrome DevTools Protocol
 *
 * 支持懒加载：仅在 ensureServersStarted() 被调用时启动服务器
 */
import { EventEmitter } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { debugLogger, errorLogger, infoLogger } from './logger.js';
import { codex, messageProto } from './cjs-wrapper.js';
// WMPF 调试消息类别常量
const DebugMessageCategory = {
    SetupContext: 'setupContext',
    AddJsContext: 'addJsContext',
    RemoveJsContext: 'removeJsContext',
    ConnectJsContext: 'connectJsContext',
    ChromeDevtools: 'chromeDevtools',
    ChromeDevtoolsResult: 'chromeDevtoolsResult',
};
/** 调试消息事件发射器 */
const debugMessageEmitter = new EventEmitter();
/** 服务器是否已启动 */
let serversStarted = false;
let debugWss = null;
let cdpWss = null;
/** 记录实际启动的端口（用于判断是否需要重启） */
let startedDebugPort = null;
let startedCdpPort = null;
/** 小程序是否已连接 */
let miniProgramConnected = false;
const jsContextMap = new Map();
/** Session 映射：sessionId -> jscontext_id（标准 CDP Target 协议支持） */
const sessionMap = new Map();
/** 脚本归属注册表：scriptId -> jscontext_id（Debugger 命令按脚本归属自动路由到正确上下文） */
const scriptOwners = new Map();
/** 待响应命令关联表：op_id -> jscontext_id（用于把响应/事件归因到发起命令的上下文） */
const pendingOps = new Map();
let opIdCounter = 1000;
/** 最近一次 Debugger.enable 路由到的上下文（scriptParsed 事件归因兜底） */
let lastDebuggerEnableContext = '';
/** 服务器启动警告（端口占用等信息，供工具层向用户报告） */
const startupIssues = [];
/** 当前活跃的上下文 ID（仅用于状态展示，不再参与命令路由） */
let activeContextId = null;
/** 目标上下文名称（优先使用，如 'app' 表示 appContext 逻辑层） */
let targetContextName = null;
/** 递增的 sessionId 计数器 */
let sessionIdCounter = 0;
/** 上下文刷新等待队列：当 CDP 客户端连接时，等待小程序重新注册上下文 */
let contextRefreshPending = false;
let contextRefreshResolvers = [];
/**
 * 等待上下文刷新完成（最多等待 waitMs 毫秒）
 * 当 CDP 客户端连接但 jsContextMap 为空时调用
 */
export function waitForContextRefresh(waitMs = 5000) {
    if (jsContextMap.size > 0) {
        return Promise.resolve(true);
    }
    if (!miniProgramConnected) {
        return Promise.resolve(false);
    }
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            cleanup();
            resolve(jsContextMap.size > 0);
        }, waitMs);
        const cleanup = () => {
            clearTimeout(timer);
            const idx = contextRefreshResolvers.indexOf(onDone);
            if (idx !== -1)
                contextRefreshResolvers.splice(idx, 1);
        };
        const onDone = () => {
            cleanup();
            resolve(jsContextMap.size > 0);
        };
        contextRefreshResolvers.push(onDone);
        // 如果尚未发起刷新，现在发起
        if (!contextRefreshPending) {
            requestContextRefresh();
        }
    });
}
/**
 * 向小程序请求重新注册上下文
 * 发送 ConnectJsContext 触发小程序重新上报 addJsContext
 */
function requestContextRefresh() {
    if (!miniProgramConnected)
        return;
    contextRefreshPending = true;
    infoLogger('[CDP代理] 请求小程序刷新上下文注册...');
    // 向所有连接的小程序客户端发送 ConnectJsContext 触发重新注册
    debugWss?.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            // 发送一个 ConnectJsContext 用空 id 触发小程序重新上报所有上下文
            const wrappedData = codex.wrapDebugMessageData({ jscontext_id: '' }, 'connectJsContext', 0);
            const outData = {
                seq: 0,
                category: 'connectJsContext',
                data: wrappedData.buffer,
                compressAlgo: 0,
                originalSize: wrappedData.originalSize,
            };
            const encodedData = messageProto.mmbizwxadevremote.WARemoteDebug_DebugMessage.encode(outData).finish();
            client.send(encodedData, { binary: true });
        }
    });
    // 5 秒后标记刷新完成
    setTimeout(() => {
        contextRefreshPending = false;
        contextRefreshResolvers.forEach((r) => r());
        contextRefreshResolvers = [];
        infoLogger(`[CDP代理] 上下文刷新完成，当前 ${jsContextMap.size} 个上下文`);
    }, 3000);
}
/**
 * 按名称查找上下文（精确匹配优先，其次包含匹配）
 */
function findContextByName(name) {
    for (const info of jsContextMap.values()) {
        if (info.name === name)
            return info;
    }
    for (const info of jsContextMap.values()) {
        if (info.name.includes(name))
            return info;
    }
    return null;
}
/**
 * 设置目标上下文名称
 * @param name 上下文名称（如 'app', 'page-frame_100' 等），null 则使用最新的
 */
export function setTargetContext(name) {
    targetContextName = name;
    infoLogger(`[CDP代理] 目标上下文已设置为: ${name || '(自动选择最新)'}`);
    // 立即更新 activeContextId
    resolveActiveContext();
}
/**
 * 获取所有已注册的上下文信息
 */
export function getRegisteredContexts() {
    return Array.from(jsContextMap.values()).map(c => ({ id: c.id, name: c.name }));
}
/**
 * 解析并设置当前活跃的上下文 ID
 * 仅用于状态展示；命令路由由 resolveRoutingContext 决定
 */
function resolveActiveContext() {
    if (targetContextName) {
        const matched = findContextByName(targetContextName);
        activeContextId = matched ? matched.id : null;
    }
    else {
        activeContextId = null;
    }
}
/**
 * 解析一条 CDP 命令应该路由到哪个 jscontext
 *
 * 优先级：
 * 1. 显式 __mcpJsContextId 覆盖（转发前从 params 中移除）
 * 2. 标准 CDP sessionId 映射
 * 3. scriptId 归属（Debugger 域命令自动路由到拥有该脚本的上下文）
 * 4. targetContextName 名称匹配
 * 5. 自动识别 AppService 上下文（Debugger/Network/Runtime 域命令）
 * 6. 空字符串 —— 与原版 WMPFDebugger 行为一致，由小程序 host 自行路由（默认命中逻辑层）
 */
function resolveRoutingContext(parsed) {
    if (parsed && typeof parsed === 'object') {
        // 1. 显式覆盖
        if (parsed.params &&
            typeof parsed.params === 'object' &&
            parsed.params.__mcpJsContextId !== undefined) {
            const explicit = String(parsed.params.__mcpJsContextId);
            delete parsed.params.__mcpJsContextId;
            if (explicit)
                return explicit;
        }
        // 2. 标准 CDP sessionId 映射
        if (typeof parsed.sessionId === 'string' && sessionMap.has(parsed.sessionId)) {
            return sessionMap.get(parsed.sessionId);
        }
        // 3. scriptId 归属
        if (typeof parsed.method === 'string' &&
            parsed.method.startsWith('Debugger.') &&
            parsed.params &&
            parsed.params.scriptId !== undefined) {
            const owner = scriptOwners.get(String(parsed.params.scriptId));
            if (owner !== undefined) {
                return owner;
            }
        }
        // 3.5. 对于 Debugger.setBreakpoint，尝试从 location.scriptId 路由
        if (typeof parsed.method === 'string' &&
            parsed.method === 'Debugger.setBreakpoint' &&
            parsed.params &&
            parsed.params.location &&
            parsed.params.location.scriptId) {
            const owner = scriptOwners.get(String(parsed.params.location.scriptId));
            if (owner !== undefined) {
                return owner;
            }
        }
    }
    // 4. 按名称匹配目标上下文
    if (targetContextName) {
        const matched = findContextByName(targetContextName);
        return matched ? matched.id : '';
    }
    // 5. 自动识别 AppService 上下文（Debugger/Network/Runtime 域命令默认路由到逻辑层）
    if (parsed && typeof parsed.method === 'string') {
        const method = parsed.method;
        if (method.startsWith('Debugger.') ||
            method.startsWith('Network.') ||
            method.startsWith('Runtime.')) {
            const appCtx = findContextByName('app');
            if (appCtx) {
                return appCtx.id;
            }
        }
    }
    // 6. 默认空串（host 自行路由，与原版 WMPFDebugger 保持一致）
    return '';
}
/**
 * 停止所有服务器
 */
export function stopServers() {
    if (debugWss) {
        debugWss.close();
        debugWss = null;
    }
    if (cdpWss) {
        cdpWss.close();
        cdpWss = null;
    }
    debugMessageEmitter.removeAllListeners();
    miniProgramConnected = false;
    jsContextMap.clear();
    sessionMap.clear();
    scriptOwners.clear();
    pendingOps.clear();
    lastDebuggerEnableContext = '';
    activeContextId = null;
    serversStarted = false;
    startedDebugPort = null;
    startedCdpPort = null;
    infoLogger('[服务器] 已停止所有服务器');
}
/**
 * 检查代理服务器是否已启动
 */
export function isProxyStarted() {
    return serversStarted;
}
/**
 * 检查小程序是否已连接
 */
export function isMiniProgramConnected() {
    return miniProgramConnected;
}
/**
 * 等待小程序连接
 * @param timeout 超时时间（毫秒）
 * @returns 是否连接成功
 */
export function waitForMiniProgram(timeout = 60000) {
    if (miniProgramConnected) {
        return Promise.resolve(true);
    }
    return new Promise((resolve) => {
        const onConnect = () => {
            cleanup();
            resolve(true);
        };
        const onTimeout = () => {
            cleanup();
            resolve(false);
        };
        const cleanup = () => {
            debugMessageEmitter.removeListener('miniprogram_connected', onConnect);
            clearTimeout(timer);
        };
        debugMessageEmitter.on('miniprogram_connected', onConnect);
        const timer = setTimeout(onTimeout, timeout);
    });
}
/**
 * 检查端口是否已被占用
 * @param port 端口号
 * @returns 端口是否被占用
 */
function isPortInUse(port) {
    try {
        const { execSync } = require('child_process');
        // 使用更可靠的命令检测端口占用
        // Windows: netstat -ano | findstr ":PORT" | findstr "LISTENING"
        // Linux/Mac: lsof -i :PORT -t
        const result = execSync(`netstat -ano | findstr ":${port}" | findstr "LISTENING"`, { encoding: 'utf8' });
        return result.trim().length > 0;
    }
    catch (e) {
        // 如果命令执行失败，尝试另一种方法
        try {
            const { execSync } = require('child_process');
            const result = execSync(`netstat -ano | findstr ":${port}"`, { encoding: 'utf8' });
            return result.includes('LISTENING');
        }
        catch (e2) {
            // 如果都失败了，返回false（假设端口未被占用）
            return false;
        }
    }
}
/**
 * 获取服务器启动警告（端口占用等），供工具层向用户报告
 */
export function getStartupIssues() {
    return [...startupIssues];
}
/**
 * 获取路由诊断信息（上下文、脚本归属数量等）
 */
export function getRoutingDiagnostics() {
    return {
        contexts: getRegisteredContexts(),
        trackedScripts: scriptOwners.size,
        targetContextName,
    };
}
/**
 * 确保服务器已启动（懒加载）
 * 仅在首次调用时启动调试服务器和 CDP 代理服务器
 * 如果端口已被占用（如独立运行的 WMPFDebugger），则跳过启动并记录警告
 * @param debugPort 调试服务器端口
 * @param cdpPort CDP 代理服务器端口
 * @param debugMain 是否输出主进程调试信息
 */
export function ensureServersStarted(debugPort, cdpPort, debugMain) {
    // 如果端口匹配且已启动，跳过
    if (serversStarted && startedDebugPort === debugPort && startedCdpPort === cdpPort) {
        return;
    }
    // 端口不匹配或首次启动，需要重新初始化
    if (serversStarted) {
        infoLogger(`[懒加载] 端口变更 (${startedDebugPort}->${debugPort}, ${startedCdpPort}->${cdpPort})，重新启动服务器...`);
        stopServers();
    }
    startupIssues.length = 0;
    // 检查端口是否已被占用
    const debugPortBusy = isPortInUse(debugPort);
    const cdpPortBusy = isPortInUse(cdpPort);
    serversStarted = true;
    startedDebugPort = debugPort;
    startedCdpPort = cdpPort;
    if (debugPortBusy && cdpPortBusy) {
        // 端口均被占用，可能存在独立运行的 WMPFDebugger，复用其通道
        startupIssues.push(`端口 ${debugPort} 和 ${cdpPort} 均被占用，本进程跳过启动（可能存在独立运行的 WMPFDebugger，正在复用其通道）`);
        infoLogger(`[懒加载] 端口 ${debugPort} 和 ${cdpPort} 已被占用，跳过启动（可能有其他实例在运行）`);
        return;
    }
    infoLogger('[懒加载] 首次工具调用，尝试启动 CDP 代理服务器...');
    if (!debugPortBusy) {
        startDebugServer(debugPort, debugMain);
    }
    else {
        startupIssues.push(`调试服务器端口 ${debugPort} 已被占用，本进程未能监听。小程序将连接到占用该端口的其他进程，命令可能无法送达`);
        infoLogger(`[懒加载] 调试服务器端口 ${debugPort} 已被占用，跳过启动`);
    }
    if (!cdpPortBusy) {
        startCdpProxyServer(cdpPort);
    }
    else {
        startupIssues.push(`CDP 代理端口 ${cdpPort} 已被占用，本进程未能监听。CDP 客户端将连接到占用该端口的其他进程`);
        infoLogger(`[懒加载] CDP 代理端口 ${cdpPort} 已被占用，跳过启动`);
    }
}
/**
 * 将 ArrayBuffer 转换为十六进制字符串
 * @param buffer 输入缓冲区
 * @returns 十六进制字符串
 */
const bufferToHexString = (buffer) => {
    return Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
};
/**
 * 启动调试服务器（小程序连接端）
 * 接收微信小程序的私有协议消息，解码后转发给 CDP 客户端
 * @param debugPort 调试服务器端口
 * @param debugMain 是否输出主进程调试信息
 */
export function startDebugServer(debugPort, debugMain) {
    const wss = new WebSocketServer({ port: debugPort });
    wss.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            errorLogger(`[调试服务器] 端口 ${debugPort} 已被占用，请关闭占用该端口的进程`);
        }
        else {
            errorLogger('[调试服务器] 服务器错误:', err);
        }
    });
    infoLogger(`[调试服务器] 运行在 ws://localhost:${debugPort}`);
    infoLogger(`[调试服务器] 等待小程序连接...`);
    let messageCounter = 0;
    /**
     * 向指定 WebSocket 连接发送 WMPF 消息
     */
    const sendWmpfMessage = (ws, category, data) => {
        const wrappedData = codex.wrapDebugMessageData(data, category, 0);
        const outData = {
            seq: ++messageCounter,
            category,
            data: wrappedData.buffer,
            compressAlgo: 0,
            originalSize: wrappedData.originalSize,
        };
        const encodedData = messageProto.mmbizwxadevremote.WARemoteDebug_DebugMessage.encode(outData).finish();
        ws.send(encodedData, { binary: true });
    };
    /**
     * 处理 setupContext 消息
     */
    const handleSetupContext = (data, ws) => {
        infoLogger('[小程序] 收到 setupContext:', JSON.stringify(data, null, 2));
        // setupContext 包含设备信息、注册接口等，记录即可
    };
    /**
     * 处理 addJsContext 消息
     * 关键：必须回复 ConnectJsContext 才能激活 V8 Inspector
     */
    const handleAddJsContext = (data, ws) => {
        const contextId = data.jscontext_id;
        const contextName = data.jscontext_name || 'unknown';
        const isAppService = contextName === 'app' || contextName.toLowerCase().includes('app');
        infoLogger(`[小程序] 收到 addJsContext: id=${contextId}, name=${contextName}${isAppService ? ' [AppService]' : ''}`);
        // 记录上下文映射
        jsContextMap.set(contextId, { id: contextId, name: contextName, ws });
        // 为该 context 生成一个标准 CDP sessionId
        const sessionId = `miniprogram-session-${++sessionIdCounter}`;
        sessionMap.set(sessionId, contextId);
        infoLogger(`[小程序] 创建 sessionId=${sessionId} -> jscontext_id=${contextId} 映射`);
        // 解析活跃上下文（优先匹配 targetContextName）
        resolveActiveContext();
        // 回复 ConnectJsContext 激活 V8 Inspector
        infoLogger(`[小程序] 发送 ConnectJsContext: id=${contextId}`);
        sendWmpfMessage(ws, DebugMessageCategory.ConnectJsContext, {
            jscontext_id: contextId,
        });
        // 生成 Runtime.executionContextCreated CDP 事件转发给 Chrome DevTools
        const cdpEvent = JSON.stringify({
            method: 'Runtime.executionContextCreated',
            params: {
                context: {
                    id: contextId,
                    origin: isAppService ? 'miniprogram://appservice' : `miniprogram://${contextName}`,
                    name: contextName,
                    uniqueId: `miniprogram-context-${contextId}`,
                    // AppService 标记：帮助 Chrome DevTools 识别逻辑层
                    auxData: isAppService ? {
                        isDefault: true,
                        frameId: contextId,
                        type: 'appservice',
                    } : undefined,
                },
            },
        });
        debugMessageEmitter.emit('cdpmessage', cdpEvent);
        infoLogger(`[CDP] 转发 Runtime.executionContextCreated: contextId=${contextId}${isAppService ? ' (AppService)' : ''}`);
    };
    /**
     * 处理 removeJsContext 消息
     */
    const handleRemoveJsContext = (data, ws) => {
        const contextId = data.jscontext_id;
        infoLogger(`[小程序] 收到 removeJsContext: id=${contextId}`);
        // 清理 session 映射（删除所有指向该 contextId 的 sessionId）
        for (const [sessionId, mappedContextId] of sessionMap.entries()) {
            if (mappedContextId === contextId) {
                sessionMap.delete(sessionId);
            }
        }
        // 清理 scriptOwners 映射（删除该上下文拥有的所有脚本）
        for (const [scriptId, ownerContextId] of scriptOwners.entries()) {
            if (ownerContextId === contextId) {
                scriptOwners.delete(scriptId);
            }
        }
        // 清理 pendingOps 映射（删除该上下文的所有待处理操作）
        for (const [opId, opContextId] of pendingOps.entries()) {
            if (opContextId === contextId) {
                pendingOps.delete(opId);
            }
        }
        jsContextMap.delete(contextId);
        // 重新解析活跃上下文
        resolveActiveContext();
        const cdpEvent = JSON.stringify({
            method: 'Runtime.executionContextDestroyed',
            params: { executionContextId: contextId },
        });
        debugMessageEmitter.emit('cdpmessage', cdpEvent);
        // 检查是否所有上下文都已移除
        if (jsContextMap.size === 0) {
            miniProgramConnected = false;
            infoLogger('[小程序] 所有上下文已移除，标记小程序为断开连接');
        }
    };
    /**
     * 处理来自小程序的消息
     * @param ws WebSocket 连接
     * @param message 原始消息数据
     */
    const onMessage = (ws, message) => {
        debugLogger(`[小程序] 收到原始消息 (十六进制): ${bufferToHexString(message)}`);
        let unwrappedData = null;
        try {
            const decodedData = messageProto.mmbizwxadevremote.WARemoteDebug_DebugMessage.decode(message);
            unwrappedData = codex.unwrapDebugMessageData(decodedData);
            debugLogger(`[小程序] 解码数据 (category=${unwrappedData.category}):`, unwrappedData);
        }
        catch (e) {
            errorLogger(`[小程序] 解码错误:`, e);
            return;
        }
        if (unwrappedData === null) {
            return;
        }
        switch (unwrappedData.category) {
            case DebugMessageCategory.SetupContext:
                handleSetupContext(unwrappedData.data, ws);
                break;
            case DebugMessageCategory.AddJsContext:
                handleAddJsContext(unwrappedData.data, ws);
                break;
            case DebugMessageCategory.RemoveJsContext:
                handleRemoveJsContext(unwrappedData.data, ws);
                break;
            case DebugMessageCategory.ChromeDevtoolsResult: {
                const resultData = unwrappedData.data;
                const payload = resultData.payload;
                // 跟踪 Debugger.scriptParsed 事件，记录脚本归属
                if (typeof payload === 'string' && payload.includes('Debugger.scriptParsed')) {
                    try {
                        const parsed = JSON.parse(payload);
                        if (parsed.method === 'Debugger.scriptParsed' && parsed.params) {
                            const scriptId = parsed.params.scriptId;
                            const scriptUrl = parsed.params.url || '';
                            // 使用结果消息的 sessionId 或 jscontext 归属来确定脚本属于哪个上下文
                            const sessionId = resultData.sessionId;
                            if (sessionId && sessionMap.has(sessionId)) {
                                const contextId = sessionMap.get(sessionId);
                                scriptOwners.set(String(scriptId), contextId);
                                debugLogger(`[小程序] 注册脚本归属: scriptId=${scriptId} -> contextId=${contextId} (url=${scriptUrl})`);
                            }
                            // 识别 AppService 虚拟脚本（appservice.app.js、https://usr/xxx.js 等）
                            const isAppServiceScript = scriptUrl.includes('appservice') ||
                                scriptUrl.includes('app.js') ||
                                scriptUrl.startsWith('https://usr/') ||
                                scriptUrl.startsWith('http://usr/') ||
                                scriptUrl.includes('miniprogram://');
                            if (isAppServiceScript) {
                                debugLogger(`[小程序] AppService 虚拟脚本: scriptId=${scriptId}, url=${scriptUrl}`);
                            }
                        }
                    }
                    catch {
                        // 忽略解析错误
                    }
                }
                // 跟踪 Debugger.paused 事件（用于 AppService 断点命中检测）
                if (typeof payload === 'string' && payload.includes('Debugger.paused')) {
                    try {
                        const parsed = JSON.parse(payload);
                        if (parsed.method === 'Debugger.paused' && parsed.params) {
                            const reason = parsed.params.reason;
                            const hitBps = parsed.params.hitBreakpoints || [];
                            infoLogger(`[小程序] Debugger.paused: reason=${reason}, hitBreakpoints=${hitBps.length}`);
                        }
                    }
                    catch {
                        // 忽略
                    }
                }
                // 跟踪 Network 请求（AppService 网络请求）
                if (typeof payload === 'string' && payload.includes('Network.requestWillBeSent')) {
                    try {
                        const parsed = JSON.parse(payload);
                        if (parsed.method === 'Network.requestWillBeSent' && parsed.params) {
                            const url = parsed.params.request?.url || '';
                            debugLogger(`[小程序] AppService 网络请求: ${url}`);
                        }
                    }
                    catch {
                        // 忽略
                    }
                }
                // 转发 CDP 结果给 Chrome DevTools
                debugMessageEmitter.emit('cdpmessage', payload);
                break;
            }
            default:
                debugLogger(`[小程序] 未处理的消息类别: ${unwrappedData.category}`);
                break;
        }
    };
    wss.on('connection', (ws) => {
        infoLogger('[小程序] 小程序客户端已连接');
        miniProgramConnected = true;
        debugMessageEmitter.emit('miniprogram_connected');
        ws.on('message', (msg) => onMessage(ws, msg));
        ws.on('error', (err) => {
            errorLogger('[小程序] 客户端错误:', err);
        });
        ws.on('close', () => {
            infoLogger('[小程序] 客户端已断开');
            miniProgramConnected = false;
        });
    });
    /**
     * 处理来自 CDP 客户端的消息
     * 将标准 CDP 消息编码为微信私有协议并发送给小程序
     */
    debugMessageEmitter.on('proxymessage', (message) => {
        // 解析 CDP 消息
        let parsed = null;
        try {
            parsed = JSON.parse(message);
        }
        catch (e) {
            // 不是 JSON，直接转发
        }
        // 处理特殊的 MCP 控制命令
        if (parsed?.method === 'MCP.setTargetContext') {
            setTargetContext(parsed.params?.name || null);
            const response = JSON.stringify({
                id: parsed.id,
                result: {
                    contexts: getRegisteredContexts(),
                    activeContextId: activeContextId,
                    targetContextName: targetContextName,
                },
            });
            debugMessageEmitter.emit('cdpmessage', response);
            return;
        }
        if (parsed?.method === 'MCP.getContexts') {
            // 如果上下文为空但小程序已连接，触发刷新（异步，客户端需重试）
            if (jsContextMap.size === 0 && miniProgramConnected) {
                infoLogger('[CDP] MCP.getContexts: 上下文为空，触发异步刷新...');
                requestContextRefresh();
            }
            const response = JSON.stringify({
                id: parsed.id,
                result: {
                    contexts: getRegisteredContexts(),
                    activeContextId: activeContextId,
                    targetContextName: targetContextName,
                },
            });
            debugMessageEmitter.emit('cdpmessage', response);
            return;
        }
        // 处理标准 CDP Target 命令（本地处理，不转发给小程序）
        if (parsed?.method === 'Target.getTargets') {
            const targets = Array.from(jsContextMap.values()).map((ctx) => {
                // AppService target 的 URL 格式：miniprogram://app（与 AppService 上下文对应）
                const isApp = ctx.name === 'app' || ctx.name.includes('app');
                return {
                    targetId: ctx.id,
                    type: 'page',
                    title: ctx.name,
                    url: isApp
                        ? 'miniprogram://appservice'
                        : `miniprogram://${ctx.name}`,
                    attached: false,
                    openerId: undefined,
                    canAccessOpener: false,
                };
            });
            const response = JSON.stringify({
                id: parsed.id,
                result: { targetInfos: targets },
            });
            debugMessageEmitter.emit('cdpmessage', response);
            infoLogger(`[CDP] Target.getTargets: 返回 ${targets.length} 个目标`);
            return;
        }
        if (parsed?.method === 'Target.attachToTarget') {
            const targetId = parsed.params?.targetId;
            const flatten = parsed.params?.flatten ?? false;
            const jsContext = jsContextMap.get(targetId);
            if (!jsContext) {
                const response = JSON.stringify({
                    id: parsed.id,
                    error: { code: -32000, message: `Target not found: ${targetId}` },
                });
                debugMessageEmitter.emit('cdpmessage', response);
                return;
            }
            // 生成 sessionId 并建立映射
            const sessionId = `miniprogram-session-${++sessionIdCounter}`;
            sessionMap.set(sessionId, targetId);
            // 自动切换到该 context
            activeContextId = targetId;
            // 如果 flatten 模式，自动向 target 发送 Debugger.enable
            if (flatten) {
                infoLogger(`[CDP] Target.attachToTarget (flatten=true): target=${jsContext.name}, sessionId=${sessionId}`);
            }
            const response = JSON.stringify({
                id: parsed.id,
                result: {
                    sessionId: sessionId,
                    targetInfo: {
                        targetId: targetId,
                        type: 'page',
                        title: jsContext.name,
                        url: (jsContext.name === 'app' || jsContext.name.includes('app'))
                            ? 'miniprogram://appservice'
                            : `miniprogram://${jsContext.name}`,
                    },
                },
            });
            debugMessageEmitter.emit('cdpmessage', response);
            infoLogger(`[CDP] Target.attachToTarget: target=${jsContext.name}, sessionId=${sessionId}`);
            return;
        }
        if (parsed?.method === 'Target.detachFromTarget') {
            const sessionId = parsed.params?.sessionId;
            if (sessionId) {
                sessionMap.delete(sessionId);
            }
            const response = JSON.stringify({ id: parsed.id, result: {} });
            debugMessageEmitter.emit('cdpmessage', response);
            return;
        }
        // 处理 Target.setAutoAttach（Chrome DevTools 自动附加行为）
        if (parsed?.method === 'Target.setAutoAttach') {
            const response = JSON.stringify({ id: parsed.id, result: {} });
            debugMessageEmitter.emit('cdpmessage', response);
            infoLogger('[CDP] Target.setAutoAttach: 已响应');
            return;
        }
        // 处理 Target.setDiscoverTargets
        if (parsed?.method === 'Target.setDiscoverTargets') {
            const response = JSON.stringify({ id: parsed.id, result: {} });
            debugMessageEmitter.emit('cdpmessage', response);
            infoLogger('[CDP] Target.setDiscoverTargets: 已响应');
            return;
        }
        // 确定要使用的 jscontext_id
        let contextId = resolveRoutingContext(parsed);
        // 如果消息包含 sessionId，使用映射的 jscontext_id（最高优先级）
        if (parsed?.sessionId) {
            const mappedContextId = sessionMap.get(parsed.sessionId);
            if (mappedContextId) {
                contextId = mappedContextId;
                debugLogger(`[CDP代理] 使用 sessionId ${parsed.sessionId} -> contextId ${contextId}`);
            }
        }
        // 如果是空 contextId 但消息是 Debugger 域命令，尝试自动路由到 AppService
        if (!contextId && parsed?.method?.startsWith('Debugger.')) {
            const appCtx = findContextByName('app');
            if (appCtx) {
                contextId = appCtx.id;
                debugLogger(`[CDP代理] Debugger 命令自动路由到 AppService: ${contextId}`);
            }
        }
        // 同样，Network 域命令也尝试路由到 AppService
        if (!contextId && parsed?.method?.startsWith('Network.')) {
            const appCtx = findContextByName('app');
            if (appCtx) {
                contextId = appCtx.id;
                debugLogger(`[CDP代理] Network 命令自动路由到 AppService: ${contextId}`);
            }
        }
        // 同样，Runtime 域命令也尝试路由到 AppService
        if (!contextId && parsed?.method?.startsWith('Runtime.')) {
            const appCtx = findContextByName('app');
            if (appCtx) {
                contextId = appCtx.id;
                debugLogger(`[CDP代理] Runtime 命令自动路由到 AppService: ${contextId}`);
            }
        }
        // 转发给小程序
        wss &&
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    // 将 CDP 消息编码为微信私有协议格式
                    const opId = ++opIdCounter;
                    pendingOps.set(opId, contextId);
                    if (pendingOps.size > 500) {
                        const oldest = pendingOps.keys().next().value;
                        if (oldest !== undefined)
                            pendingOps.delete(oldest);
                    }
                    const rawPayload = {
                        jscontext_id: contextId,
                        op_id: opId,
                        payload: message.toString(),
                    };
                    debugLogger(`[CDP代理] 转发消息 (contextId=${contextId}, opId=${opId}):`, rawPayload);
                    const wrappedData = codex.wrapDebugMessageData(rawPayload, 'chromeDevtools', 0);
                    const outData = {
                        seq: ++messageCounter,
                        category: 'chromeDevtools',
                        data: wrappedData.buffer,
                        compressAlgo: 0,
                        originalSize: wrappedData.originalSize,
                    };
                    const encodedData = messageProto.mmbizwxadevremote.WARemoteDebug_DebugMessage.encode(outData).finish();
                    client.send(encodedData, { binary: true });
                }
            });
    });
}
/**
 * 启动 CDP 代理服务器（开发者工具连接端）
 * 接收标准 CDP 消息，转发给小程序调试服务器
 * @param cdpPort CDP 代理服务器端口
 */
export function startCdpProxyServer(cdpPort) {
    const wss = new WebSocketServer({ port: cdpPort });
    wss.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            errorLogger(`[CDP代理] 端口 ${cdpPort} 已被占用，请关闭占用该端口的进程`);
        }
        else {
            errorLogger('[CDP代理] 服务器错误:', err);
        }
    });
    infoLogger(`[CDP代理] 运行在 ws://localhost:${cdpPort}`);
    infoLogger(`[CDP代理] 调试链接: devtools://devtools/bundled/inspector.html?ws=127.0.0.1:${cdpPort}`);
    /**
     * 处理来自 CDP 客户端的消息
     * @param message CDP 消息
     */
    const onMessage = (message) => {
        debugMessageEmitter.emit('proxymessage', message);
    };
    wss.on('connection', (ws) => {
        infoLogger('[CDP] CDP 客户端已连接（Chrome 开发者工具）');
        ws.on('message', onMessage);
        ws.on('error', (err) => {
            errorLogger('[CDP] 客户端错误:', err);
        });
        ws.on('close', () => {
            infoLogger('[CDP] 客户端已断开');
        });
        // 关键修复：新客户端连接时，重发所有已知的 executionContext
        for (const [contextId, contextInfo] of jsContextMap.entries()) {
            const cdpEvent = JSON.stringify({
                method: 'Runtime.executionContextCreated',
                params: {
                    context: {
                        id: contextId,
                        origin: `miniprogram://${contextInfo.name}`,
                        name: contextInfo.name,
                        uniqueId: `miniprogram-context-${contextId}`,
                    },
                },
            });
            ws.send(cdpEvent);
            infoLogger(`[CDP] 重发 Runtime.executionContextCreated: contextId=${contextId}, name=${contextInfo.name}`);
        }
        // 关键修复：如果 jsContextMap 为空但小程序已连接，请求上下文刷新
        if (jsContextMap.size === 0 && miniProgramConnected) {
            infoLogger('[CDP] jsContextMap 为空但小程序已连接，请求上下文刷新...');
            requestContextRefresh();
        }
    });
    /**
     * 处理来自小程序的 CDP 消息
     * 转发给所有连接的 CDP 客户端
     */
    debugMessageEmitter.on('cdpmessage', (message) => {
        wss &&
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(message);
                }
            });
    });
}
//# sourceMappingURL=cdp-proxy.js.map