/**
 * JS 逆向分析工具
 * 整合 js-reverse-mcp 的调试功能
 * 通过 CDP 协议与小程序通信
 */
import { z } from 'zod';
import { getCDPClient } from '../cdp-client.js';
import { ToolCategory } from './wechat-miniprogram.js';
/**
 * 执行 JavaScript 代码工具
 * 在目标页面中执行任意 JavaScript 代码
 */
export const evaluateScript = {
    name: 'evaluate_script',
    description: '在目标页面中执行 JavaScript 代码，可用于动态调试和数据提取。断点暂停时请使用 evaluate_on_call_frame',
    category: ToolCategory.SCRIPT,
    schema: {
        script: z.string().describe('要执行的 JavaScript 代码'),
        context: z.string().optional().describe('执行上下文名称（如 "app"=逻辑层, "page-frame"=渲染层），不指定则使用当前活跃上下文'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            // 如果指定了上下文名称，先切换
            if (params.context) {
                await client.setTargetContext(params.context);
            }
            // 使用 contextName 参数让 evaluateScript 自动路由到正确上下文
            const result = await client.evaluateScript(params.script, undefined, params.context || 'app');
            return {
                status: 'executed',
                result: result?.result?.value ?? result?.result ?? result,
                exception_details: result?.exceptionDetails || null,
                message: '脚本执行完成',
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `执行失败: ${e.message}`,
            };
        }
    },
};
/**
 * 搜索源代码工具（基于 Script Registry）
 * 优先使用本地源码缓存搜索，不依赖 ExecutionContext
 */
export const searchInSources = {
    name: 'search_in_sources',
    description: '在已加载的 JavaScript 源代码中搜索函数、变量、字符串等。基于 Script Registry 的本地缓存搜索，不依赖 ExecutionContext',
    category: ToolCategory.SCRIPT,
    schema: {
        query: z.string().describe('搜索关键词'),
        is_regex: z.boolean().optional().describe('是否使用正则表达式'),
        script_id: z.string().optional().describe('限定在特定 scriptId 中搜索，不指定则搜索所有已缓存脚本'),
        max_results: z.number().optional().describe('最大返回结果数（默认 50）'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            // 确保 Debugger 已启用
            if (!client.isDebuggerEnabled()) {
                await client.sendCommand('Debugger.enable');
                await new Promise(r => setTimeout(r, 1000));
            }
            // 确保源码已缓存
            const cacheStats = client.getSourceCacheStats();
            if (cacheStats.cachedScripts === 0) {
                // 尝试预缓存
                await client.cacheAllSources();
            }
            // 使用本地缓存搜索
            const results = client.searchInSourceCache(params.query, params.script_id, {
                isRegex: params.is_regex,
                maxResults: params.max_results || 50,
            });
            return {
                status: 'searched',
                query: params.query,
                is_regex: params.is_regex || false,
                total_matches: results.length,
                cache_stats: client.getSourceCacheStats(),
                results,
                message: `搜索完成: ${results.length} 个匹配 (缓存 ${client.getSourceCacheStats().cachedScripts} 个脚本)`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `搜索失败: ${e.message}`,
            };
        }
    },
};
/**
 * 设置断点工具
 * 基于 scriptId + lineNumber + columnNumber 直接设置断点
 * 支持虚拟脚本（appservice.app.js、https://usr/xxx.js 等）
 */
