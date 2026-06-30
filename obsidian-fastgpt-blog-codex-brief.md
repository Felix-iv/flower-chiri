# Obsidian + Linux 博客 + FastGPT Chatbot 开发交接说明

## 背景

我准备把个人博客的写作和 AI 知识库流程改成：

```text
Obsidian 写 Markdown 笔记
-> 只发布指定文章到博客
-> Linux 服务器自动部署博客
-> 自动同步指定文章到 FastGPT 知识库
-> 博客接入 FastGPT Chatbot
```

目标是避免以前的手动流程：

```text
Notion 写笔记 -> Linux 新建 md 模板 -> 复制粘贴 -> 发布
```

现在希望以 Obsidian 的 Markdown 文件作为唯一内容源，博客和 FastGPT 知识库都从这批 Markdown 里自动更新。

## 总目标

请在 Linux 服务器里帮我完成或逐步搭建这套工作流：

1. 确认当前博客项目类型、目录结构和部署方式。
2. 设计 Obsidian 文章目录和博客文章目录的同步方式。
3. 实现只发布指定 Markdown 文章到博客。
4. 实现博客自动部署。
5. 实现指定文章自动同步到 FastGPT 知识库。
6. 在博客中接入 FastGPT Chatbot。

优先级：先让 Obsidian -> 博客发布跑通，再做 FastGPT 自动同步，最后优化 Chatbot 前端体验。

## 需要先确认的信息

请先检查并向我确认这些信息，不要直接假设。

### 1. 博客框架

确认我的博客使用的是什么框架，例如：

- Hexo
- Hugo
- VitePress
- VuePress
- Astro
- Next.js
- Nuxt
- WordPress
- Halo
- Typecho
- 自写静态站
- 其他

需要确认：

- 博客项目根目录在哪里。
- 文章 Markdown 应该放在哪个目录。
- 静态资源、图片应该放在哪个目录。
- 构建命令是什么。
- 发布目录是什么。

常见示例：

```text
Hexo:      source/_posts/
Hugo:      content/posts/
VitePress: docs/ 或 docs/posts/
Astro:     src/content/blog/
Next.js:   content/posts/ 或 app/blog/
```

### 2. 当前部署方式

请确认博客现在是怎么部署到 Linux 的：

- 手动在服务器编辑 Markdown 后构建？
- Git pull 后构建？
- GitHub Actions / GitLab CI / Gitea Actions 自动部署？
- Nginx 直接服务静态文件？
- Docker / Docker Compose？
- PM2 / systemd 运行 Node 服务？

需要确认：

- Web 根目录。
- Nginx 配置位置。
- 构建产物目录。
- 当前是否已经有自动部署脚本。
- 是否有域名和 HTTPS。

### 3. Obsidian Vault 放置方式

需要决定 Obsidian 文件和博客源码的关系。

推荐方案：Obsidian Vault 独立，发布时同步到博客仓库。

```text
Obsidian Vault:
~/notes/
  00-inbox/
  10-notes/
  20-blog/
  90-assets/
  templates/

博客仓库:
~/blog/
  content/posts/       # 或实际框架对应目录
  public/              # 或实际静态资源目录
```

也可以让 Obsidian 直接打开博客文章目录，但我更倾向于独立 Vault，避免私人笔记和博客工程混在一起。

请确认：

- Obsidian Vault 是否也放在 Linux 上。
- 是否通过 Git 同步 Obsidian Vault。
- 本地电脑和 Linux 之间怎么同步笔记：Git、Syncthing、SFTP、坚果云、其他。

### 4. FastGPT 信息

请确认：

- 使用 FastGPT 云服务还是自部署 FastGPT。
- FastGPT 地址。
- 是否已有应用 App。
- 是否已有知识库 Dataset。
- 是否有可用 API Key。
- FastGPT 版本是否支持知识库 OpenAPI。
- 是否允许在服务器环境变量中保存 API Key。

API Key 不能写死到前端代码里，只能放在服务器环境变量或安全配置文件中。

### 5. Chatbot 接入方式

先确认我想使用哪种方式：

- 快速方案：FastGPT 分享链接 / iframe 嵌入博客。
- 正式方案：博客自定义聊天组件，请求服务器 `/api/chat`，服务器再转发到 FastGPT。

推荐顺序：先 iframe 跑通，再做自定义聊天组件。

## 推荐的 Obsidian 目录结构

建议建立：

```text
~/notes/
  00-inbox/        # 临时想法，不发布
  10-notes/        # 私人笔记，不发布
  20-blog/         # 博客文章候选区
  90-assets/       # 图片和附件
  templates/       # 模板
```

