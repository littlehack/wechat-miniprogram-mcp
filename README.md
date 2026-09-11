# 微信小程序逆向 MCP Server

专用于小程序 JS 逆向的 MCP (Model Context Protocol) Server，支持脚本枚举、搜索、断点调试、函数跟踪、网络请求捕获等完整动态逆向能力。

## 核心能力

### 逆向工作流

```
搜索代码 → 定位函数 → 下断点 → 触发 → 查看参数 → 跟踪调用链 → 分析请求/加密逻辑
```

### 支持环境

- **微信小程序** (WeChatAppEx) - 主要目标
- **Chrome/Chromium** 浏览器
- **Node.js** 服务端
- **Electron** 桌面应用
- 任何支持 Chrome DevTools Protocol 的 JavaScript 运行环境

## 前置要求

- **Node.js**: v20.19.0 或更高版本
- **微信版本**: 支持微信 for Windows 4.x 及以上版本
- **调试目标**: 微信小程序需要 WMPFDebugger 代理

> **注意**: WMPFDebugger 通过 Frida hook 微信小程序运行时（WeChatAppEx.exe）。当前支持的内部版本号范围为 11581-19459。如果您的微信版本不在支持范围内，Frida hook 将无法正常工作。请确保微信版本为4.x 或更高版本。

## 快速开始

### 1. 安装依赖

```bash
git clone https://github.com/littlehack/wechat-miniprogram-mcp.git
cd wechat-miniprogram-mcp
npm install
```

### 2. 构建并启动

```bash
npm run build
npm start
```

### 3. 连接到调试目标

**方式一：连接到微信小程序**

```bash
# 需要先启动 WMPFDebugger 代理
npm start -- --cdp-port 62000
```

**方式二：连接到 Chrome 浏览器**

```bash
# 启动 Chrome 并启用远程调试
chrome.exe --remote-debugging-port=9222
```

## 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--debug-port <port>` | 调试服务器端口 | 9421 |
| `--cdp-port <port>` | CDP 代理服务器端口 | 62000 |
| `--debug-main` | 输出主进程调试信息 | false |
| `--log-file <path>` | 日志文件路径 | 无 |

## MCP 工具列表

### 微信小程序专用工具 (wechatTools)

| 工具名称 | 说明 |
|----------|------|
| `connect_cdp` | 连接到微信小程序 CDP |
| `disconnect_cdp` | 断开 CDP 连接 |
| `get_miniprogram_status` | 获取小程序运行状态 |
| `list_contexts` | 列出所有可用的 JavaScript 执行上下文 |
| `switch_context` | 切换执行上下文（如 app=逻辑层, page-frame=渲染层） |
| `extract_code_bundle` | 提取代码包（按虚拟文件系统保存） |
| `extract_page_business_logic` | 提取当前页面的业务逻辑代码 |
| `hook_miniprogram_api` | Hook 小程序 API（如 wx.request, wx.login） |
| `get_storage_data` | 获取本地存储数据（wx.getStorageSync） |
| `analyze_encryption_params` | 分析加密参数、签名算法、反爬虫机制 |
| `intercept_network_requests` | 拦截网络请求，记录 API 调用和数据传输 |
| `capture_appservice_network` | 捕获 AppService 逻辑层的网络请求 |
| `search_and_auto_break` | 搜索网络请求函数并自动设置断点 |

### JS 逆向核心工具 (jsReverseTools)

| 工具名称 | 说明 |
|----------|------|
| `evaluate_script` | 在目标环境执行 JavaScript 代码 |
| `search_in_sources` | 在所有脚本中搜索代码 |
| `search_in_script` | 在指定脚本中搜索代码 |
| `set_breakpoint` | 基于 scriptId/行号设置断点 |
| `set_breakpoint_on_text` | 基于代码文本搜索自动定位断点 |
| `get_paused_info` | 查看暂停状态、调用栈、变量 |
| `evaluate_on_call_frame` | 在暂停帧中执行表达式 |
| `get_call_stack` | 获取调用栈 |
| `step` | 单步执行（over/into/out） |
| `pause_or_resume` | 暂停/恢复执行 |
| `list_breakpoints` | 列出所有断点 |
| `remove_breakpoint` | 移除断点 |
| `watch_variable` | 监控变量变化 |
| `deobfuscate_code` | 代码反混淆 |

### JS 逆向扩展工具 (jsReverseExtendedTools)

| 工具名称 | 说明 |
|----------|------|
| `list_scripts` | 列出所有已加载的脚本 |
| `get_script_source` | 获取脚本源码 |
| `get_source_range` | 获取脚本指定行范围的源码 |
| `save_script_source` | 保存脚本源码到文件 |
| `list_network_requests` | 查看捕获的网络请求 |
| `clear_network_requests` | 清除网络请求记录 |
| `get_request_initiator` | 获取请求发起调用栈 |
| `break_on_xhr` | 设置 XHR/Fetch 断点 |
| `list_console_messages` | 查看控制台消息 |
| `take_screenshot` | 截取页面截图 |
| `click_element` | 点击页面元素 |
| `select_frame` | 选择页面框架（iframe） |
| `clear_site_data` | 清除站点数据（cookies、缓存、存储） |

### 函数调用跟踪工具 (functionTracingTools)