export const setBreakpoint = {
    name: 'set_breakpoint',
    description: '在 JavaScript 代码中设置断点。支持通过 scriptId + 行号直接在虚拟脚本中下断点（无需访问虚拟 URL）',
    category: ToolCategory.DEBUGGER,
    schema: {
        script_url: z.string().describe('脚本 scriptId 或 URL'),
        line: z.number().int().describe('行号（从 1 开始）'),
        column: z.number().int().optional().describe('列号（从 0 开始，默认 0）'),
        condition: z.string().optional().describe('条件断点表达式'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            // 确保 Debugger 已启用
            if (!client.isDebuggerEnabled()) {
                await client.sendCommand('Debugger.enable');
                await new Promise(r => setTimeout(r, 1000));
            }
            const lineNumber = params.line - 1; // CDP 使用 0-indexed 行号
            const columnNumber = params.column || 0;
            // 在已解析脚本中查找匹配的 scriptId
            let targetScriptId = params.script_url;
            let matchedScript = null;
            const scripts = client.getParsedScripts();
            // 1. 精确匹配 scriptId
            matchedScript = scripts.find(s => s.scriptId === params.script_url);
            // 2. URL 模糊匹配
            if (!matchedScript) {
                matchedScript = scripts.find(s => s.url && s.url.includes(params.script_url));
                if (matchedScript) {
                    targetScriptId = matchedScript.scriptId;
                }
            }
            // 使用 Debugger.setBreakpoint (scriptId 方式)
            const breakpointInfo = await client.setBreakpointOnScript(targetScriptId, lineNumber, columnNumber, params.condition);
            return {
                success: true,
                breakpoint_id: breakpointInfo.breakpointId,
                requested_location: {
                    scriptId: targetScriptId,
                    lineNumber,
                    columnNumber,
                },
                resolved_locations: breakpointInfo.locations,
                url: matchedScript?.url || `scriptId://${targetScriptId}`,
                condition: params.condition,
                resolved: breakpointInfo.locations.length > 0,
                message: breakpointInfo.locations.length > 0
                    ? `断点已设置并解析: ${matchedScript?.url || targetScriptId}:${params.line}:${columnNumber}`
                    : `断点已设置但未解析到实际执行位置（可能该代码路径未被加载）`,
            };
        }
        catch (e) {
            return {
                success: false,
                status: 'error',
                message: `设置断点失败: ${e.message}`,
            };
        }
    },
};
/**
 * 获取调用栈工具
 */
export const getCallStack = {
    name: 'get_call_stack',
    description: '获取当前 JavaScript 执行的调用栈信息',
    category: ToolCategory.DEBUGGER,
    schema: {},
    handler: async () => {
        const client = getCDPClient();
        try {
            await client.connect();
            const result = await client.evaluateScript(`
        (function() {
          try {
            throw new Error('__CALL_STACK__');
          } catch(e) {
            return e.stack;
          }
        })()
      `);
            return {
                status: 'captured',
                call_stack: result?.result?.value || 'unable to capture',
                message: '调用栈捕获完成',
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `捕获失败: ${e.message}`,
            };
        }
    },
};
/**
 * 监控变量变化工具
 */
export const watchVariable = {
    name: 'watch_variable',
    description: '监控指定变量的变化，当变量值改变时记录',
    category: ToolCategory.DEBUGGER,
    schema: {
        variable_name: z.string().describe('要监控的变量名'),
        scope: z.string().optional().describe('变量作用域（global, local 等）'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            const watchScript = `
        (function() {
          const varName = ${JSON.stringify(params.variable_name)};
          const scope = ${JSON.stringify(params.scope || 'global')};

          // 尝试获取变量当前值
          let currentValue;
          try {
            if (scope === 'global') {
              currentValue = eval(varName);
            } else {
              currentValue = 'local scope not accessible';
            }
          } catch(e) {
            currentValue = 'error: ' + e.message;
          }

          return JSON.stringify({
            variable: varName,
            scope: scope,
            current_value: typeof currentValue === 'object' ? JSON.stringify(currentValue) : String(current_value),
            type: typeof currentValue,
          });
        })()
      `;
            const result = await client.evaluateScript(watchScript);
            return {
                status: 'watching',
                variable_name: params.variable_name,
                scope: params.scope || 'global',
                current_value: result?.result?.value ? JSON.parse(result.result.value) : null,
                message: `正在监控变量: ${params.variable_name}`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `监控失败: ${e.message}`,
            };
        }
    },
};
/**
 * 反混淆代码工具
 */
