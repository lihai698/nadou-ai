# CLI Services

This folder keeps third-party CLI setup scripts grouped by platform.

## OpenAI Codex CLI

- Windows install/update: `CLI/windows/openai/1-install_openai_codex_cli.bat`
- Windows start/sign in: `CLI/windows/openai/2-start_openai_codex_cli.bat`
- macOS: `CLI/macos/openai/install_openai_codex_cli.command`
- Linux: `CLI/linux/openai/install_openai_codex_cli.sh`

After installation, open a new terminal and run:

```bash
codex
```

The first run prompts you to sign in with a ChatGPT account or an API key.

Windows 启动器在管理员窗口中自动使用 `--no-daemon`，避免 Codex 0.160.1 因后台服务不允许管理员权限而退出。CLI 退出后保留窗口和退出码；按任意键关闭。网页中的 GPT CLI 使用非交互命令，不需要先打开这个窗口。

API 设置中的 GPT CLI「验证地址」和「拉取模型」通过本机 CLI 的 `model/list` 读取当前可见聊天模型，不再只返回 `gpt-5.5` 默认值。拉取后在「选择模型」中勾选并导入，再保存；画布和 GPT 对话会同步已保存的列表。列表验证成功不代表所有模型都已实际调用或生图已通过验证。

生图工具不接受 `1K` 尺寸代号。程序将 1K 方图转换为 `1024x1024`，具体宽高按原比例传入；自动尺寸传 `auto`，2K/4K 代号保持不变。在线生图、GPT 对话和画布共用此转换入口。

Windows 生图进程继承系统已启用的代理；手动设置的代理环境变量优先。程序只为子进程补充代理环境变量，不改动系统网络设置。

ChatGPT 登录方式的图片请求由 Codex 调度模型调用 `image_generation` 工具，最终图片模型仍是 `gpt-image-2`。调度模型读取当前 CLI 模型目录，不再固定为旧 `gpt-5.4`；账号实际权限和额度由官方服务判断。

GPT CLI 生图和模型读取使用当前登录的官方 ChatGPT 订阅账号。模型读取为当前子进程指定官方 provider，不修改用户本机 Codex 的中转站配置；模型列表不是剩余额度查询。

## Gemini CLI

- Windows install/update: `CLI/windows/gemini/1-install_gemini_cli.bat`
- Windows start/sign in: `CLI/windows/gemini/2-start_gemini_cli.bat`

After installation, open a new terminal and run:

```bash
gemini
```

The first run prompts you to sign in with your Google account or configure Gemini authentication.

## Jimeng CLI

- Windows install/update: `CLI/windows/jimeng/install_jimeng_cli.bat`
- Windows login/check: `CLI/windows/jimeng/login_jimeng_cli.bat`
- Windows WSL Ubuntu helper: `CLI/windows/jimeng/install_wsl_ubuntu.bat`
- macOS install/update: `CLI/macos/jimeng/install_jimeng_cli.command`
- macOS login/check: `CLI/macos/jimeng/login_jimeng_cli.command`

Root-level scripts are kept as compatibility launchers.
