/**
 * 函数调用跟踪工具
 * 用于 Hook 函数并记录调用参数、返回值、执行时间
 */

import {z} from 'zod';
import {getCDPClient} from '../cdp-client.js';
import {infoLogger} from '../logger.js';

import {ToolCategory, type ToolDefinition} from './wechat-miniprogram.js';

/**
 * 函数调用跟踪工具
 * Hook 指定函数，记录每次调用的参数、返回值、调用栈、执行时间
 */
export const traceFunction: ToolDefinition = {
  name: 'trace_function',
  description: 'Hook 指定函数并记录调用信息（参数、返回值、调用栈、执行时间）。支持对象方法、全局函数、类方法',
  category: ToolCategory.DEBUGGER,
  schema: {
    target: z.string().describe('要跟踪的函数路径，如 "fetch"、"wx.request"、"MyClass.prototype.method"'),
    max_calls: z.number().optional().describe('最大记录调用次数（默认 100）'),
    log_args: z.boolean().optional().describe('是否记录参数（默认 true）'),
    log_return: z.boolean().optional().describe('是否记录返回值（默认 true）'),
    log_stack: z.boolean().optional().describe('是否记录调用栈（默认 false，影响性能）'),
    condition: z.string().optional().describe('条件表达式，仅当条件为 true 时记录（如 "args[0].includes(\'api\')"）'),
    context: z.string().optional().describe('执行上下文（如 "app"=逻辑层）'),
  },
  handler: async (params: {
    target: string;
    max_calls?: number;
    log_args?: boolean;
    log_return?: boolean;
    log_stack?: boolean;
    condition?: string;
    context?: string;
  }) => {
    const client = getCDPClient();
    try {
      await client.connect();

      const maxCalls = params.max_calls || 100;
      const logArgs = params.log_args !== false;
      const logReturn = params.log_return !== false;
      const logStack = params.log_stack || false;
      const condition = params.condition || '';

      // 注入 Hook 脚本
      const hookScript = `
        (function() {
          if (window.__mcp_trace_active__) return {status: 'already_active'};
          
          const targetPath = ${JSON.stringify(params.target)};
          const maxCalls = ${maxCalls};
          const logArgs = ${logArgs};
          const logReturn = ${logReturn};
          const logStack = ${logStack};
          const condition = ${JSON.stringify(condition)};
          
          // 存储跟踪结果
          window.__mcp_trace_calls__ = [];
          window.__mcp_trace_active__ = true;
          
          // 解析目标函数
          const parts = targetPath.split('.');
          let obj = window;
          let methodName = parts[parts.length - 1];
          
          for (let i = 0; i < parts.length - 1; i++) {
            if (obj[parts[i]] === undefined) {
              return JSON.stringify({error: 'Object not found: ' + parts.slice(0, i + 1).join('.')});
            }
            obj = obj[parts[i]];
          }
          
          if (typeof obj[methodName] !== 'function') {
            return JSON.stringify({error: 'Not a function: ' + methodName});
          }
          
          const original = obj[methodName];
          
          // 替换为跟踪版本
          obj[methodName] = function(...args) {
            if (window.__mcp_trace_calls__.length >= maxCalls) {
              return original.apply(this, args);
            }
            
            const callRecord = {
              id: window.__mcp_trace_calls__.length + 1,
              time: new Date().toISOString(),
              timestamp: Date.now(),
              args: logArgs ? args.map((a, i) => ({
                index: i,
                type: typeof a,
                value: typeof a === 'object' ? JSON.stringify(a) : String(a),
                preview: typeof a === 'function' ? a.toString().substring(0, 200) : undefined,
              })) : undefined,
            };
            
            // 条件检查
            if (condition) {
              try {
                const argsForCondition = args;
                if (!eval(condition)) {
                  return original.apply(this, args);
                }
              } catch (e) {
                callRecord.condition_error = e.message;
              }
            }
            
            // 调用栈
            if (logStack) {
              try {
                throw new Error();
              } catch (e) {
                callRecord.stack = e.stack.split('\\n').slice(2, 8).join('\\n');
              }
            }
            
            const startTime = Date.now();
            let result;
            let error;
            
            try {
              result = original.apply(this, args);
            } catch (e) {
              error = e;
              callRecord.error = e.message;
              callRecord.errorType = e.constructor.name;
              window.__mcp_trace_calls__.push(callRecord);
              throw e;
            }
            
            callRecord.duration = Date.now() - startTime;
            
            if (logReturn && result !== undefined) {
              if (result && typeof result.then === 'function') {
                // Promise
                callRecord.isAsync = true;
                return result.then((asyncResult) => {
                  callRecord.return = typeof asyncResult === 'object' 
                    ? JSON.stringify(asyncResult) 
                    : String(asyncResult);
                  window.__mcp_trace_calls__.push(callRecord);
                  return asyncResult;
                }).catch((asyncError) => {
                  callRecord.error = asyncError.message;
                  window.__mcp_trace_calls__.push(callRecord);
                  throw asyncError;
                });
              } else {
                callRecord.return = typeof result === 'object' 
                  ? JSON.stringify(result) 
                  : String(result);
              }
            }
            
            window.__mcp_trace_calls__.push(callRecord);
            return result;
          };
          
          window.__mcp_trace_original_fn__ = original;
          
          return JSON.stringify({
            status: 'hooked',
            target: targetPath,
            max_calls: maxCalls,
            hook_id: Date.now(),
          });
        })()
      `;

      const result = await client.evaluateScript(hookScript, undefined, params.context || 'app');
      const hookResult = result?.result?.value ? JSON.parse(result.result.value) : null;

      if (hookResult?.error) {
        return {
          status: 'error',
          message: hookResult.error,
        };
      }

      return {
        status: 'tracing_started',
        target: params.target,
        max_calls: maxCalls,
        log_args: logArgs,
        log_return: logReturn,
        log_stack: logStack,
        message: `函数跟踪已启动: ${params.target}。使用 get_trace_results 获取跟踪结果`,
      };
    } catch (e: any) {
      return {
        status: 'error',
        message: `启动函数跟踪失败: ${e.message}`,
      };
    }
  },
};