只有 `20-blog/` 中满足 frontmatter 条件的文章才允许发布到博客。

## 推荐的文章 frontmatter

每篇准备发布的博客文章建议使用：

```md
---
title: FastGPT 接入博客实践
slug: fastgpt-blog-chatbot
date: 2026-06-25
updated: 2026-06-25
published: true
category: AI
tags:
  - FastGPT
  - Blog
  - Obsidian
sync_fastgpt: true
summary: 用 FastGPT 给个人博客接入基于笔记知识库的 Chatbot。
---

正文内容……
```

字段含义：

- `published: true`：允许同步到博客。
- `sync_fastgpt: true`：允许同步到 FastGPT 知识库。
- `slug`：文章唯一标识，也可作为 URL 路径。
- `title`：文章标题。
- `date`：发布时间。
- `updated`：更新时间。
- `category` / `tags`：博客分类标签。
- `summary`：摘要。

草稿文章使用：

```md
published: false
sync_fastgpt: false
```

## 推荐的 Obsidian 模板

可以创建 `templates/blog-post.md`：

```md
---
title: ""
slug: ""
date: ""
updated: ""
published: false
category: ""
tags:
  - 
sync_fastgpt: false
summary: ""
---

# 标题

```

如果使用 Obsidian Templater 插件，可以再改造成自动填充日期和标题。

## 阶段一：先跑通 Obsidian 到博客发布

请先实现一个同步脚本，功能如下：

1. 扫描 Obsidian Vault 的 `20-blog/` 目录。
2. 解析 Markdown frontmatter。
3. 只处理 `published: true` 的文章。
4. 将文章复制或转换到博客对应文章目录。
5. 根据博客框架调整 frontmatter 格式。
6. 处理图片路径。
7. 输出同步日志。

建议脚本名：

```text
scripts/sync-obsidian-to-blog.js
```

或：

```text
scripts/sync-obsidian-to-blog.py
```

语言优先选择项目现有技术栈。如果博客是 Node 项目，优先 Node.js；如果已有 Python 运维脚本，也可以 Python。

需要注意：

- 不要发布 `published: false` 的文章。
- 不要发布 `00-inbox/`、`10-notes/` 里的私人笔记。
- 图片路径要能在博客中正确显示。
- Obsidian 双链 `[[xxx]]` 如果出现在博客文章里，需要转换或提醒我手动处理。

## 阶段二：博客自动部署

请根据当前部署方式选择合适方案。

### 方案 A：Git pull + 构建

如果博客项目在 Linux 上，可以做：

```text
git pull
运行同步脚本
运行构建命令
重载服务或更新静态目录
```

可以用：

- shell 脚本
- systemd service
- git webhook
- cron
- CI/CD

### 方案 B：GitHub Actions / GitLab CI

如果博客仓库托管在 GitHub/GitLab，可以让 CI：

```text
checkout
安装依赖
运行同步脚本
构建博客
rsync/scp 到服务器
reload nginx
```

### 方案 C：服务器 webhook

本地 Obsidian Git push 后，服务器收到 webhook 自动：

```text
pull notes repo
pull blog repo
sync
build
deploy
sync FastGPT
```

先选择最简单、最适合当前服务器现状的方式。

## 阶段三：同步 FastGPT 知识库

在博客发布跑通之后，再实现 FastGPT 同步。

同步逻辑：

1. 扫描已发布博客文章。
2. 只处理 `published: true` 且 `sync_fastgpt: true` 的文章。
3. 提取文章正文和元数据。
4. 计算内容 hash。
5. 对比上次同步状态。
6. 新文章：上传到 FastGPT 知识库。
7. 修改文章：更新 FastGPT 知识库文档。
8. 删除文章或关闭 `sync_fastgpt`：从 FastGPT 知识库删除或禁用。

建议保存同步状态文件：

```text
.fastgpt-sync-state.json
```

示例结构：

```json
{
  "fastgpt-blog-chatbot": {
    "file": "20-blog/fastgpt-blog-chatbot.md",
    "title": "FastGPT 接入博客实践",
    "hash": "abc123",
    "fastgptDocumentId": "xxx",
    "lastSyncedAt": "2026-06-25T12:00:00+08:00"
  }
}
```

建议脚本名：

```text
scripts/sync-blog-to-fastgpt.js
```

或：

```text
scripts/sync-blog-to-fastgpt.py
```

环境变量建议：

```bash
FASTGPT_BASE_URL="https://你的-fastgpt-地址"
FASTGPT_API_KEY="你的-api-key"
FASTGPT_DATASET_ID="你的知识库-id"
```

安全要求：

