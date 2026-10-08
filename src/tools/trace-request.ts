import {z} from 'zod';
import {getCDPClient} from '../cdp-client.js';
import {infoLogger} from '../logger.js';
import {ToolCategory, type ToolDefinition} from './wechat-miniprogram.js';

/**
 * 请求溯源工具：找到触发网络请求的函数
 */
export const traceRequest: ToolDefinition = {
  name: 'trace_request',
  description: '请求溯源：找到触发指定网络请求的函数调用链。输入 URL 关键词，输出发起请求的完整调用栈和代码位置',
  category: ToolCategory.NETWORK,
  schema: {
    url: z.string().optional().describe('URL 关键词（不区分大小写匹配）'),
    reqid: z.number().optional().describe('请求 ID（从 list_network_requests 获取）'),
    include_code: z.boolean().optional().describe('是否包含调用点的代码片段（默认 true）'),
  },
  handler: async (params: {
    url?: string;
    reqid?: number;
    include_code?: boolean;
  }) => {
    const client = getCDPClient();
    try {
      await client.connect();

      const requests = client.getNetworkRequests();
      if (requests.length === 0) {
        return {
          status: 'error',
          message: '无网络请求记录。请先触发一些网络操作',
        };
      }

      // 如果提供了 reqid，直接查找该请求
      if (params.reqid !== undefined) {
        const request = client.getNetworkRequestById(params.reqid);
        if (!request) {
          return {
            status: 'error',
            message: `未找到请求 ID ${params.reqid}`,
          };
        }

        const result: any = {
          request_id: params.reqid,
          url: request.url,
          method: request.method,
          status: request.status,
        };

        // 如果有 initiator 信息，返回调用链
        if (request.initiator) {
          result.initiator = request.initiator;

          // 尝试获取调用点代码
          if (params.include_code !== false && request.initiator.stack?.callFrames) {
            const topFrame = request.initiator.stack.callFrames[0];
            if (topFrame?.scriptId && topFrame?.lineNumber !== undefined) {
              try {
                const source = await client.getSourceWithCache(topFrame.scriptId);
                if (source) {
                  const lines = source.source.split('\n');
                  const lineIdx = topFrame.lineNumber;
                  if (lineIdx >= 0 && lineIdx < lines.length) {
                    result.code_snippet = {
                      file: topFrame.url || topFrame.scriptId,
                      line: lineIdx + 1,
                      column: (topFrame.columnNumber || 0) + 1,
                      code: lines[lineIdx]?.trim(),
                      function: topFrame.functionName || '<anonymous>',
                    };
                  }
                }
              } catch {
                // 忽略源码获取错误
              }
            }
          }
        }

        return result;
      }

      // 如果提供了 URL 关键词，搜索匹配的请求
      if (params.url) {
        const urlLower = params.url.toLowerCase();
        const matchedRequests = requests.filter(r =>
          r.url.toLowerCase().includes(urlLower)
        );

        if (matchedRequests.length === 0) {
          return {
            status: 'error',
            message: `未找到包含 "${params.url}" 的网络请求。已捕获 ${requests.length} 个请求`,
            available_urls: requests.slice(0, 10).map(r => r.url),
          };
        }

        const results = [];
        for (const req of matchedRequests.slice(0, 5)) {
          const result: any = {
            request_id: req.requestId,
            url: req.url,
            method: req.method,
            status: req.status,
          };

          if (req.initiator?.stack?.callFrames) {
            result.call_chain = req.initiator.stack.callFrames.map((f: any) => ({
              function: f.functionName || '<anonymous>',
              script_id: f.scriptId,
              url: f.url,
              line: (f.lineNumber || 0) + 1,
              column: (f.columnNumber || 0) + 1,
            }));

            // 获取顶层调用点代码
            if (params.include_code !== false) {
              const topFrame = req.initiator.stack.callFrames[0];
              if (topFrame?.scriptId && topFrame?.lineNumber !== undefined) {
                try {
                  const source = await client.getSourceWithCache(topFrame.scriptId);
                  if (source) {
                    const lines = source.source.split('\n');
                    const lineIdx = topFrame.lineNumber;
                    if (lineIdx >= 0 && lineIdx < lines.length) {
                      result.code_snippet = {
                        file: topFrame.url || topFrame.scriptId,
                        line: lineIdx + 1,
                        column: (topFrame.columnNumber || 0) + 1,
                        code: lines[lineIdx]?.trim(),
                        function: topFrame.functionName || '<anonymous>',
                      };
                    }
                  }
                } catch {
                  // 忽略
                }
              }
            }
          }

          results.push(result);
        }

        return {
          status: 'found',
          query: params.url,
          matched_count: matchedRequests.length,
          results,
        };
      }

      // 如果都没提供，返回最近的请求列表
      return {
        status: 'list',
        message: '请提供 url 或 reqid 参数来溯源请求',
        recent_requests: requests.slice(-10).reverse().map(r => ({
          id: r.requestId,
          url: r.url,
          method: r.method,
          status: r.status,
          has_initiator: !!r.initiator,
        })),
      };
    } catch (e: any) {
      return {
        status: 'error',
        message: `请求溯源失败: ${e.message}`,
      };
    }
  },
};
