# 透明形象处理服务恢复

2026-09-21 Windows 桌宠专项验收时，新透明任务停留 queued 超过两分钟。进程核对确认旧 worker 已退出，启动脚本依赖的 `%TEMP%/pet-transparent-validation` Python 可执行文件和模型文件缺失。未从任务排队状态宣称透明图处理成功，失败合成账号与任务已清理。

新增 `scripts/setup-pet-transparent-worker.ps1`，按现有 Python 3.13 依赖锁和模型锁重建环境。默认位置改为 `%LOCALAPPDATA%/PetCompanion/transparent-runtime`，避免临时目录清理导致运行资源丢失。启动仍复用本机已有 DPAPI 加密的受限 worker 凭据，不写进命令行或仓库。

设置脚本：

- 使用既有 requirements.lock 和 require-hashes，不升级 rembg 或模型。
- 明确安装 rembg 2.0.67、isnet-general-use；模型178648008字节，SHA256 `60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a`。
- 从锁文件的官方发布地址下载到临时文件，长度与 SHA256 匹配才移动到正式模型路径；启动前再次检查 MD5/SHA256。
- 将 Windows 重定向 AppData 的 Python 路径解析为真实路径，并采用复制模式安装，避免跨盘原子移动失败。
- 将 Numba 编译缓存放到解析后的用户目录 `.pet-companion-cache/numba`，避免 MSIX 重定向的跨盘写入和过长路径；安装结束实际导入 rembg/ONNX Runtime，不能仅凭安装成功判断可处理。
- 不自动配置开机启动、不更改系统代理、不使用生成式重绘替代去底。

本机恢复命令：

```powershell
./scripts/setup-pet-transparent-worker.ps1
./scripts/start-pet-transparent-worker.ps1
```

固定依赖安装及模型校验已通过，worker 五项本地测试通过。本地实际处理样本输出与此前人工审核文件完全一致，SHA256 为 `96ae7d0045bbbcb0ea093af68a2e2713aa8886206eea2180a141bb477fb7345d`，证据为 `test-results/transparent-runtime-synthetic.json`。

云端也已通过真实任务处理：合成账号按正常 request → worker → candidate → 本人 approve 流程完成，未批准前不作为正式本体。`test-results/desktop-overlay-95f4696b-3a0c-4c0a-a13e-242072fabcd6/report.json` 中任务耗时 22.240 秒、输出校验值一致且账号已清理。此报告的桌面窗口检查失败，因此只作为透明处理证据，不作为完整桌宠通过记录。后一次处理耗时 17.573 秒，仍为单样本，不代表服务 P95。

这仍是依赖电脑在线的试用处理方式，未配置开机自启。桌面交互和毛发、多附肢、半透明部位的多样本质量需要分别验收，不能从一个样本推断全部通过。
