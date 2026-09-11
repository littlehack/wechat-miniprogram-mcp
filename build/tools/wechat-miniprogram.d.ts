/**
 * 微信小程序逆向工具定义
 * 提供微信小程序特有的逆向分析功能
 * 通过 CDP 协议与小程序通信
 */
import { z } from 'zod';
/** 工具分类枚举 */
export declare enum ToolCategory {
    /** 小程序专用工具 */
    MINIPROGRAM = "miniprogram",
    /** 网络相关工具 */
    NETWORK = "network",
    /** 脚本相关工具 */
    SCRIPT = "script",
    /** 调试相关工具 */
    DEBUGGER = "debugger"
}
/** 工具定义接口 */
export interface ToolDefinition {
    /** 工具名称 */
    name: string;
    /** 工具描述 */
    description: string;
    /** 工具分类 */
    category: ToolCategory;
    /** 输入参数 schema */
    schema: z.ZodRawShape;
    /** 工具处理函数 */
    handler: (params: any) => Promise<any>;
}
/**
 * 连接 CDP 工具
 * 手动启动调试服务器和 CDP 代理，并连接到微信小程序
 */
export declare const connectCdp: ToolDefinition;
/**
 * 断开 CDP 连接工具
 */
export declare const disconnectCdp: ToolDefinition;
/**
 * 获取微信小程序状态工具
 */
export declare const getMiniProgramStatus: ToolDefinition;
/**
 * 拦截小程序网络请求工具
 */
export declare const interceptNetworkRequests: ToolDefinition;
/**
 * 提取小程序代码包工具
 * 保存脚本到本地目录，按虚拟文件系统组织（类似 Chrome DevTools Sources 面板）
 */
export declare const extractCodeBundle: ToolDefinition;
/**
 * Hook 小程序 API 工具
 */
export declare const hookMiniProgramApi: ToolDefinition;
/**
 * 列出所有执行上下文工具
 */
export declare const listContexts: ToolDefinition;
/**
 * 切换执行上下文工具
 */
export declare const switchContext: ToolDefinition;
/**
 * 获取小程序存储数据工具
 */
export declare const getStorageData: ToolDefinition;
/**
 * 分析小程序加密参数工具
 */
export declare const analyzeEncryptionParams: ToolDefinition;
/**
 * 获取脚本源代码工具
 * 优先使用本地缓存，不命中时通过 Debugger.getScriptSource 获取并缓存
 */
export declare const getScriptSource: ToolDefinition;
/**
 * 提取当前页面业务逻辑工具
 * 从当前显示的页面中提取所有业务逻辑代码（Page/Component 定义）
 */
export declare const extractPageBusinessLogic: ToolDefinition;
/**
 * 搜索并自动下断点工具
 * 搜索 AppService 脚本中的网络请求函数（t.request/Ka/wx.request 等），自动在匹配位置设置断点
 */
export declare const searchAndAutoBreak: ToolDefinition;
/**
 * AppService 网络请求捕获工具
 * 通过 AppService Network 域捕获逻辑层网络请求
 * 也可注入 Hook 捕获 wx.request 调用
 */
export declare const captureAppServiceNetwork: ToolDefinition;
/** 所有微信小程序工具 */
export declare const wechatTools: ToolDefinition[];
//# sourceMappingURL=wechat-miniprogram.d.ts.map