#!/usr/bin/env node

/**
 * JavaScript 动态逆向 MCP Server (js-reverse-mcp)
 *
 * 通用的 JavaScript 动态逆向调试工具
 * 支持任何 JavaScript 运行环境（浏览器、Node.js、小程序、Electron 等）
 *
 * 核心能力：
 * 1. 脚本枚举：列出所有已加载的 JavaScript 脚本
 * 2. 关键词搜索：在所有脚本中搜索函数、变量、字符串
 * 3. 源码查看：获取脚本完整源代码
 * 4. 函数定位：基于文本搜索定位函数位置
 * 5. 断点调试：基于 scriptId/行号/文本设置断点和条件断点
 * 6. 断点命中：监听 Debugger.paused 事件
 * 7. CallFrame 查看：查看调用栈、变量、this 引用
 * 8. 单步执行：step over/into/out
 * 9. 表达式求值：在暂停时或运行时执行 JavaScript 表达式
 * 10. 函数调用跟踪：Hook 函数并记录调用参数和返回值
 * 11. 网络请求捕获：拦截和分析 HTTP 请求
 *
 * 逆向工作流：
 * 搜索代码 → 定位函数 → 下断点 → 触发 → 查看参数 → 跟踪调用链 → 分析请求/加密逻辑
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

import {parseCliOptions, type CliOptions} from './cli.js';
import {startDebugServer, startCdpProxyServer, isProxyStarted} from './cdp-proxy.js';
import {setLogFile, infoLogger, errorLogger} from './logger.js';
import {wechatTools, jsReverseTools, jsReverseExtendedTools, functionTracingTools, type ToolDefinition} from './tools/index.js';

// 获取当前文件目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MCP SDK 导入
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';

/** MCP 服务器名称 */
const SERVER_NAME = 'wechat-miniprogram-mcp';
/** 服务器版本 */
const VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'),
).version;

/** 服务器使用说明 */
const SERVER_INSTRUCTIONS = `JavaScript 动态逆向 MCP Server

本工具为通用的 JavaScript 动态逆向调试工具，支持任何 JavaScript 运行环境。

使用方式：
1. 方式一：调用 connect_cdp 工具连接到已有 CDP 目标（如微信小程序、Electron 等）
2. 方式二：直接在 Chrome DevTools 中打开 CDP 链接进行调试

CDP 链接格式: devtools://devtools/bundled/inspector.html?ws=127.0.0.1:{cdpPort}

完整逆向工作流：
  搜索代码 → 定位函数 → 下断点 → 触发 → 查看参数 → 跟踪调用链 → 分析请求/加密逻辑

可用工具类别：
- script: 脚本枚举、搜索、源码查看
- debugger: 断点管理、单步执行、暂停状态查看
- network: 网络请求捕获和分析
- connection: CDP 连接管理

核心工具：
  list_scripts: 列出所有已加载的脚本
  search_in_sources: 在所有脚本中搜索代码关键词（基于 Script Registry 本地缓存）
  search_in_script: 在指定脚本中精确搜索
  get_script_source: 获取脚本源码（优先使用缓存）
  get_source_range: 获取脚本指定行范围的源码（压缩 JS 自动处理）
  set_breakpoint: 设置断点（支持 scriptId/行号/文本定位）
  set_breakpoint_on_text: 基于代码文本搜索自动定位断点
  get_paused_info: 查看调用栈、变量、this 引用
  evaluate_on_call_frame: 在暂停帧中执行表达式
  step: 单步执行（over/into/out）
  break_on_xhr: 设置网络请求断点
  list_network_requests: 查看捕获的网络请求
  trace_function: 函数调用跟踪

注意事项：
- 确保目标环境已启用 CDP 调试（如 Chrome --remote-debugging-port）
- 对于微信小程序，需要先启动 WMPFDebugger 代理服务器`;

/** 全局配置 */
export let globalOptions: CliOptions;

/**
 * 注册工具到 MCP 服务器
 * @param server MCP 服务器实例
 * @param tool 工具定义
 */
function registerTool(server: McpServer, tool: ToolDefinition): void {
  server.tool(
    tool.name,
    tool.description,
    tool.schema,
    async (params) => {
      try {
        const result = await tool.handler(params);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({error: errorMessage}, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  // 解析命令行参数
  globalOptions = parseCliOptions();

  // 设置日志文件
  if (globalOptions.logFile) {
    setLogFile(globalOptions.logFile);
  }

  infoLogger(`启动 ${SERVER_NAME} v${VERSION}`);

  // 创建 MCP 服务器
  const server = new McpServer({
    name: SERVER_NAME,
    version: VERSION,
    description: 'JavaScript 动态逆向 MCP Server - 通用 JS 调试与逆向分析工具',
  }, {
    capabilities: {logging: {}},
    instructions: SERVER_INSTRUCTIONS,
  });

  // 注册所有工具
  const allTools = [...jsReverseTools, ...jsReverseExtendedTools, ...functionTracingTools, ...wechatTools];
  for (const tool of allTools) {
    registerTool(server, tool);
    infoLogger(`注册工具: ${tool.name}`);
  }

  // 如果命令行指定了 cdp-port，自动尝试连接
  if (globalOptions.cdpPort) {
    infoLogger(`命令行指定 CDP 端口: ${globalOptions.cdpPort}，将在首次工具调用时自动连接`);
  }

  infoLogger('MCP 服务器已就绪，等待客户端连接...');

  // 连接 MCP 服务器
  const transport = new StdioServerTransport();
  await server.connect(transport);
  infoLogger(`${SERVER_NAME} 已连接到 MCP 客户端`);
}

// 启动主函数
main().catch((error) => {
  errorLogger('启动失败:', error);
  process.exit(1);
});
