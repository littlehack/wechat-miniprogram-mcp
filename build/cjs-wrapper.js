/**
 * CommonJS 模块包装器
 * 用于在 ESM 环境中加载 CommonJS 模块
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// 创建 require 函数
const require = createRequire(import.meta.url);
// 加载 CommonJS 模块
const codex = require('./third_party/RemoteDebugCodex.cjs');
const messageProto = require('./third_party/WARemoteDebugProtobuf.cjs');
export { codex, messageProto };
//# sourceMappingURL=cjs-wrapper.js.map