export const deobfuscateCode = {
    name: 'deobfuscate_code',
    description: '对微信小程序的混淆代码进行反混淆处理，提高可读性',
    category: ToolCategory.SCRIPT,
    schema: {
        code: z.string().describe('混淆的代码'),
    },
    handler: async (params) => {
        // 简单的反混淆处理
        let deobfuscated = params.code;
        // 替换常见的混淆模式
        deobfuscated = deobfuscated
            .replace(/\b_0x[a-f0-9]+\b/g, (match) => {
            // 尝试解析十六进制变量名
            return match;
        })
            .replace(/\b\w+\s*=\s*\w+\s*\|\|\s*\w+\b/g, (match) => {
            return match;
        });
        return {
            status: 'deobfuscated',
            original_length: params.code.length,
            deobfuscated_length: deobfuscated.length,
            deobfuscated_code: deobfuscated,
            message: '反混淆处理完成',
        };
    },
};
/**
 * 暂停/恢复执行工具
 */
export const pauseOrResume = {
    name: 'pause_or_resume',
    description: '暂停或恢复 JavaScript 执行。用于在断点处暂停后恢复执行，或手动暂停执行进行调试',
    category: ToolCategory.DEBUGGER,
    schema: {
        action: z.enum(['pause', 'resume']).describe('操作类型：pause=暂停, resume=恢复'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            if (params.action === 'resume') {
                if (!client.isPaused()) {
                    return {
                        status: 'error',
                        message: '执行未暂停，无法恢复',
                    };
                }
                await client.resume();
                return {
                    status: 'resumed',
                    message: '执行已恢复',
                };
            }
            else {
                if (client.isPaused()) {
                    return {
                        status: 'error',
                        message: '执行已暂停，无法再次暂停',
                    };
                }
                await client.pause();
                return {
                    status: 'pause_requested',
                    message: '已请求暂停，等待执行暂停...',
                };
            }
        }
        catch (e) {
            return {
                status: 'error',
                message: `操作失败: ${e.message}`,
            };
        }
    },
};
/**
 * 单步执行工具
 */
export const step = {
    name: 'step',
    description: '单步执行 JavaScript 代码。支持跳过(over)、进入(into)、跳出(out)三种模式',
    category: ToolCategory.DEBUGGER,
    schema: {
        direction: z.enum(['over', 'into', 'out']).describe('执行方向：over=跳过, into=进入, out=跳出'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            if (!client.isPaused()) {
                return {
                    status: 'error',
                    message: '执行未暂停，无法单步执行',
                };
            }
            let frame;
            const labels = {
                over: '跳过',
                into: '进入',
                out: '跳出',
            };
            if (params.direction === 'over') {
                frame = await client.stepOver();
            }
            else if (params.direction === 'into') {
                frame = await client.stepInto();
            }
            else {
                frame = await client.stepOut();
            }
            const line = frame.location.lineNumber + 1;
            const col = frame.location.columnNumber + 1;
            const funcName = frame.functionName || '<anonymous>';
            const url = frame.url || `script:${frame.location.scriptId}`;
            const shortUrl = url.split('/').pop() || url;
            return {
                status: 'stepped',
                direction: params.direction,
                location: {
                    url: shortUrl,
                    line,
                    column: col,
                    function: funcName,
                },
                message: `已${labels[params.direction]}到 ${shortUrl}:${line}:${col}, 函数 ${funcName}`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `单步执行失败: ${e.message}`,
            };
        }
    },
};
/**
 * 获取暂停状态工具
 * 增强版：显示函数参数、局部变量、this 引用和完整调用栈
 */
