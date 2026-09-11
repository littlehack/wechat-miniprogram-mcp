# 微信小程序逆向 MCP Server

专用于小程序 JS 逆向的 MCP (Model Context Protocol) Server，支持脚本枚举、搜索、断点调试、函数跟踪、网络请求捕获等完整动态逆向能力。

## 核心能力

### 逆向工作流

```
搜索代码 → 定位函数 → 下断点 → 触发 → 查看参数 → 跟踪调用链 → 分析请求/加密逻辑
```

### 完整调试能力

| 能力 | 工具 | 说明 |
|------|------|------|
| 脚本枚举 | `list_scripts` | 列出所有已加载的 JavaScript 脚本 |
| 关键词搜索 | `search_in_sources` | 在所有脚本中搜索函数、变量、字符串 |
| 源码查看 | `get_script_source` | 获取脚本完整源代码 |
| 函数定位 | `set_breakpoint_on_text` | 基于代码文本自动定位并设置断点 |
| 断点调试 | `set_breakpoint` | 基于 scriptId/行号设置断点和条件断点 |
| 断点命中 | `get_paused_info` | 查看调用栈、变量、this 引用、作用域链 |
| 单步执行 | `step` | step over/into/out |
| 表达式求值 | `evaluate_on_call_frame` | 在暂停帧中执行表达式访问局部变量 |
| 函数跟踪 | `trace_function` | Hook 函数并记录调用参数、返回值、执行时间 |
| 网络捕获 | `list_network_requests` | 拦截和分析 HTTP 请求 |
| XHR 断点 | `break_on_xhr` | 设置网络请求断点 |

## 前置要求

- **Node.js**: v20.19.0 或更高版本
- **调试目标**: 任何支持 Chrome DevTools Protocol 的 JavaScript 运行环境

## 快速开始

### 1. 安装依赖

```bash
cd wechat-miniprogram-mcp
npm install
```

### 2. 构建并启动

```bash
npm run build
npm start
```

### 3. 连接到调试目标

**方式一：连接到 Chrome 浏览器**

```bash
# 启动 Chrome 并启用远程调试
chrome.exe --remote-debugging-port=9222

# 然后在工具中调用 connect_cdp 工具
```

**方式二：连接到微信小程序**

```bash
# 需要先启动 WMPFDebugger 代理
npm start -- --cdp-port 62000
```

## 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--debug-port <port>` | 调试服务器端口 | 9421 |
| `--cdp-port <port>` | CDP 代理服务器端口 | 62000 |
| `--debug-main` | 输出主进程调试信息 | false |
| `--log-file <path>` | 日志文件路径 | 无 |

## MCP 工具列表

### JS 逆向核心工具 (jsReverseTools)

| 工具名称 | 说明 |
|----------|------|
| `evaluate_script` | 在目标环境执行 JavaScript 代码 |
| `search_in_sources` | 在所有脚本中搜索代码 |
| `set_breakpoint` | 基于 scriptId/行号设置断点 |
| `set_breakpoint_on_text` | 基于代码文本搜索自动定位断点 |
| `get_paused_info` | 查看暂停状态、调用栈、变量 |
| `evaluate_on_call_frame` | 在暂停帧中执行表达式 |
| `step` | 单步执行（over/into/out） |
| `pause_or_resume` | 暂停/恢复执行 |
| `list_breakpoints` | 列出所有断点 |
| `remove_breakpoint` | 移除断点 |
| `get_call_stack` | 获取调用栈 |
| `watch_variable` | 监控变量变化 |
| `deobfuscate_code` | 代码反混淆 |

### JS 逆向扩展工具 (jsReverseExtendedTools)

| 工具名称 | 说明 |
|----------|------|
| `list_scripts` | 列出所有已加载的脚本 |
| `get_script_source` | 获取脚本源码 |
| `save_script_source` | 保存脚本源码到文件 |
| `list_network_requests` | 查看捕获的网络请求 |
| `clear_network_requests` | 清除网络请求记录 |
| `get_request_initiator` | 获取请求发起调用栈 |
| `break_on_xhr` | 设置 XHR/Fetch 断点 |
| `list_console_messages` | 查看控制台消息 |
| `take_screenshot` | 截取页面截图 |
| `click_element` | 点击页面元素 |
| `select_frame` | 获取页面框架列表 |
| `clear_site_data` | 清除站点数据 |

