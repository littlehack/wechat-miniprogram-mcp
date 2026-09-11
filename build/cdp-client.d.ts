/**
 * CDP 客户端模块
 * 通过 WebSocket 连接到 CDP 代理服务器，发送 CDP 调试命令
 *
 * 支持两种连接模式：
 * 1. 代理模式：通过 WMPFDebugger 代理连接微信小程序
 * 2. 直连模式：直接连接到 Chrome/Chromium 的 CDP 端口（通用 JS 逆向）
 */
/** 已解析的脚本信息 */
interface ParsedScript {
    scriptId: string;
    url: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    /** 执行上下文 ID（可选，不作为调试前置条件） */
    executionContextId?: number;
    hash: string;
    sourceMapURL?: string;
    hasSourceURL?: boolean;
    isModule?: boolean;
    length?: number;
    __jscontext?: string;
}
/** 调用帧信息 */
export interface CallFrame {
    callFrameId: string;
    functionName: string;
    location: {
        scriptId: string;
        lineNumber: number;
        columnNumber: number;
    };
    url: string;
    scopeChain: ScopeInfo[];
    this: RemoteObject;
}
/** 作用域信息 */
export interface ScopeInfo {
    type: 'global' | 'local' | 'with' | 'closure' | 'catch' | 'block' | 'script' | 'eval' | 'module';
    object: RemoteObject;
    name?: string;
}
/** 远程对象 */
export interface RemoteObject {
    type: string;
    subtype?: string;
    className?: string;
    value?: unknown;
    description?: string;
    objectId?: string;
}
/** 暂停状态 */
export interface PausedState {
    isPaused: boolean;
    reason?: string;
    callFrames: CallFrame[];
    data?: unknown;
    hitBreakpoints?: string[];
}
/** 断点信息 */
export interface BreakpointInfo {
    breakpointId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
    condition?: string;
    locations: Array<{
        scriptId: string;
        lineNumber: number;
        columnNumber: number;
    }>;
}
/** 网络请求信息 */
export interface NetworkRequest {
    id: string;
    requestId: number;
    url: string;
    method: string;
    headers: Record<string, string>;
    timestamp: number;
    status?: number;
    responseHeaders?: Record<string, string>;
    initiator?: {
        type: string;
        url?: string;
        lineNumber?: number;
        columnNumber?: number;
        stack?: any;
    };
}
/** 控制台消息 */
export interface ConsoleMessage {
    id: number;
    type: string;
    text: string;
    timestamp: number;
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
}
/** AppService Target 信息 */
export interface AppServiceTarget {
    targetId: string;
    sessionId: string;
    name: string;
    attached: boolean;
}
/** 源码缓存条目 */
export interface SourceCacheEntry {
    scriptId: string;
    url: string;
    source: string;
    sourceLength: number;
    /** 按行分割的源码（延迟计算） */
    lines?: string[];
    /** 是否为单行压缩 JS */
    isCompressed: boolean;
    /** 缓存时间 */
    cachedAt: number;
}
/** 源码搜索结果 */
export interface SourceSearchResult {
    scriptId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
    match: string;
    /** 匹配行的上下文（前后各 80 字符） */
    context?: string;
}
/** 源码窗口结果 */
export interface SourceRangeResult {
    scriptId: string;
    url: string;
    startLine: number;
    endLine: number;
    totalLines: number;
    lines: Array<{
        lineNumber: number;
        content: string;
    }>;
    isCompressed: boolean;
}
/** CDP 客户端类 */
export declare class CDPClient {
    private ws;
    private requestId;
    private pendingRequests;
    private eventListeners;
    private connected;
    private cdpPort;
    private debugPort;
    private debugMain;
    private connectionMode;
    private parsedScripts;
    private pausedState;
    private breakpoints;
    private debuggerEnabled;
    private networkRequests;
    private networkRequestId;
    private networkEnabled;
    private xhrBreakpoints;
    private consoleMessages;
    private consoleEnabled;
    private heartbeatTimer;
    private lastMessageTime;
    private heartbeatInterval;
    private heartbeatTimeout;
    private appServiceTarget;
    private appServiceDebuggerEnabled;
    private sourceCache;
    private directWsUrl?;
    constructor(cdpPort?: number, debugPort?: number, debugMain?: boolean);
    /**
     * 连接到 CDP 目标
     * 支持两种模式：
     * - proxy 模式：通过 WMPFDebugger 代理连接微信小程序（默认）
     * - direct 模式：直接连接到 Chrome/Chromium 的 CDP WebSocket 端口
     * @param maxRetries 最大重试次数，默认 3
     * @param retryDelay 重试延迟（毫秒），默认 1000
     */
    connect(maxRetries?: number, retryDelay?: number): Promise<void>;
    /**
     * 直连到 Chrome DevTools WebSocket
     * 用于通用 JS 逆向场景（非微信小程序）
     * @param wsUrl WebSocket URL，如 ws://127.0.0.1:9222/devtools/page/xxx
     */
    connectDirect(wsUrl: string): Promise<void>;
    /**
     * 连接到 Chrome DevTools HTTP 端点并自动选择页面
     * @param host Chrome DevTools 主机（默认 127.0.0.1）
     * @param port Chrome DevTools 端口（默认 9222）
     */
    connectToDevTools(host?: string, port?: number): Promise<void>;
    /**
     * 单次连接尝试（内部方法）
     */
    private connectOnce;
    /**
     * 发送 CDP 命令
     */
    sendCommand(method: string, params?: any): Promise<any>;
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
    evaluateScript(expression: string, contextId?: number, contextName?: string): Promise<any>;
    /**
     * 获取所有执行上下文
     */
    getExecutionContexts(): Promise<any[]>;
    /**
     * 启用 Runtime 域
     */
    enableRuntime(): Promise<void>;
    /**
     * 注册 CDP 事件监听器
     */
    onEvent(eventMethod: string, listener: (params: any) => void): void;
    /**
     * 移除 CDP 事件监听器
     */
    offEvent(eventMethod: string, listener: (params: any) => void): void;
    /**
     * 获取已收集的解析脚本列表
     */
    getParsedScripts(): ParsedScript[];
    /**
     * 清空已收集的脚本
     */
    clearParsedScripts(): void;
    /**
     * 启用 Debugger 域并等待脚本解析完成
     * @param waitMs 等待脚本解析的时间（毫秒），默认 3000
     * @param reset 是否重置已收集的脚本（默认 false，保持累积）
     */
    enableDebuggerAndWaitScripts(waitMs?: number, reset?: boolean): Promise<ParsedScript[]>;
    /**
     * 获取所有脚本（旧方法，保留兼容）
     */
    getScripts(): Promise<any[]>;
    /**
     * 获取脚本源代码
     * @param scriptId 脚本 ID
     * @param jscontextId 可选的上下文 ID，用于路由到特定上下文
     */
    getScriptSource(scriptId: string, jscontextId?: string): Promise<string | null>;
    /**
     * 批量获取所有已解析脚本的源代码
     * @param waitMs 启用 Debugger 后等待脚本解析的时间
     */
    getAllScriptSources(waitMs?: number): Promise<Array<{
        scriptId: string;
        url: string;
        source: string | null;
    }>>;
    /**
     * 获取所有执行上下文的脚本（旧方法，保留兼容）
     */
    getAllScripts(): Promise<any[]>;
    /**
     * 搜索源代码
     * @param scriptId 脚本 ID
     * @param query 搜索查询
     */
    searchInScripts(scriptId: string, query: string): Promise<any[]>;
    /**
     * 获取脚本源码（带缓存）
     * 第一次调用通过 Debugger.getScriptSource 获取，之后从缓存读取
     * 对于压缩 JS（单行超大文件），自动标记 isCompressed
     */
    getSourceWithCache(scriptId: string, forceRefresh?: boolean): Promise<SourceCacheEntry | null>;
    /**
     * 预缓存所有已解析脚本的源码
     */
    cacheAllSources(): Promise<number>;
    /**
     * 在指定脚本的缓存源码中搜索
     * 支持压缩 JS（单行超大文件）的精确列号定位
     */
    searchInSourceCache(query: string, scriptId?: string, options?: {
        isRegex?: boolean;
        maxResults?: number;
    }): SourceSearchResult[];
    /**
     * 将字符偏移量转换为行号+列号
     * 对压缩 JS（单行）也能正确计算列号
     */
    private offsetToLineColumn;
    /**
     * 获取源码窗口（指定行范围）
     * 对压缩 JS 自动展开为可读格式
     */
    getSourceRange(scriptId: string, startLine: number, endLine: number): SourceRangeResult | null;
    /**
     * 获取源码缓存统计
     */
    getSourceCacheStats(): {
        cachedScripts: number;
        totalSizeBytes: number;
        compressedCount: number;
    };
    /**
     * 清空源码缓存
     */
    clearSourceCache(): void;
    /**
     * 断开连接
     */
    disconnect(): void;
    /**
     * 启动心跳检测
     */
    private startHeartbeat;
    /**
     * 停止心跳检测
     */
    private stopHeartbeat;
    /**
     * 检查心跳
     */
    private checkHeartbeat;
    /**
     * 处理连接丢失
     */
    private handleConnectionLost;
    /**
     * 获取所有已注册的执行上下文
     * 如果为空会自动触发刷新并重试
     */
    getContexts(retryIfEmpty?: boolean): Promise<Array<{
        id: string;
        name: string;
    }>>;
    /**
     * 获取 AppService（逻辑层）上下文 ID
     * 小程序的 AppService 上下文名称通常包含 'app'
     */
    getAppServiceContextId(): Promise<string | null>;
    /**
     * 确保 AppService 上下文可用，设置为目标上下文
     */
    ensureAppServiceContext(): Promise<boolean>;
    /**
     * 设置目标执行上下文（按名称）
     * @param contextName 上下文名称（如 'app' 表示 appContext），null 则自动选择
     */
    setTargetContext(contextName: string | null): Promise<any>;
    /**
     * 获取上下文名称对应的 executionContextId（数值）
     * 用于 Debugger.setBreakpoint 等需要 contextId 的命令
     */
    getContextIdByName(name: string): Promise<number | null>;
    /**
     * 获取当前目标上下文的 executionContextId
     */
    getTargetContextId(): Promise<number | null>;
    /**
     * 通过 Target.getTargets 自动发现 AppService Target
     * AppService Target 的 URL 通常包含 appservice 或 name 为 'app'
     */
    discoverAppServiceTarget(): Promise<AppServiceTarget | null>;
    /**
     * 通过 Target.attachToTarget 附加到 AppService Target
     * 附加后所有 CDP 命令通过 sessionId 路由到该 target
     */
    attachToAppServiceTarget(): Promise<string | null>;
    /**
     * 通过 sessionId 发送 CDP 命令到 AppService Target
     * 这是真正的 AppService 调试：命令直接路由到逻辑层 V8 Inspector
     */
    sendCommandToAppService(method: string, params?: any): Promise<any>;
    /**
     * 在 AppService 中启用 Debugger 域
     *
     * 重要：不依赖 Target 附加
     * 直接调用 enableDebugger()，不通过 sendCommandToAppService
     * 正确链路：Debugger.enable → scriptParsed → scriptId → breakpoint
     */
    enableAppServiceDebugger(): Promise<void>;
    /**
     * 在 AppService 中设置断点（直接使用 scriptId，不依赖 Target 附加）
     *
     * 正确调试链路：
     * scriptParsed → scriptId → breakpoint → paused
     * 不需要 Target.attachToTarget，直接使用 Debugger.setBreakpoint
     */
    setBreakpointOnAppService(scriptId: string, lineNumber: number, columnNumber?: number, condition?: string): Promise<BreakpointInfo>;
    /**
     * 通过 URL 在 AppService 中设置断点（兼容旧接口）
     * 内部查找 scriptId 后调用 setBreakpointOnAppService
     */
    setBreakpointOnAppServiceByUrl(url: string, lineNumber: number, columnNumber?: number, condition?: string): Promise<BreakpointInfo>;
    /**
     * 在 AppService 中启用 Runtime 域（不依赖 Target 附加）
     */
    enableAppServiceRuntime(): Promise<void>;
    /**
     * 在 AppService 中启用 Network 域（不依赖 Target 附加）
     * 关键：AppService 的网络请求通过这个域捕获
     */
    enableAppServiceNetwork(): Promise<void>;
    /**
     * 在 AppService 中启用 Debugger 并收集脚本
     *
     * 重要：不依赖 Target 附加
     * 直接调用 enableDebuggerAndWaitScripts
     */
    enableAppServiceDebuggerAndWaitScripts(waitMs?: number): Promise<ParsedScript[]>;
    /**
     * 获取 AppService 调用栈详情
     * 包含函数参数、局部变量、this 引用
     */
    getAppServiceCallStackDetails(): Promise<{
        callFrames: any[];
        reason: string;
        hitBreakpoints?: string[];
    }>;
    /**
     * 通过 scriptId 在所有已解析脚本中查找匹配的脚本
     */
    findParsedScript(scriptId: string): ParsedScript | undefined;
    /**
     * 通过 URL 模糊查找脚本
     */
    findScriptsByUrl(urlPattern: string): ParsedScript[];
    /**
     * 通过关键词搜索所有已解析脚本的源代码
     * 返回包含匹配的脚本及其行号
     */
    searchInAllScripts(query: string): Promise<Array<{
        scriptId: string;
        url: string;
        lineNumber: number;
        lineContent: string;
        columnNumber?: number;
    }>>;
    /**
     * 获取 AppService Target 信息
     */
    getAppServiceTarget(): AppServiceTarget | null;
    /**
     * 检查 AppService Debugger 是否已启用
     */
    isAppServiceDebuggerEnabled(): boolean;
    /**
     * 检查是否已连接
     */
    isConnected(): boolean;
    /**
     * 检查执行是否暂停
     */
    isPaused(): boolean;
    /**
     * 获取当前暂停状态
     */
    getPausedState(): PausedState;
    /**
     * 恢复执行
     */
    resume(): Promise<void>;
    /**
     * 暂停执行
     */
    pause(): Promise<void>;
    /**
     * 单步跳过
     */
    stepOver(): Promise<CallFrame>;
    /**
     * 单步进入
     */
    stepInto(): Promise<CallFrame>;
    /**
     * 单步跳出
     */
    stepOut(): Promise<CallFrame>;
    /**
     * 等待下一次暂停
     */
    private waitForPaused;
    /**
     * 在调用帧上评估表达式
     */
    evaluateOnCallFrame(callFrameId: string, expression: string, options?: {
        returnByValue?: boolean;
        generatePreview?: boolean;
    }): Promise<any>;
    /**
     * 获取作用域变量
     */
    getScopeVariables(objectId: string): Promise<Array<{
        name: string;
        type: string;
        value: unknown;
        description?: string;
    }>>;
    /**
     * 通过 URL 设置断点
     *
     * 重要原则：不依赖 ExecutionContext 路由
     * 直接发送 Debugger.setBreakpointByUrl，不附加 __mcpJsContextId
     * 代理层会自动路由到正确的 Inspector
     */
    setBreakpointByUrl(url: string, lineNumber: number, columnNumber?: number, condition?: string): Promise<BreakpointInfo>;
    /**
     * 移除断点
     */
    removeBreakpoint(breakpointId: string): Promise<void>;
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
    setBreakpointOnScript(scriptId: string, lineNumber: number, columnNumber?: number, condition?: string): Promise<BreakpointInfo>;
    /**
     * 获取所有断点
     */
    getBreakpoints(): BreakpointInfo[];
    /**
     * 移除所有断点
     */
    removeAllBreakpoints(): Promise<{
        removed: number;
        failed: string[];
    }>;
    /**
     * 启用 Debugger 域
     *
     * 重要原则：不依赖 ExecutionContext
     * Debugger.enable 直接发送，不附加 __mcpJsContextId
     * 代理层会自动路由到当前活跃的 Inspector
     * 如果 CDP 连接能够获取 appservice.app.js 或 https://usr/*.js，
     * 直接认为该连接具备对应 JS 的 Debugger 能力
     */
    enableDebugger(): Promise<void>;
    /**
     * 禁用 Debugger 域
     */
    disableDebugger(): Promise<void>;
    /**
     * 检查 Debugger 是否已启用
     */
    isDebuggerEnabled(): boolean;
    /**
     * 启用 Network 域
     */
    enableNetwork(): Promise<void>;
    /**
     * 禁用 Network 域
     */
    disableNetwork(): Promise<void>;
    /**
     * 检查 Network 是否已启用
     */
    isNetworkEnabled(): boolean;
    /**
     * 获取所有网络请求
     */
    getNetworkRequests(): NetworkRequest[];
    /**
     * 获取网络请求（带分页和过滤）
     */
    getNetworkRequestsFiltered(options?: {
        pageSize?: number;
        pageIdx?: number;
        methods?: string[];
        resourceTypes?: string[];
        urlFilter?: string;
    }): {
        requests: NetworkRequest[];
        total: number;
        page: number;
        pageSize: number;
    };
    /**
     * 获取指定的网络请求
     */
    getNetworkRequestById(requestId: number): NetworkRequest | undefined;
    /**
     * 清除所有网络请求
     */
    clearNetworkRequests(): {
        requestCount: number;
        reclaimedBytes: number;
    };
    /**
     * 设置 XHR/Fetch 断点
     */
    setXHRBreakpoint(url: string): Promise<void>;
    /**
     * 移除 XHR/Fetch 断点
     */
    removeXHRBreakpoint(url: string): Promise<void>;
    /**
     * 获取所有 XHR 断点
     */
    getXHRBreakpoints(): string[];
    /**
     * 启用 Runtime 域（用于捕获控制台消息）
     */
    enableConsole(): Promise<void>;
    /**
     * 检查 Console 是否已启用
     */
    isConsoleEnabled(): boolean;
    /**
     * 获取所有控制台消息
     */
    getConsoleMessages(): ConsoleMessage[];
    /**
     * 获取控制台消息（带分页）
     */
    getConsoleMessagesPaginated(options?: {
        pageSize?: number;
        pageIdx?: number;
        types?: string[];
    }): {
        messages: ConsoleMessage[];
        total: number;
        page: number;
        pageSize: number;
    };
    /**
     * 清除控制台消息
     */
    clearConsoleMessages(): number;
    /**
     * 截取页面截图
     */
    captureScreenshot(options?: {
        format?: 'png' | 'jpeg' | 'webp';
        quality?: number;
        fullPage?: boolean;
    }): Promise<string>;
    /**
     * 清除站点数据（cookies、存储等）
     */
    clearSiteData(options?: {
        cookies?: boolean;
        localStorage?: boolean;
        sessionStorage?: boolean;
        cache?: boolean;
    }): Promise<{
        cleared: string[];
    }>;
    /**
     * 获取所有框架
     */
    getFrames(): Promise<Array<{
        id: string;
        url: string;
        name?: string;
        parentId?: string;
    }>>;
}
/**
 * 获取全局 CDP 客户端实例
 * @param cdpPort CDP 代理端口
 * @param debugPort 调试服务器端口
 * @param debugMain 是否输出主进程调试信息
 */
export declare function getCDPClient(cdpPort?: number, debugPort?: number, debugMain?: boolean): CDPClient;
/**
 * 重置全局 CDP 客户端
 */
export declare function resetCDPClient(): void;
export {};
//# sourceMappingURL=cdp-client.d.ts.map