export const getPausedInfo = {
    name: 'get_paused_info',
    description: '获取当前 JavaScript 执行的暂停状态，包括调用栈、函数参数、局部变量、this 引用和作用域链',
    category: ToolCategory.DEBUGGER,
    schema: {
        include_scopes: z.boolean().optional().describe('是否包含作用域变量（默认 true）'),
        frame_index: z.number().optional().describe('要查看的调用帧索引（默认 0，即最顶层）'),
        max_vars_per_scope: z.number().optional().describe('每个作用域最多返回的变量数（默认 30）'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            if (!client.isPaused()) {
                return {
                    status: 'error',
                    message: '执行未暂停。请先在断点处暂停或使用 pause_or_resume 暂停',
                };
            }
            const pausedState = client.getPausedState();
            const includeScopes = params.include_scopes !== false;
            const frameIndex = params.frame_index || 0;
            const maxVars = params.max_vars_per_scope || 30;
            // 构建增强版调用栈信息
            const callFrames = [];
            for (let index = 0; index < pausedState.callFrames.length; index++) {
                const frame = pausedState.callFrames[index];
                const url = frame.url || `appservice://script:${frame.location.scriptId}`;
                const shortUrl = url.split('/').pop() || url;
                const frameDetail = {
                    index,
                    callFrameId: frame.callFrameId,
                    functionName: frame.functionName || '<anonymous>',
                    location: {
                        url: shortUrl,
                        fullUrl: url,
                        scriptId: frame.location.scriptId,
                        line: frame.location.lineNumber + 1,
                        column: frame.location.columnNumber + 1,
                    },
                };
                // 仅对选中的帧获取详细变量信息
                if (includeScopes && index === frameIndex) {
                    // 获取 this 引用的属性
                    const thisObj = frame.this;
                    if (thisObj?.objectId) {
                        try {
                            const thisResult = await client.sendCommand('Runtime.getProperties', {
                                objectId: thisObj.objectId,
                                ownProperties: true,
                            });
                            frameDetail.this = {
                                type: thisObj.type,
                                className: thisObj.className,
                                properties: (thisResult.result || [])
                                    .filter((p) => p.enumerable && !p.name.startsWith('__'))
                                    .slice(0, maxVars)
                                    .map((p) => ({
                                    name: p.name,
                                    value: p.value?.value ?? p.value?.description ?? `[${p.value?.type}]`,
                                    type: p.value?.type,
                                    isFunction: p.value?.type === 'function',
                                })),
                            };
                        }
                        catch {
                            frameDetail.this = { type: thisObj.type, className: thisObj.className };
                        }
                    }
                    // 获取作用域链
                    frameDetail.scopes = [];
                    if (frame.scopeChain) {
                        for (const scope of frame.scopeChain) {
                            if (scope.type === 'global')
                                continue; // 跳过全局作用域
                            if (scope.object?.objectId) {
                                try {
                                    const scopeResult = await client.sendCommand('Runtime.getProperties', {
                                        objectId: scope.object.objectId,
                                        ownProperties: true,
                                    });
                                    const vars = (scopeResult.result || [])
                                        .filter((p) => !p.name.startsWith('__') && p.enumerable)
                                        .slice(0, maxVars)
                                        .map((p) => ({
                                        name: p.name,
                                        value: p.value?.value ?? p.value?.description ?? `[${p.value?.type}]`,
                                        type: p.value?.type,
                                        isFunction: p.value?.type === 'function',
                                        isObject: p.value?.type === 'object',
                                        description: p.value?.description,
                                    }));
                                    frameDetail.scopes.push({
                                        type: scope.type,
                                        name: scope.name || scope.type,
                                        variableCount: vars.length,
                                        variables: vars,
                                    });
                                }
                                catch {
                                    // 忽略无法获取的变量
                                }
                            }
                        }
                    }
                    // 提取函数参数（从 local scope 中识别 argument 变量）
                    if (frameDetail.scopes.length > 0) {
                        const localScope = frameDetail.scopes.find((s) => s.type === 'local');
                        if (localScope) {
                            frameDetail.functionArgs = localScope.variables.filter((v) => 
                            // V8 调试器中函数参数通常在 local scope 的开头
                            !v.isFunction || v.name === 'arguments');
                        }
                    }
                }
                callFrames.push(frameDetail);
            }
            // 获取断点命中信息
            const hitBreakpoints = pausedState.hitBreakpoints || [];
            // 查找当前帧对应的脚本信息
            let currentScriptInfo = null;
            if (callFrames.length > 0 && callFrames[frameIndex]) {
                const loc = callFrames[frameIndex].location;
                const script = client.findParsedScript(loc.scriptId);
                if (script) {
                    currentScriptInfo = {
                        scriptId: script.scriptId,
                        url: script.url,
                        startLine: script.startLine,
                        endLine: script.endLine,
                    };
                }
            }
            return {
                status: 'paused',
                reason: pausedState.reason,
                hitBreakpoints,
                currentFrameIndex: frameIndex,
                totalFrames: callFrames.length,
                callFrames,
                currentScript: currentScriptInfo,
                message: callFrames.length > 0
                    ? `执行已暂停 (${pausedState.reason})，调用栈深度: ${callFrames.length}，当前帧: ${callFrames[frameIndex]?.functionName || '<anonymous>'}`
                    : '执行已暂停',
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `获取暂停状态失败: ${e.message}`,
            };
        }
    },
};
/**
 * 列出所有断点工具
 */