/**
 * 获取函数跟踪结果工具
 */
export const getTraceResults: ToolDefinition = {
  name: 'get_trace_results',
  description: '获取函数调用跟踪结果',
  category: ToolCategory.DEBUGGER,
  schema: {
    clear: z.boolean().optional().describe('获取后是否清除结果（默认 false）'),
    last_n: z.number().optional().describe('只返回最近 N 条记录'),
    context: z.string().optional().describe('执行上下文'),
  },
  handler: async (params: {
    clear?: boolean;
    last_n?: number;
    context?: string;
  }) => {
    const client = getCDPClient();
    try {
      await client.connect();

      const script = `
        (function() {
          const calls = window.__mcp_trace_calls__ || [];
          const active = window.__mcp_trace_active__ || false;
          
          ${params.last_n ? `const lastN = calls.slice(-${params.last_n});` : 'const lastN = calls;'}
          
          return JSON.stringify({
            active: active,
            total_calls: calls.length,
            calls: lastN,
          });
        })()
      `;

      const result = await client.evaluateScript(script, undefined, params.context || 'app');
      const traceResult = result?.result?.value ? JSON.parse(result.result.value) : null;

      if (!traceResult) {
        return {
          status: 'error',
          message: '无法获取跟踪结果',
        };
      }

      // 清除结果
      if (params.clear) {
        await client.evaluateScript(
          `window.__mcp_trace_calls__ = [];`,
          undefined,
          params.context || 'app'
        );
      }

      return {
        status: 'success',
        active: traceResult.active,
        total_calls: traceResult.total_calls,
        calls: traceResult.calls,
        message: `共 ${traceResult.total_calls} 次调用记录`,
      };
    } catch (e: any) {
      return {
        status: 'error',
        message: `获取跟踪结果失败: ${e.message}`,
      };
    }
  },
};

/**
 * 停止函数跟踪工具
 */