| 工具名称 | 说明 |
|----------|------|
| `trace_function` | Hook 函数并记录调用信息 |
| `get_trace_results` | 获取函数跟踪结果 |
| `stop_trace` | 停止函数跟踪 |
| `batch_hook` | 批量 Hook 多个函数 |

## 集成到 AI Agent

### Claude Desktop 配置

在 `claude_desktop_config.json` 中添加：

```json
{
  "mcpServers": {
    "wechat-miniprogram": {
      "command": "node",
      "args": ["D:\\path\\to\\wechat-miniprogram-mcp\\build\\index.js"]
    }
  }
}
```

### OpenCode 配置

在 `opencode.json` 中添加：

```json
{
  "mcp": {
    "wechat-miniprogram": {
      "command": "node",
      "args": ["D:\\path\\to\\wechat-miniprogram-mcp\\build\\index.js"]
    }
  }
}
```

## 典型逆向场景

### 场景 1：分析加密参数

```javascript
// 1. 连接到小程序
connect_cdp({})

// 2. 搜索加密相关代码
search_in_sources({ query: "encrypt" })

// 3. 定位加密函数并下断点
set_breakpoint_on_text({ text: "function encrypt(" })

// 4. 断点命中后查看参数
get_paused_info({})

// 5. 在暂停帧中查看变量
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

### 场景 4：提取小程序代码

```javascript
// 1. 连接到小程序
connect_cdp({})

// 2. 提取完整代码包
extract_code_bundle({ save_path: "./miniprogram_scripts" })

// 3. 或提取当前页面业务逻辑
extract_page_business_logic({ save_path: "./business_logic" })
```

### 场景 5：Hook 小程序 API

```javascript
// 1. Hook wx.request
hook_miniprogram_api({ api_name: "wx.request", action: "log" })

// 2. Hook wx.login
hook_miniprogram_api({ api_name: "wx.login", action: "log" })

// 3. 执行操作，查看日志
```

### 场景 6：捕获 AppService 网络请求

```javascript
// 1. 捕获逻辑层网络请求（支持 URL 过滤）
capture_appservice_network({ url_filter: "api", duration_ms: 30000 })

// 2. 查看捕获的请求
list_network_requests({})
```

## 技术架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    wechat-miniprogram-mcp                        │
├─────────────────────────────────────────────────────────────────┤
│  Tools Layer                                                     │
│  ├── wechatTools           (微信小程序专用工具)                   │
│  ├── jsReverseTools        (核心调试工具)                         │
│  ├── jsReverseExtendedTools (扩展工具)                            │
│  └── functionTracingTools  (函数跟踪)                             │
├─────────────────────────────────────────────────────────────────┤
│  CDP Client Layer                                                │
│  ├── Proxy Mode    (WMPFDebugger 代理，用于微信小程序)            │
│  └── Direct Mode   (直连 Chrome DevTools，通用场景)               │
├─────────────────────────────────────────────────────────────────┤
│  Target Runtime                                                  │
│  ├── WeChatAppEx      (微信小程序，通过代理)                      │
│  ├── Chrome/Chromium  (浏览器)                                    │
│  ├── Node.js          (服务端)                                    │
│  └── Electron         (桌面应用)                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 项目结构

```
wechat-miniprogram-mcp/
├── src/                          # TypeScript 源码
│   ├── tools/
│   │   ├── wechat-miniprogram.ts # 微信小程序专用工具
│   │   ├── js-reverse.ts         # 核心调试工具
│   │   ├── js-reverse-extended.ts # 扩展工具
│   │   └── function-tracing.ts   # 函数跟踪工具
│   ├── cdp-client.ts             # CDP 客户端
│   ├── cdp-proxy.ts              # CDP 代理服务器
│   ├── frida-inject.ts           # Frida 注入模块
│   └── index.ts                  # 入口文件
├── frida/                        # Frida 相关文件
│   ├── hook.js                   # Frida hook 脚本
│   └── config/                   # 地址配置文件
├── build/                        # 编译输出目录
├── package.json
└── README.md
```

## 免责声明

**使用本工具进行微信小程序逆向分析存在以下风险，使用前请仔细阅读：**

### 账号封禁风险

- 微信官方明确禁止对微信客户端及小程序进行逆向工程、调试或修改
- 使用本工具可能被微信检测为异常行为，导致**账号被封禁或限制功能**
- 建议使用**测试账号**进行调试，避免使用主账号

### 法律风险

- 逆向工程可能违反微信用户协议和相关法律法规
- 本工具仅供学习研究使用，不得用于商业用途或非法目的
- 用户应自行承担使用本工具产生的一切法律责任

### 技术风险

- Frida hook 可能导致微信客户端不稳定或崩溃
- 不当使用可能导致小程序数据异常或丢失
- 建议在虚拟机或测试环境中使用

### 建议

1. 使用测试账号进行调试
2. 不要在生产环境中使用
3. 遵守微信用户协议和相关法律法规
4. 仅用于学习和研究目的

## 许可证

Apache-2.0

## 致谢

- [WMPFDebugger](https://github.com/evi0s/WMPFDebugger) - 微信小程序调试工具
- [js-reverse-mcp](https://github.com/zhizhuodemao/js-reverse-mcp) - JS 逆向 MCP Server
