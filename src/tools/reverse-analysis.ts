import {z} from 'zod';
import {getCDPClient} from '../cdp-client.js';
import {infoLogger} from '../logger.js';
import {ToolCategory, type ToolDefinition} from './wechat-miniprogram.js';

export const reverseAnalyze: ToolDefinition = {
  name: 'reverse_analyze',
  description: '高级逆向分析：根据查询词（接口名、函数名、URL、关键词等）自动搜索、索引、排序和关联，返回少量高价值候选函数。MCP 自己完成搜索和筛选，Agent 负责理解候选结果',
  category: ToolCategory.DEBUGGER,
  schema: {
    query: z.string().describe('搜索查询（如 "xxx接口"、"用户信息"、"request"、"签名"、"加密"、某个 API 路径等）'),
  },
  handler: async (params: {query: string}) => {
    const client = getCDPClient();
    try {
      await client.connect();

      if (!client.isDebuggerEnabled()) {
        await client.enableDebuggerAndWaitScripts(3000);
      }

      const cacheStats = client.getSourceCacheStats();
      if (cacheStats.cachedScripts === 0) {
        await client.cacheAllSources();
      }

      if (!client.isIndexBuilt()) {
        client.buildIndex();
      }

      const candidates = client.reverseAnalyze(params.query);

      const indexStats = client.getIndexStats();

      return {
        status: 'analyzed',
        query: params.query,
        candidates_count: candidates.length,
        candidates: candidates.map(c => ({
          function: c.function,
          script_id: c.scriptId,
          url: c.url,
          line: c.line + 1,
          column: c.column,
          callers: c.callers.slice(0, 5),
          callees: c.callees.slice(0, 10),
          related_strings: c.relatedStrings.slice(0, 5),
          related_urls: c.relatedUrls.slice(0, 5),
          reason: c.reason,
        })),
        index_stats: indexStats,
        message: candidates.length > 0
          ? `找到 ${candidates.length} 个候选函数。建议: 1) 选择最相关的候选 2) 使用 set_breakpoint_on_text 设置断点 3) 使用 trigger_target 触发执行 4) 使用 get_paused_info 查看参数`
          : `未找到匹配 "${params.query}" 的候选。尝试: 1) 使用 search_in_sources 搜索更广泛的关键词 2) 检查是否已连接并缓存脚本`,
      };
    } catch (e: any) {
      return {
        status: 'error',
        message: `分析失败: ${e.message}`,
      };
    }
  },
};