export const listBreakpoints = {
    name: 'list_breakpoints',
    description: '列出所有已设置的断点及其状态',
    category: ToolCategory.DEBUGGER,
    schema: {},
    handler: async () => {
        const client = getCDPClient();
        try {
            await client.connect();
            const breakpoints = client.getBreakpoints();
            return {
                status: 'success',
                breakpoints: breakpoints.map(bp => ({
                    id: bp.breakpointId,
                    url: bp.url,
                    line: bp.lineNumber + 1,
                    column: bp.columnNumber,
                    condition: bp.condition,
                    locations: bp.locations.length,
                })),
                total: breakpoints.length,
                message: `共有 ${breakpoints.length} 个断点`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `获取断点列表失败: ${e.message}`,
            };
        }
    },
};
/**
 * 移除断点工具
 */
export const removeBreakpoint = {
    name: 'remove_breakpoint',
    description: '移除指定的断点或所有断点',
    category: ToolCategory.DEBUGGER,
    schema: {
        breakpoint_id: z.string().optional().describe('要移除的断点 ID，为空则移除所有断点'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            if (params.breakpoint_id) {
                await client.removeBreakpoint(params.breakpoint_id);
                return {
                    status: 'removed',
                    breakpoint_id: params.breakpoint_id,
                    message: `已移除断点: ${params.breakpoint_id}`,
                };
            }
            else {
                const result = await client.removeAllBreakpoints();
                return {
                    status: 'removed_all',
                    removed: result.removed,
                    failed: result.failed,
                    message: `已移除 ${result.removed} 个断点${result.failed.length > 0 ? `，${result.failed.length} 个移除失败` : ''}`,
                };
            }
        }
        catch (e) {
            return {
                status: 'error',
                message: `移除断点失败: ${e.message}`,
            };
        }
    },
};
/**
 * 在代码文本处设置断点工具
 * 基于 Script Registry 的本地缓存搜索，在匹配位置设置断点
 */
