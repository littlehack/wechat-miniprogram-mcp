/**
 * 工具分类枚举
 * 独立文件，避免循环依赖
 */
export enum ToolCategory {
  /** 小程序专用工具 */
  MINIPROGRAM = 'miniprogram',
  /** 网络相关工具 */
  NETWORK = 'network',
  /** 脚本相关工具 */
  SCRIPT = 'script',
  /** 调试相关工具 */
  DEBUGGER = 'debugger',
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
  schema: any;
  /** 工具处理函数 */
  handler: (params: any) => Promise<any>;
}
