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
import { type CliOptions } from './cli.js';
/** 全局配置 */
export declare let globalOptions: CliOptions;
//# sourceMappingURL=index.d.ts.map