- 不要把 API Key 提交到 Git。
- 使用 `.env` 时，必须加入 `.gitignore`。
- 服务器生产环境优先使用 systemd environment、Docker secrets、CI secrets 或受限权限配置文件。

## 阶段四：博客接入 Chatbot

先做快速版：

1. 在 FastGPT 创建应用。
2. 绑定知识库。
3. 配置提示词，例如：

```text
你是我的个人博客助手。请优先基于博客知识库回答问题。如果知识库没有相关内容，请明确说明没有找到对应笔记，不要编造。回答应简洁、友好，并尽量引用相关文章标题。
```

4. 使用 FastGPT 分享链接或 iframe 嵌入博客。

再做正式版：

```text
博客前端聊天组件
-> 请求服务器 /api/chat
-> 服务器携带 API Key 请求 FastGPT
-> 返回流式或非流式回答
```

正式版要求：

- API Key 只在服务器端。
- 支持基础限流。
- 支持错误提示。
- 最好支持引用来源展示。
- UI 不要遮挡博客正文。
- 移动端可用。

## 推荐实现顺序

请按这个顺序执行：

1. 检查博客项目结构和部署方式。
2. 确认 Obsidian Vault 路径和博客文章目标目录。
3. 制定 frontmatter 规范。
4. 写一个测试文章。
5. 写 Obsidian -> 博客同步脚本。
6. 手动运行同步脚本，确认文章能正常显示。
7. 接入自动部署。
8. 手动创建 FastGPT 知识库和应用。
9. 写博客 -> FastGPT 知识库同步脚本。
10. 先用 iframe 接入 Chatbot。
11. 再考虑自定义聊天组件。

## 希望 Codex 交付的内容

请尽量交付这些文件或改动：

1. `scripts/sync-obsidian-to-blog.*`
   - 从 Obsidian 发布目录同步文章到博客目录。

2. `scripts/sync-blog-to-fastgpt.*`
   - 将允许同步的文章增量更新到 FastGPT 知识库。

3. `.env.example`
   - 说明需要配置哪些环境变量。

4. `README` 或 `docs/obsidian-fastgpt-workflow.md`
   - 说明如何写文章、如何发布、如何同步知识库。

5. 自动部署脚本或 CI 配置
   - 根据当前项目实际情况选择。

6. Chatbot 嵌入代码
   - 先 iframe，后续可升级为自定义组件。

## 测试清单

完成后请用以下场景测试：

1. `published: false` 的文章不会出现在博客。
2. `published: true` 的文章能出现在博客。
3. 修改文章后重新同步，博客内容会更新。
4. 图片能正常显示。
5. 带中文文件名或中文标题的文章能正常处理。
6. `sync_fastgpt: false` 的文章不会进入 FastGPT 知识库。
7. `sync_fastgpt: true` 的文章会进入 FastGPT 知识库。
8. 修改文章后 FastGPT 知识库会更新，而不是重复创建很多份。
9. 删除文章或关闭 `sync_fastgpt` 后，知识库能同步删除或禁用。
10. 博客上的 Chatbot 能回答已同步文章中的问题。
11. Chatbot 不知道的问题会明确说明不知道，不要编造。

## 需要避免的事情

请避免：

- 把所有 Obsidian 笔记无条件发布到博客。
- 把私人笔记同步到 FastGPT。
- 把 FastGPT API Key 写进前端代码。
- 把 `.env`、token、私钥提交到 Git。
- 直接在 Linux 上长期手动编辑博客 Markdown。
- 重复上传同一篇文章导致知识库里出现多份重复内容。
- 在没有确认博客框架前强行写死目录。

## 当前我倾向的最终流程

最终我希望日常使用是这样：

```text
1. 在 Obsidian 里写文章。
2. 写完后设置：
   published: true
   sync_fastgpt: true 或 false
3. Git push 或触发同步。
4. Linux 自动构建并发布博客。
5. 同步脚本自动更新 FastGPT 知识库。
6. 博客 Chatbot 使用最新知识库回答访客问题。
```

## 给 Codex 的第一步指令

请先不要大规模修改代码。先在 Linux 服务器上执行项目检查，并告诉我：

1. 当前博客是什么框架。
2. 博客根目录、文章目录、静态资源目录分别是什么。
3. 当前构建和部署命令是什么。
4. 最适合使用 Node.js 还是 Python 写同步脚本。
5. Obsidian Vault 应该如何放置或同步到服务器。
6. FastGPT 自动同步需要哪些 API 信息。

确认这些之后，再开始实现第一阶段：Obsidian `20-blog/` 到博客文章目录的同步脚本。