export const traceExecution: ToolDefinition = {
  name: 'trace_execution',
  description: '自动执行追踪：设置断点后自动单步跟踪函数调用链，形成 Page→getData→request→encrypt 等完整调用路径。不需要 Agent 每一步手动调用底层 CDP',
  category: ToolCategory.DEBUGGER,
  schema: {
    script_url: z.string().describe('脚本 scriptId 或 URL'),
    line: z.number().int().describe('断点行号（从 1 开始）'),
    column: z.number().int().optional().describe('断点列号（从 0 开始）'),
    max_steps: z.number().optional().describe('最大追踪步数（默认 50）'),
    direction: z.enum(['into', 'over']).optional().describe('追踪方向：into=进入每个函数（默认），over=跳过函数调用'),
  },
  handler: async (params: {
    script_url: string;
    line: number;
    column?: number;
    max_steps?: number;
    direction?: 'into' | 'over';
  }) => {
    const client = getCDPClient();
    try {
      await client.connect();

      if (!client.isDebuggerEnabled()) {
        await client.enableDebuggerAndWaitScripts(3000);
      }

      const lineNumber = params.line - 1;
      const columnNumber = params.column || 0;
      const maxSteps = params.max_steps || 50;
      const direction = params.direction || 'into';

      let targetScriptId = params.script_url;
      const scripts = client.getParsedScripts();
      const matched = scripts.find(s => s.scriptId === params.script_url || (s.url && s.url.includes(params.script_url)));
      if (matched) {
        targetScriptId = matched.scriptId;
      }

      const bpInfo = await client.setBreakpointOnScript(targetScriptId, lineNumber, columnNumber);
      if (bpInfo.locations.length === 0) {
        return {
          status: 'error',
          message: '断点未解析到实际执行位置',
        };
      }

      infoLogger('[trace_execution] 断点已设置，等待执行暂停...');

      if (!client.isPaused()) {
        return {
          status: 'breakpoint_set',
          breakpoint_id: bpInfo.breakpointId,
          message: `断点已设置，等待执行暂停。请触发目标操作（如页面跳转、按钮点击等），然后再次调用 trace_execution 继续追踪`,
        };
      }

      const traceLog: Array<{
        step: number;
        functionName: string;
        scriptId: string;
        url: string;
        line: number;
        column: number;
      }> = [];

      let step = 0;
      while (step < maxSteps && client.isPaused()) {
        const state = client.getPausedState();
        const topFrame = state.callFrames[0];
        if (!topFrame) break;

        traceLog.push({
          step: step + 1,
          functionName: topFrame.functionName || '<anonymous>',
          scriptId: topFrame.location.scriptId,
          url: topFrame.url || `script:${topFrame.location.scriptId}`,
          line: topFrame.location.lineNumber + 1,
          column: topFrame.location.columnNumber + 1,
        });

        step++;

        try {
          if (direction === 'into') {
            await client.stepInto();
          } else {
            await client.stepOver();
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch {
          break;
        }
      }

      if (client.isPaused()) {
        await client.resume();
      }

      return {
        status: 'traced',
        total_steps: traceLog.length,
        trace: traceLog,
        message: `追踪完成: ${traceLog.length} 步`,
      };
    } catch (e: any) {
      return {
        status: 'error',
        message: `追踪失败: ${e.message}`,
      };
    }
  },
};

export const findFunction: ToolDefinition = {
  name: 'find_function',
  description: '查找函数定义位置，返回函数名、脚本、行列号等信息',
  category: ToolCategory.SCRIPT,
  schema: {
    name: z.string().describe('函数名'),
  },
  handler: async (params: {name: string}) => {
    const client = getCDPClient();
    try {
      await client.connect();

      if (!client.isIndexBuilt()) {
        const cacheStats = client.getSourceCacheStats();
        if (cacheStats.cachedScripts === 0) {
          await client.cacheAllSources();
        }
        client.buildIndex();
      }

      const functions = client.findFunction(params.name);

      return {
        status: 'found',
        function_name: params.name,
        occurrences: functions.length,
        locations: functions.map(f => ({
          script_id: f.scriptId,
          url: f.url,
          line: f.startLine + 1,
          column: f.startColumn,
          type: f.type,
          is_lifecycle: f.isLifecycle,
          is_event_handler: f.isEventHandler,
          is_network_related: f.isNetworkRelated,
        })),
        message: `找到 ${functions.length} 个 "${params.name}" 定义`,
      };
    } catch (e: any) {
      return {
        status: 'error',
        message: `查找失败: ${e.message}`,
      };
    }
  },
};

export const findCallers: ToolDefinition = {
  name: 'find_callers',
  description: '查找调用指定函数的所有位置（调用者）',
  category: ToolCategory.SCRIPT,
  schema: {
    function_name: z.string().describe('函数名'),
    script_id: z.string().optional().describe('限定在特定脚本中搜索'),
  },
  handler: async (params: {function_name: string; script_id?: string}) => {
    const client = getCDPClient();
    try {
      await client.connect();

      if (!client.isIndexBuilt()) {
        const cacheStats = client.getSourceCacheStats();
        if (cacheStats.cachedScripts === 0) {
          await client.cacheAllSources();
        }
        client.buildIndex();
      }

      const callers = client.findCallers(params.function_name, params.script_id);

      return {
        status: 'found',
        function_name: params.function_name,
        callers_count: callers.length,
        callers: callers.slice(0, 30),
        message: `找到 ${callers.length} 个调用 "${params.function_name}" 的位置`,
      };
    } catch (e: any) {
      return {
        status: 'error',
        message: `查找失败: ${e.message}`,
      };
    }
  },
};

export const findCallees: ToolDefinition = {
  name: 'find_callees',
  description: '查找函数体内调用的其他函数（被调用者）',
  category: ToolCategory.SCRIPT,
  schema: {
    script_id: z.string().describe('脚本 ID'),
    start_line: z.number().int().describe('函数起始行号（从 1 开始）'),
    end_line: z.number().int().describe('函数结束行号（从 1 开始）'),
  },
  handler: async (params: {script_id: string; start_line: number; end_line: number}) => {
    const client = getCDPClient();
    try {
      await client.connect();

      if (!client.isIndexBuilt()) {
        const cacheStats = client.getSourceCacheStats();
        if (cacheStats.cachedScripts === 0) {
          await client.cacheAllSources();
        }
        client.buildIndex();
      }

      const entry = await client.getSourceWithCache(params.script_id);
      if (!entry) {
        return {
          status: 'error',
          message: `无法获取脚本 ${params.script_id} 的源码`,
        };
      }

      const lines = entry.source.split('\n');
      let startOffset = 0;
      for (let i = 0; i < Math.min(params.start_line - 1, lines.length); i++) {
        startOffset += lines[i].length + 1;
      }
      let endOffset = startOffset;
      for (let i = params.start_line - 1; i < Math.min(params.end_line, lines.length); i++) {
        endOffset += lines[i].length + 1;
      }

      const callees = client.findCallees(params.script_id, startOffset, endOffset);

      return {
        status: 'found',
        script_id: params.script_id,
        range: `${params.start_line}-${params.end_line}`,
        callees_count: callees.length,
        callees: callees.slice(0, 30),
        message: `找到 ${callees.length} 个被调用的函数`,
      };
    } catch (e: any) {
      return {
        status: 'error',
        message: `查找失败: ${e.message}`,
      };
    }
  },
};

export const reverseAnalysisTools = [
  reverseAnalyze,
  traceExecution,
  findFunction,
  findCallers,
  findCallees,
];
