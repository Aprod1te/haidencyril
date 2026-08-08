# Haidencyril

Haidencyril 是一个面向个人使用的 Obsidian 插件：把随手留下的想法、问题、反馈和行动记录，逐渐整理成可追溯的理解、项目与下一步行动。

当前版本是 `0.1.0`，完成了第一条最小闭环：

1. 不分类地记录碎片。
2. 在跨端工作台中回看收件箱。
3. 分析前先留下自己的初步判断和不确定点。
4. 生成结构化“分析账本”，对照人的判断与系统判断。
5. 区分事实、解释、未知信息、待思考问题和可能联系。
6. 保留原始笔记，并将每一次分析作为独立 Markdown 文件保存。

## 设计原则

- 原始记录是唯一事实来源，AI 不静默改写原文。
- 自动化信息劳动，保留人的判断劳动。
- 模糊反馈只生成待验证假设，不直接变成结论。
- 日期和日程属于高影响决策，写入前必须由用户确认。
- 个人数据留在 Obsidian Vault；GitHub 仓库只公开程序代码。

## 安装开发版本

1. 安装 Obsidian `1.11.5` 或更新版本。
2. 克隆本仓库并安装依赖：

   ```bash
   npm install
   npm run build
   ```

3. 将 `manifest.json`、`main.js`、`styles.css` 放入：

   ```text
   <你的 Vault>/.obsidian/plugins/haidencyril/
   ```

4. 在 Obsidian 中进入 **设置 → 第三方插件**，启用 **Haidencyril**。

开发时不要直接使用主知识库。按照 Obsidian 官方建议，先准备一个独立测试 Vault。

## 使用本地 AI 分析

AI 分析完全在 Mac 本地运行，不需要 API Key 或付费账号：

1. 安装并启动 [Ollama](https://ollama.com/download)。
2. 在终端运行 `ollama pull qwen3.5:9b` 下载模型。
3. 进入 **设置 → Haidencyril**，确认已开启 **启用本地 AI 分析**。
4. 点击碎片上的 **共同分析**。

只有主动分析时，当前碎片和最多 4 条本地候选笔记摘录才会交给本机 Ollama。插件不包含遥测、广告或后台上传。iPhone 和 iPad 可以继续记录、同步和浏览笔记；当前版本只在运行 Ollama 的 Mac 上生成 AI 分析。

## 常用命令

- **Haidencyril: 打开工作台**
- **Haidencyril: 记录一个碎片**

## 开发命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 监听源码并生成开发版 `main.js` |
| `npm run build` | 运行 TypeScript 检查并构建生产包 |
| `npm run lint` | 执行 Obsidian 官方规则与 ESLint 检查 |

产品边界见 [产品说明](docs/PRODUCT.md)，架构理由见 [架构决策](docs/ARCHITECTURE.md)，数据处理见 [隐私说明](docs/PRIVACY.md)。

## License

[MIT](LICENSE)
