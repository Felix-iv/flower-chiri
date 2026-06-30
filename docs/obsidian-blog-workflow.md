# Obsidian 博客发布流程

## 当前流程

```text
Windows Obsidian Vault
-> GitHub 仓库 obsidian_notesobsidian_notes
-> Linux 服务器 clone / pull
-> 只同步 posts/ 到 Astro 博客
-> pnpm build
-> 静态容器服务 dist/
```

只有 Vault 里的 `posts/` 目录是博客内容源。其他目录是私人笔记或素材区，不应该被发布到博客。

## Windows 端

Obsidian Vault：

```text
D:\Obsidian\SomethingSpecial
```

博客文章目录：

```text
D:\Obsidian\SomethingSpecial\posts
```

文章附件目录：

```text
D:\Obsidian\SomethingSpecial\posts\_assets
```

GitHub 仓库：

```text
https://github.com/Felix-iv/obsidian_notesobsidian_notes.git
```

准备发布到博客的文章建议使用下面的 frontmatter：

```md
---
title: ''
slug: ''
date: ''
updated: ''
published: false
category: ''
tags:
  -
sync_fastgpt: false
summary: ''
---
```

只有当文章确认要发布到博客时，才把 `published` 改成 `true`。

## Linux 端

推荐把 Obsidian Vault 仓库 clone 到：

```text
/home/yim/obsidian_notesobsidian_notes
```

当前服务器已完成：

- 仓库已 clone 到 `/home/yim/obsidian_notesobsidian_notes`；
- GitHub deploy key 已配置并验证可用；
- 该仓库的本地 Git 配置已固定使用 `/home/yim/.ssh/obsidian_notes_readonly`；
- 后续可以直接在服务器执行 `git pull` 更新文章。

在 Astro 博客项目里执行同步和构建：

```bash
git -C /home/yim/obsidian_notesobsidian_notes pull --ff-only

cd /home/yim/flower-chiri
OBSIDIAN_BLOG_SOURCE_DIR=/home/yim/obsidian_notesobsidian_notes/posts pnpm run sync:obsidian
pnpm build
```

同步脚本会做这些事：

- 只读取 `posts/`；
- 跳过 `published: false` 的文章；
- 将文章写入 Astro 的 `src/content/posts/`；
- 将 `date` 映射成 Astro 需要的 `pubDate`；
- 将 `summary` 映射成 `description`；
- 将 `posts/_assets` 复制到 `src/content/posts/_assets`；
- 将图片嵌入 `![[image.png]]` 转成标准 Markdown 图片链接；
- 遇到普通 Obsidian 双链 `[[note]]` 时给出提醒，不自动猜测链接目标。

## GitHub 访问权限

如果笔记仓库是私有仓库，Linux 服务器必须先获得只读权限，才能执行 `git clone` 或 `git pull`。

推荐方式：

1. 给 GitHub 仓库添加只读 deploy key。
2. 使用只读 fine-grained GitHub token。
3. 临时把仓库设为 public。

长期来看，deploy key 最适合这台服务器：权限清晰，只能读取这个仓库，也不需要把个人 GitHub token 放到服务器上。

## 日常写作流程

1. 在 Windows 的 Obsidian 里新建或编辑 `posts/` 下的文章。
2. 图片放到 `posts/_assets/`，文章里可以先用 Obsidian 的 `![[图片名.png]]` 写法。
3. 写完后确认 frontmatter：

```yaml
published: true
sync_fastgpt: false
```

4. 通过 Obsidian Git 插件或命令行提交并 push 到 GitHub。
5. Linux 服务器执行 `git pull`、`pnpm run sync:obsidian`、`pnpm build`。

FastGPT 还没接入前，`sync_fastgpt` 可以先保持 `false`。

## FastGPT 知识库同步

项目提供了博客文章到 FastGPT 知识库的增量同步脚本：

```bash
pnpm run sync:fastgpt
```

它只处理同时满足下面条件的文章：

```yaml
published: true
sync_fastgpt: true
```

同步逻辑：

- 扫描 `src/content/posts/`；
- 读取文章 frontmatter 和正文；
- 计算内容 hash；
- 新文章创建 FastGPT 文本集合；
- 内容变化时删除旧集合并重新创建；
- 文章删除或关闭 `sync_fastgpt` 时删除旧集合；
- 使用 `.fastgpt-sync-state.json` 保存集合 ID 和 hash，避免重复上传。

本地 dry-run 验证：

```bash
pnpm run sync:fastgpt -- --dry-run
```

真实同步前需要配置环境变量：

```bash
FASTGPT_BASE_URL='https://你的-fastgpt-地址'
FASTGPT_API_KEY='你的-api-key'
FASTGPT_DATASET_ID='你的知识库-id'
FASTGPT_BLOG_BASE_URL='https://flower4night.xyz'
```