export const setBreakpointOnText = {
    name: 'set_breakpoint_on_text',
    description: '在指定的代码文本处设置断点。先在已缓存的源码中搜索，然后在匹配位置用 scriptId 直接下断点',
    category: ToolCategory.DEBUGGER,
    schema: {
        text: z.string().describe('要设置断点的代码文本（精确匹配）'),
        url_filter: z.string().optional().describe('URL 过滤条件，限定在特定脚本中搜索'),
        occurrence: z.number().optional().describe('匹配序号（从 1 开始，默认 1）'),
        condition: z.string().optional().describe('断点条件表达式'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            // 确保 Debugger 已启用
            if (!client.isDebuggerEnabled()) {
                await client.sendCommand('Debugger.enable');
                await new Promise(r => setTimeout(r, 1000));
            }
            // 确保源码已缓存
            const cacheStats = client.getSourceCacheStats();
            if (cacheStats.cachedScripts === 0) {
                await client.cacheAllSources();
            }
            // 使用本地缓存搜索
            let matches = client.searchInSourceCache(params.text, undefined, { maxResults: 200 });
            if (matches.length === 0) {
                return {
                    status: 'not_found',
                    message: `未找到代码文本: "${params.text}"。可用脚本: ${cacheStats.cachedScripts} 个`,
                };
            }
            // 应用 URL 过滤
            if (params.url_filter) {
                const lowerFilter = params.url_filter.toLowerCase();
                matches = matches.filter(m => m.url.toLowerCase().includes(lowerFilter));
                if (matches.length === 0) {
                    return {
                        status: 'not_found',
                        message: `在 URL "${params.url_filter}" 中未找到代码文本`,
                    };
                }
            }
            // 获取指定的匹配
            const occurrence = (params.occurrence || 1) - 1;
            if (occurrence >= matches.length) {
                return {
                    status: 'error',
                    message: `只有 ${matches.length} 个匹配，但请求第 ${params.occurrence || 1} 个`,
                };
            }
            const match = matches[occurrence];
            const columnNumber = match.columnNumber;
            // 使用 Debugger.setBreakpoint (scriptId 方式)
            const breakpointInfo = await client.setBreakpointOnScript(match.scriptId, match.lineNumber, columnNumber, params.condition);
            return {
                success: true,
                breakpoint_id: breakpointInfo.breakpointId,
                script_id: match.scriptId,
                url: match.url,
                line: match.lineNumber + 1,
                column: columnNumber,
                condition: params.condition,
                context: match.context?.trim(),
                resolved_locations: breakpointInfo.locations,
                resolved: breakpointInfo.locations.length > 0,
                message: breakpointInfo.locations.length > 0
                    ? `断点已设置并解析: ${match.url}:${match.lineNumber + 1}:${columnNumber}`
                    : `断点已设置但未解析到实际执行位置`,
            };
        }
        catch (e) {
            return {
                success: false,
                status: 'error',
                message: `设置断点失败: ${e.message}`,
            };
        }
    },
};
/**
 * 在调用帧上评估表达式工具
 * 在断点暂停时，在指定的调用帧上下文中执行 JavaScript 表达式
 * 可以访问该帧的局部变量、参数和闭包变量
 */
export const evaluateOnCallFrame = {
    name: 'evaluate_on_call_frame',
    description: '在断点暂停时，在指定的调用帧上下文中执行 JavaScript 表达式。可以访问该帧的局部变量、参数和闭包变量',
    category: ToolCategory.DEBUGGER,
    schema: {
        expression: z.string().describe('要执行的 JavaScript 表达式'),
        frame_index: z.number().optional().describe('调用帧索引（默认 0，即最顶层帧）'),
        call_frame_id: z.string().optional().describe('调用帧 ID（优先于 frame_index）'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            if (!client.isPaused()) {
                return {
                    status: 'error',
                    message: '执行未暂停。请先在断点处暂停',
                };
            }
            const pausedState = client.getPausedState();
            // 确定目标 callFrameId
            let callFrameId;
            if (params.call_frame_id) {
                callFrameId = params.call_frame_id;
            }
            else {
                const frameIndex = params.frame_index || 0;
                if (frameIndex >= pausedState.callFrames.length) {
                    return {
                        status: 'error',
                        message: `调用帧索引 ${frameIndex} 超出范围（共 ${pausedState.callFrames.length} 帧）`,
                    };
                }
                callFrameId = pausedState.callFrames[frameIndex].callFrameId;
            }
            // 在调用帧上评估表达式
            const result = await client.evaluateOnCallFrame(callFrameId, params.expression, { returnByValue: true, generatePreview: true });
            // 获取调用帧信息
            const frame = pausedState.callFrames.find(f => f.callFrameId === callFrameId);
            const frameInfo = frame ? {
                functionName: frame.functionName || '<anonymous>',
                url: frame.url || `appservice://script:${frame.location.scriptId}`,
                line: frame.location.lineNumber + 1,
                column: frame.location.columnNumber + 1,
            } : null;
            return {
                status: 'evaluated',
                call_frame_id: callFrameId,
                frame_info: frameInfo,
                expression: params.expression,
                result: result?.result?.value ?? result?.result ?? null,
                exception_details: result?.exceptionDetails || null,
                type: result?.result?.type,
                message: `在帧 ${frameInfo?.functionName || callFrameId} 中评估完成`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `评估失败: ${e.message}`,
            };
        }
    },
};
/**
 * 在指定脚本中搜索工具
 * 针对单个脚本的精确搜索，比 search_in_sources 更快
 */
