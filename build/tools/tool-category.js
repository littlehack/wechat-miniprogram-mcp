/**
 * 工具分类枚举
 * 独立文件，避免循环依赖
 */
export var ToolCategory;
(function (ToolCategory) {
    /** 小程序专用工具 */
    ToolCategory["MINIPROGRAM"] = "miniprogram";
    /** 网络相关工具 */
    ToolCategory["NETWORK"] = "network";
    /** 脚本相关工具 */
    ToolCategory["SCRIPT"] = "script";
    /** 调试相关工具 */
    ToolCategory["DEBUGGER"] = "debugger";
})(ToolCategory || (ToolCategory = {}));
//# sourceMappingURL=tool-category.js.map