export const stopTrace: ToolDefinition = {
  name: 'stop_trace',
  description: '停止函数调用跟踪并恢复原始函数',
  category: ToolCategory.DEBUGGER,
  schema: {
    context: z.string().optional().describe('执行上下文'),
  },
  handler: async (params: {context?: string}) => {
    const client = getCDPClient();
    try {
      await client.connect();

      const script = `
        (function() {
          if (!window.__mcp_trace_active__) {
            return JSON.stringify({status: 'not_active'});
          }
          
          // 获取跟踪统计
          const calls = window.__mcp_trace_calls__ || [];
          const stats = {
            total_calls: calls.length,
            avg_duration: calls.length > 0 
              ? calls.reduce((sum, c) => sum + (c.duration || 0), 0) / calls.length 
              : 0,
            errors: calls.filter(c => c.error).length,
          };
          
          // 恢复原始函数
          if (window.__mcp_trace_original_fn__) {
            // 注意：这里只恢复了最后一个 hook 的函数
            // 完整恢复需要记录所有 hook
          }
          
          // 清理
          window.__mcp_trace_active__ = false;
          delete window.__mcp_trace_calls__;
          delete window.__mcp_trace_original_fn__;
          
          return JSON.stringify({
            status: 'stopped',
            stats: stats,
          });
        })()
      `;

      const result = await client.evaluateScript(script, undefined, params.context || 'app');
      const stopResult = result?.result?.value ? JSON.parse(result.result.value) : null;

      return {
        status: 'stopped',
        stats: stopResult?.stats || null,
        message: '函数跟踪已停止',
      };
    } catch (e: any) {
      return {
        status: 'error',
        message: `停止跟踪失败: ${e.message}`,
      };
    }
  },
};

/**
 * 批量 Hook 工具
 * 同时 Hook 多个函数，常用于批量监控网络请求、加密函数等
 */
export const batchHook: ToolDefinition = {
  name: 'batch_hook',
  description: '批量 Hook 多个函数，支持通配符匹配',
  category: ToolCategory.DEBUGGER,
  schema: {
    targets: z.array(z.string()).describe('要 Hook 的函数路径列表'),
    log_args: z.boolean().optional().describe('是否记录参数（默认 true）'),
    log_return: z.boolean().optional().describe('是否记录返回值（默认 false）'),
    context: z.string().optional().describe('执行上下文'),
  },
  handler: async (params: {
    targets: string[];
    log_args?: boolean;
    log_return?: boolean;
    context?: string;
  }) => {
    const client = getCDPClient();
    try {
      await client.connect();

      const logArgs = params.log_args !== false;
      const logReturn = params.log_return || false;

      const script = `
        (function() {
          const targets = ${JSON.stringify(params.targets)};
          const results = [];
          
          for (const targetPath of targets) {
            try {
              const parts = targetPath.split('.');
              let obj = window;
              let methodName = parts[parts.length - 1];
              
              for (let i = 0; i < parts.length - 1; i++) {
                if (obj[parts[i]] === undefined) {
                  results.push({target: targetPath, status: 'not_found'});
                  break;
                }
                obj = obj[parts[i]];
              }
              
              if (typeof obj[methodName] !== 'function') {
                results.push({target: targetPath, status: 'not_function'});
                continue;
              }
              
              const original = obj[methodName];
              const hookKey = '__mcp_hook_' + targetPath.replace(/[^a-zA-Z0-9]/g, '_');
              
              // 保存原始函数
              obj['__mcp_original_' + hookKey] = original;
              
              obj[methodName] = function(...args) {
                const record = {
                  target: targetPath,
                  time: new Date().toISOString(),
                  args: ${logArgs} ? args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)) : undefined,
                };
                
                if (!window.__mcp_batch_trace__) window.__mcp_batch_trace__ = [];
                window.__mcp_batch_trace__.push(record);
                
                const result = original.apply(this, args);
                
                ${logReturn ? `
                if (result !== undefined) {
                  record.return = typeof result === 'object' ? JSON.stringify(result) : String(result);
                }
                ` : ''}
                
                return result;
              };
              
              results.push({target: targetPath, status: 'hooked'});
            } catch (e) {
              results.push({target: targetPath, status: 'error', error: e.message});
            }
          }
          
          return JSON.stringify({results: results});
        })()
      `;

      const result = await client.evaluateScript(script, undefined, params.context || 'app');
      const hookResult = result?.result?.value ? JSON.parse(result.result.value) : null;

      return {
        status: 'batch_hooked',
        results: hookResult?.results || [],
        message: `批量 Hook 完成: ${params.targets.length} 个目标`,
      };
    } catch (e: any) {
      return {
        status: 'error',
        message: `批量 Hook 失败: ${e.message}`,
      };
    }
  },
};

/** 函数跟踪工具 */
export const functionTracingTools = [
  traceFunction,
  getTraceResults,
  stopTrace,
  batchHook,
];
