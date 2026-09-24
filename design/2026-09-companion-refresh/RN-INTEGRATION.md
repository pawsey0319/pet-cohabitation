# 异宠视觉重设计：现有安卓代码对接

日期：2026-09-10。此文件由 Codex 根据当前本地源码核对；视觉原型由 OpenDesign 中的 Grok Build `grok-4.6` 生成。本文只说明后续接入位置，不代表 App 已完成改版。

当前安卓代码位于 `D:/Knowlege_base/intern/project/bro-relationship/.worktrees/agent-workbench-pet-onboarding`。以下路径相对此目录。

## 页面对应

| 原型页面/区域 | 已有实现 | 后续接入要点 |
| --- | --- | --- |
| 消息 / 异宠 / 我的底部导航 | `app/(tabs)/_layout.tsx` | 保留三个入口及路由，只替换视觉与图标 |
| 陪伴 / 消息管家 / 成长、异宠生成确认 | `app/(tabs)/pet.tsx` | 保留当前异宠状态、模式选择和生成流程 |
| 陪伴对话、接续、手工记忆 | `src/components/PetCompanionPanel.tsx` | 保留 Props 回调、上下文边界、请求标识与草稿恢复 |
| 自动偏好、依据与纠错 | `src/components/PreferenceMemoryPanel.tsx` | 映射已有偏好操作及依据分页接口 |
| 消息列表 | `app/(tabs)/chats/index.tsx` | 不恢复已移除的右上角通知入口 |
| 群聊 | `app/chat/[spaceId].tsx` | 保留现有发送、任务转交及群聊数据边界 |
| 主 Agent 工作台 | `src/components/AgentWorkbench.tsx` | 现有群聊中的工作台入口、状态和发布回调继续使用 |
| 我的、设置 | `app/(tabs)/me.tsx` | 视觉拆分不改变账号和数据操作语义 |
| 登录 / 注册 | `app/(auth)/login.tsx`、`app/(auth)/register.tsx` | 表单风格和状态统一，认证流程继续使用 |
| 邀请、管理辅助页 | `app/invite/[token].tsx`、`app/admin/invites.tsx`、`app/admin/status.tsx` | 使用同一组件与令牌体系 |

## 必须保留的交互和数据约束

- 短对话的输入区紧跟上下文；长对话滚动后，输入与发送仍可见。保留 `KeyboardScreen` 和现有键盘适配，不把网页的 `visualViewport` 代码直接搬进 React Native。
- `PetCompanionPanel` 的 `onSend(content, requestId)`、`privateDraft` 持久化、请求回复关联与 Android 输入事件处理要继续使用。发送后清空、失败重试、重新打开 App 的草稿恢复需要真机回归。
- `PetCompanionContext` 已提供 `memories`、`contextStartedAt`、`preferences`、`excludedMessageIds`、`manualHistory` 及提取任务数量。页面更新继续使用这些真实状态，不以原型的演示数据结构替换。
- `PreferenceAction.action` 已支持 `important`、`positive`、`negative`、`retract`、`forget`。明确不再喜欢、纠正错误、忘记分别映射对应操作，不合并为“删除”。
- 依据分页继续使用 `MemoryEvidencePage` 的 `items` 与 `nextOffset`；手工记忆维持 20 条、每条 400 字。
- 只有主动开启新话题改变边界；纠错、忘记后继续原话题，并遵守已有来源排除及版本校验。
- 个人偏好不传入群聊或消息管家模型载荷。

## 主题与背景

现有 `src/theme/ThemeProvider.tsx`、`ThemeContext.tsx`、`preferences.ts` 与 `tokens.ts` 分别承接主题上下文、偏好和视觉令牌。当前偏好支持页面/卡片/按钮/强调色、圆角、密度、减少动态及回复长度。

后续先将设计中的颜色按语义映射到同一主题体系，并补齐深浅色所需的文本、边框、遮罩和状态色；不能仅替换背景色，留下旧版暗色专用文字。

聊天背景的全局设置、单聊覆盖、图片保存和 AI 生成是后续接入事项。本轮原型只演示：图片留在浏览器本地，AI 候选为样例。现有颜色偏好并不等于已经具有这些完整能力。

在设计确认后再定义背景资源引用、裁切位置、可读性遮罩、配套气泡和单聊覆盖的持久化结构；明确仅影响用户自己的显示。该阶段继续沿用 Android 1.0.4 运行时，优先使用已有依赖。

## 原型检查与真机验证的区别

浏览器可检查页面跳转、示例状态、视口宽度、颜色与基本键盘导航。安卓输入法、系统字体缩放、返回键、权限、账号切换、真实模型等待和云端并发仍必须在正式接入后验证。设计原型通过不代表上述 App 验收通过。