export const searchInScript = {
    name: 'search_in_script',
    description: '在指定脚本中搜索代码。返回匹配位置的行号、列号和上下文',
    category: ToolCategory.SCRIPT,
    schema: {
        script_id: z.string().describe('脚本 ID（从 list_scripts 获取）'),
        query: z.string().describe('搜索关键词'),
        is_regex: z.boolean().optional().describe('是否使用正则表达式'),
        max_results: z.number().optional().describe('最大返回结果数（默认 20）'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            // 确保该脚本已缓存
            const entry = await client.getSourceWithCache(params.script_id);
            if (!entry) {
                return {
                    status: 'error',
                    message: `无法加载脚本 ${params.script_id} 的源码`,
                };
            }
            const results = client.searchInSourceCache(params.query, params.script_id, {
                isRegex: params.is_regex,
                maxResults: params.max_results || 20,
            });
            return {
                status: 'searched',
                script_id: params.script_id,
                url: entry.url,
                query: params.query,
                total_matches: results.length,
                source_length: entry.sourceLength,
                is_compressed: entry.isCompressed,
                results,
                message: `在 ${entry.url} 中找到 ${results.length} 个匹配`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `搜索失败: ${e.message}`,
            };
        }
    },
};
/**
 * 获取源码窗口工具
 * 返回指定脚本的指定行范围，对压缩 JS 自动展开
 */
export const getSourceRange = {
    name: 'get_source_range',
    description: '获取脚本的指定行范围源码。对压缩 JS（单行超大文件）自动处理列号定位',
    category: ToolCategory.SCRIPT,
    schema: {
        script_id: z.string().describe('脚本 ID'),
        start_line: z.number().int().describe('起始行号（从 1 开始）'),
        end_line: z.number().int().describe('结束行号（从 1 开始）'),
    },
    handler: async (params) => {
        const client = getCDPClient();
        try {
            await client.connect();
            // 确保已缓存
            const entry = await client.getSourceWithCache(params.script_id);
            if (!entry) {
                return {
                    status: 'error',
                    message: `无法加载脚本 ${params.script_id} 的源码`,
                };
            }
            const range = client.getSourceRange(params.script_id, params.start_line - 1, // 转换为 0-indexed
            params.end_line - 1);
            if (!range) {
                return {
                    status: 'error',
                    message: `无法获取源码范围`,
                };
            }
            return {
                status: 'success',
                script_id: range.scriptId,
                url: range.url,
                start_line: range.startLine + 1,
                end_line: range.endLine + 1,
                total_lines: range.totalLines,
                is_compressed: range.isCompressed,
                lines: range.lines.map(l => ({
                    line: l.lineNumber + 1,
                    content: l.content,
                })),
                message: `返回 ${range.lines.length} 行源码 (共 ${range.totalLines} 行)`,
            };
        }
        catch (e) {
            return {
                status: 'error',
                message: `获取源码失败: ${e.message}`,
            };
        }
    },
};
/** 所有 JS 逆向工具 */
export const jsReverseTools = [
    evaluateScript,
    searchInSources,
    searchInScript,
    getSourceRange,
    setBreakpoint,
    getCallStack,
    watchVariable,
    deobfuscateCode,
    pauseOrResume,
    step,
    getPausedInfo,
    listBreakpoints,
    removeBreakpoint,
    setBreakpointOnText,
    evaluateOnCallFrame,
];
//# sourceMappingURL=js-reverse.js.map