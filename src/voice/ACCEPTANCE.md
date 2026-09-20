# T12 系统语音实现与验收 · 2026-09-11

本地实现 Android Expo 模块 `PetSystemVoice`，封装 `SpeechRecognizer` 和 `TextToSpeech`。未构建、发布 APK，不将原生验收标为通过。

## 已实现

- 检查系统识别、端侧识别及朗读语言支持，申请麦克风权限；优先可用端侧识别，缺少语言或不支持时退回系统服务。API 33 检查已安装端侧语言。
- 部分识别只显示临时文字，最终识别只交给可编辑草稿回调，不调用消息发送。取消、重复最终回调、账号切换和页面离开后的回调不能追加草稿。
- 每条消息点击朗读，支持停止，播放新条目停止前一条；按引擎长度限制分段，不截断长回复。切换账号、页面失焦及 App 后台停止旧音频。
- TTS 初始化五秒无结果时返回不可用，缺少原生模块的旧运行时和非 Android 设备保留文字入口。
- App 不保存识别录音；界面说明系统服务可能联网处理音频。系统引擎自身的处理由设备服务决定。
- 陪伴页将相册、拍照与语音放在同一工具行。闲置时只显示短能力状态；点击语音展开页内控制面板，用户在“开始识别”前可读到系统服务可能联网及结果先入草稿的说明。识别中和错误时展示必要反馈，不增加审批弹窗。

## 集成合同

```tsx
const voice = useSystemVoice({ scopeKey: 'companion', onTranscript: text => setDraft(old => old ? `${old}\n${text}` : text) });
// 同一页面共用一个 hook 实例；不要在每个消息行创建一个实例。
<VoiceInputButton compact voice={voice} expanded={voiceOpen} onToggle={() => setVoiceOpen(value => !value)} />
{voiceOpen && <VoiceInputPanel voice={voice} onClose={() => setVoiceOpen(false)} />}
<SpeakButton voice={voice} messageId={message.id} text={message.content} />
```

`stopSystemVoice()` 用于登录会话退出/注销清理。主整合负责人接入陪伴页和退出入口。模块通过项目的 `modules/` 自动链接，不需要额外依赖或 app.json 插件；Android Manifest 合并录音权限和系统服务查询。

## 验证证据

- `npm run typecheck` 通过。
- `src/voice/__tests__/lifecycle.test.tsx` 两项 Jest 通过：最终结果只进草稿、重复/迟到结果丢弃、取消和账号切换停止旧会话。
- 陪伴面板行为测试验证：默认工具行不常驻长说明，点击语音展开说明时尚不识别，点击“开始识别”才将最终结果交给草稿。`test-results/companion-tools-layout` 有 390×480、390×844 新旧页面截图，输入/发送保持可见、工具区域压缩为一行；2 项真实页面交互回归通过，无页面错误。
- `npx expo-modules-autolinking resolve --platform android --json` 已发现 `pet-system-voice` 与原生模块类。
- 隔离 Android 1.0.5/code 6 prebuild 已成功，自动链接、版本/运行时、原始 Manifest、Expo Kotlin 接口与 29 个品牌/生成图片静态检查通过。见 `NATIVE-PREBUILD.md`。实际 Kotlin 编译入口因未配置 JDK 而退出 9009，没有编译通过结论。
- 本模块调用用户指定 `grok-4.6-high` 一次，发生超时，无独立检查结论；未自动重试或换型号。

## 尚未通过

缺少实际 Kotlin/Gradle 编译、目标安卓新 APK 安装与真机识别/朗读验收。必须实测语言缺失、权限拒绝、端侧/系统回退、识别取消、草稿确认、长文本朗读、账号切换、离页及后台停止。隔离编译已尝试，当前会话没有可用 Java；先前项目使用 EAS 构建，因此不据此断言无法构建。expo-system-ui 缺依赖提示、Reanimated/Worklets 配套版本冲突及 SDK patch 已由主整合负责人统一修复，复查 doctor 21/21、npm ls exit 0，第三次隔离 prebuild/自动链接/29资源检查均通过；详见原生检查报告。

原生变化只能随新 APK 与兼容运行时发布，不向 Android 1.0.4 投放依赖此模块的 OTA。T12/A16 保持待原生验收。