### 函数调用跟踪工具 (functionTracingTools)

| 工具名称 | 说明 |
|----------|------|
| `trace_function` | Hook 函数并记录调用信息 |
| `get_trace_results` | 获取函数跟踪结果 |
| `stop_trace` | 停止函数跟踪 |
| `batch_hook` | 批量 Hook 多个函数 |

### 微信小程序专用工具 (wechatTools)

| 工具名称 | 说明 |
|----------|------|
| `connect_cdp` | 连接到微信小程序 CDP |
| `disconnect_cdp` | 断开 CDP 连接 |
| `get_miniprogram_status` | 获取小程序运行状态 |
| `extract_code_bundle` | 提取代码包 |
| `hook_miniprogram_api` | Hook 小程序 API |
| `get_storage_data` | 获取存储数据 |
| `analyze_encryption_params` | 分析加密参数 |

## 集成到 AI Agent

### Claude Desktop 配置

在 `claude_desktop_config.json` 中添加：

```json
{
  "mcpServers": {
    "js-reverse": {
      "command": "node",
      "args": ["D:\\path\\to\\wechat-miniprogram-mcp\\build\\src\\index.js"]
    }
  }
}
```

### OpenCode 配置

在 `opencode.json` 中添加：

```json
{
  "mcp": {
    "js-reverse": {
      "command": "node",
      "args": ["D:\\path\\to\\wechat-miniprogram-mcp\\build\\src\\index.js"]
    }
  }
}
```

## 典型逆向场景

### 场景 1：分析加密参数

```javascript
// 1. 搜索加密相关代码
search_in_sources({ query: "encrypt" })

// 2. 定位加密函数并下断点
set_breakpoint_on_text({ text: "function encrypt(" })

// 3. 触发请求，断点命中后查看参数
get_paused_info({})

// 4. 在暂停帧中查看变量
evaluate_on_call_frame({ expression: "JSON.stringify(data)" })
```

### 场景 2：跟踪函数调用

```javascript
// 1. 启动函数跟踪
trace_function({ target: "wx.request" })

// 2. 执行操作触发函数调用
evaluate_script({ script: "wx.request({url: '...'})" })

// 3. 获取跟踪结果
get_trace_results({ last_n: 10 })
```

### 场景 3：分析网络请求签名

```javascript
// 1. 设置 XHR 断点
break_on_xhr({ url: "api.example.com" })

// 2. 触发请求，断点命中后查看调用栈
get_paused_info({})

// 3. 向上遍历调用栈找到签名函数
evaluate_on_call_frame({ 
  frame_index: 2, 
  expression: "JSON.stringify(arguments)" 
})
```

## 技术架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      js-reverse-mcp                              │
├─────────────────────────────────────────────────────────────────┤
│  Tools Layer                                                     │
│  ├── jsReverseTools        (核心调试工具)                        │
│  ├── jsReverseExtendedTools (扩展工具)                           │
│  ├── functionTracingTools  (函数跟踪)                            │
│  └── wechatTools           (微信专用，可选)                      │
├─────────────────────────────────────────────────────────────────┤
│  CDP Client Layer                                                │
│  ├── Proxy Mode    (WMPFDebugger 代理，用于微信小程序)           │
│  └── Direct Mode   (直连 Chrome DevTools，通用场景)              │
├─────────────────────────────────────────────────────────────────┤
│  Target Runtime                                                  │
│  ├── Chrome/Chromium  (浏览器)                                   │
│  ├── Node.js          (服务端)                                   │
│  ├── Electron         (桌面应用)                                 │
│  └── WeChatAppEx      (微信小程序，通过代理)                     │
└─────────────────────────────────────────────────────────────────┘
```

## 许可证

Apache-2.0

## 致谢

- [WMPFDebugger](https://github.com/evi0s/WMPFDebugger) - 微信小程序调试工具
- [js-reverse-mcp](https://github.com/zhizhuodemao/js-reverse-mcp) - JS 逆向 MCP Server
