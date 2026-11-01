# 因读 QuantWise 命名与接续记录

2026-11-01

## 接续状态

已读取 Claude Code 会话「量化书籍AI学习平台」（`2345b87f-604e-4561-bdec-c6aa52a128a9`）。该会话完成读书伴学、行情图表、因子工具、真实模型和 MinerU 验证，最终推送了公式空格和图表标签的修复。后续 Codex 聊天已完成 [v0.1.1 发布](https://github.com/MathildaStacy/QuantWise/releases/tag/v0.1.1)，对应提交 `9556238`。

本次接续完成用户要求的项目和 App 命名，不重复发布 v0.1.1。

## 命名

- 中文名：**因读**，取「读懂因子」之意；标语「读懂因子，看懂市场」。
- 英文名、仓库名、React Native 模块和原生工程名：**QuantWise**。
- Android / iOS 显示名：**因读**；启动页和「我的」展示「因读 · QuantWise」。
- Android 包名仍为 `com.quantwise`，数据库和 Keystore 服务名不变。iOS 工程、scheme、Podfile、CI 路径和 bundle identifier 同步为 QuantWise / `com.quantwise`。
- 本地项目目录由 `newProj` 移到同级 `QuantWise`；`newProj` 保留为指向 QuantWise 的符号链接，兼容已有聊天和工具路径。目录改动不属于 Git 内容。
- Codex 侧栏的项目标签需要用户在客户端修改；当前工具没有项目重命名接口，且 Computer Use 禁止控制 Codex 自身界面。

## 验证

- 在新的 QuantWise 目录执行 `npm run check`：57 个 Jest 套件、708 项测试通过，TypeScript 无错误，ESLint 无错误，保留 2 条原有测试文件警告。
- Android Release arm64 构建成功，`apksigner verify` 通过。`aapt dump badging` 确认应用和启动 Activity 的名称为「因读」，包名为 `com.quantwise`。
- 独立 AVD `QuantWise_Test`（`emulator-5580`）覆盖安装成功，首次安装时间保持不变；冷启动返回 `Status: ok`，进程持续运行，检查时无 AndroidRuntime / ReactNativeJS / ReactNative 错误日志。结束后仅关闭本次启动的测试设备。
- React Native CLI 正确识别 `ios/QuantWise.xcodeproj`；Info.plist、Xcode project 和 storyboard / scheme 语法检查通过。未执行 iOS 完整编译或运行验证。
- 可交互原型已由源文件重新生成，Git diff 空白检查通过。

## 本地安装包

`build/branding/QuantWise-yindu-arm64.apk`，同目录包含 `SHA256SUMS.txt` 和安装验证信息。它是本次命名变更的本地验收包，仍为 versionName `0.1.1` / versionCode `2`，可覆盖现有安装；GitHub 已发布的 v0.1.1 资产未变。

SHA-256：`9e8b1c70c8439d06449a576cd1756f26bce7588591004335dd01ed59b289a5c0`。