可选环境变量：

```bash
FASTGPT_PARENT_ID=
FASTGPT_TRAINING_TYPE=chunk
FASTGPT_CHUNK_SETTING_MODE=auto
FASTGPT_QA_PROMPT=
FASTGPT_STATE_FILE=/home/yim/flower-chiri/.fastgpt-sync-state.json
```

`.fastgpt-sync-state.json` 不提交到 Git。它应该保留在服务器本地，因为里面记录了文章对应的 FastGPT collection ID。

部署时默认不会同步 FastGPT。确认 API 配置可用后，可以在 webhook 环境变量里加入：

```bash
FASTGPT_SYNC=1
```

这样 `scripts/deploy-blog` 会在博客构建成功后执行：

```bash
pnpm run sync:fastgpt
```

在没有配置 FastGPT API 前，不要开启 `FASTGPT_SYNC=1`。

## 一键部署

当前项目提供了一键部署脚本：

```bash
cd /home/yim/flower-chiri
pnpm run deploy:blog
```

它会依次执行：

```text
拉取 /home/yim/obsidian_notesobsidian_notes
-> 同步 posts/ 到 src/content/posts/
-> pnpm build
-> 可选同步 FastGPT
-> 可选重启静态容器
```

默认不重启 Docker 容器：

```bash
BLOG_RESTART_CONTAINER=0
```

原因是：如果静态容器是通过 volume 直接挂载 `/home/yim/flower-chiri/dist`，那么 `pnpm build` 写入新的 `dist/` 后，Nginx 一般会直接读到新文件，不需要重启。

只有在下面这些情况才需要重启或重建容器：

- 线上页面仍然是旧内容；
- 容器不是挂载 `dist/`，而是把构建产物复制进镜像；
- 静态服务或缓存层没有及时刷新文件。

如果确认需要重启静态容器，可以这样执行：

```bash
BLOG_RESTART_CONTAINER=1 BLOG_STATIC_CONTAINER=flower-chiri-static pnpm run deploy:blog
```

如果当前用户没有 Docker 权限，可能还需要单独处理 sudo 或容器权限。

## GitHub Webhook 自动部署

目标流程：

```text
Windows Obsidian push
-> GitHub 仓库触发 webhook
-> Linux webhook 服务校验签名
-> 执行 scripts/deploy-blog
-> 博客自动构建
```

项目里已经提供 webhook 服务：

```bash
pnpm run webhook:obsidian
```

需要的环境变量：

```bash
BLOG_WEBHOOK_SECRET='一段很长的随机字符串'
BLOG_WEBHOOK_HOST=127.0.0.1
BLOG_WEBHOOK_PORT=3210
BLOG_WEBHOOK_PATH=/github/obsidian-webhook
```

如果 webhook 服务需要被 Docker 里的 Nginx Proxy Manager 访问，通常要让服务监听宿主机所有网卡：

```bash
BLOG_WEBHOOK_HOST=0.0.0.0
```

GitHub 仓库配置：

```text
Settings -> Webhooks -> Add webhook
Payload URL: https://flower4night.xyz/github/obsidian-webhook
Content type: application/json
Secret: 和 BLOG_WEBHOOK_SECRET 完全一致
Events: Just the push event
Active: 勾选
```

如果继续使用 Nginx Proxy Manager，需要给 `flower4night.xyz` 增加一个 Custom Location：

```text
Location: /github/obsidian-webhook
Forward Hostname / IP: 172.18.0.1
Forward Port: 3210
Scheme: http
```

`172.18.0.1` 是当前 Nginx Proxy Manager 配置里已经使用过的宿主机地址。如果后续 Docker 网络变化，需要按实际地址调整。

建议用 PM2 或 systemd 托管 webhook 服务。示例 PM2 命令：

```bash
cd /home/yim/flower-chiri
BLOG_WEBHOOK_SECRET='一段很长的随机字符串' BLOG_WEBHOOK_HOST=0.0.0.0 BLOG_WEBHOOK_PORT=3210 pm2 start "pnpm run webhook:obsidian" --name flower-chiri-obsidian-webhook --time
pm2 save
```

当前服务器已完成：

- webhook 服务已由 PM2 托管，进程名为 `flower-chiri-obsidian-webhook`；
- webhook 服务监听 `0.0.0.0:3210`；
- webhook secret 保存在 `/home/yim/.config/flower-chiri/webhook.env`，没有提交进 Git；
- PM2 进程列表已 `pm2 save`。

如果希望 VPS 重启后自动恢复 PM2 进程，还需要在服务器上执行 PM2 提示的 `sudo pm2 startup` 命令。当前提示为：

```bash
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u yim --hp /home/yim
```

注意：不要把真实 `BLOG_WEBHOOK_SECRET` 提交到 Git。
