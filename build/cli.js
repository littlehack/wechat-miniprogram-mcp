/**
 * CLI 参数解析模块
 * 解析命令行参数
 */
/** 默认调试端口 */
const DEBUG_PORT = 9421;
/** 默认 CDP 端口 */
const CDP_PORT = 62000;
/**
 * 打印帮助信息
 */
function printHelp() {
    console.log(`用法: npx wechat-miniprogram-mcp [选项]

选项:
  --debug-port <port>    调试服务器端口 (默认: ${DEBUG_PORT})
  --cdp-port <port>      CDP 代理服务器端口 (默认: ${CDP_PORT})
  --debug-main           输出主进程调试信息
  --debug-frida          输出 Frida 客户端信息
  --log-file <path>      日志文件路径
  --allowedRoots <dir>   允许读写的根目录 (可重复)
  -h, --help             显示此帮助信息`);
}
/**
 * 解析端口号
 * @param name 参数名
 * @param value 参数值
 * @param defaultValue 默认值
 * @returns 解析后的端口号
 */
function parsePort(name, value, defaultValue) {
    if (value === undefined) {
        return defaultValue;
    }
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`无效的 ${name}: ${value}`);
    }
    return port;
}
/**
 * 解析命令行参数
 * @returns 解析后的选项
 */
export function parseCliOptions() {
    const args = process.argv.slice(2);
    const options = {
        debugPort: DEBUG_PORT,
        cdpPort: CDP_PORT,
        debugMain: false,
        debugFrida: false,
    };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '-h' || arg === '--help') {
            printHelp();
            process.exit(0);
        }
        if (arg === '--debug-port') {
            options.debugPort = parsePort('--debug-port', args[++i], DEBUG_PORT);
        }
        else if (arg === '--cdp-port') {
            options.cdpPort = parsePort('--cdp-port', args[++i], CDP_PORT);
        }
        else if (arg === '--debug-main') {
            options.debugMain = true;
        }
        else if (arg === '--debug-frida') {
            options.debugFrida = true;
        }
        else if (arg === '--log-file') {
            options.logFile = args[++i];
        }
        else if (arg === '--allowedRoots') {
            if (!options.allowedRoots) {
                options.allowedRoots = [];
            }
            options.allowedRoots.push(args[++i]);
        }
    }
    return options;
}
//# sourceMappingURL=cli.js.map