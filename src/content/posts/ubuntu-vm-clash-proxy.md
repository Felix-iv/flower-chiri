---
title: 'Ubuntu 虚拟机通过宿主机 Clash 代理上网配置'
pubDate: '2026-06-30'
description: '记录 Windows 宿主机使用 Clash Verge 为 VMware Ubuntu 虚拟机提供代理的配置方法，包括终端、apt、Git、浏览器代理和排错思路。'
category: '环境配置'
tags:
  - 'Linux'
  - 'proxy'
  - 'git'
slug: 'ubuntu-vm-clash-proxy'
updated: '2026-06-30'
published: true
sync_fastgpt: true
source: 'obsidian'
sourcePath: 'Ubuntu 虚拟机通过宿主机 Clash 代理上网配置.md'
---
# Ubuntu 虚拟机通过宿主机 Clash 代理上网配置

这篇笔记整理 Windows 宿主机使用 Clash Verge，为 VMware 中的 Ubuntu 虚拟机提供代理访问的完整配置。核心思路是：虚拟机不直接连外网，而是把请求发送到宿主机的 VMware 虚拟网卡地址，由宿主机上的 Clash Verge 接管并转发。

## 适用场景

- 宿主机：Windows，使用 Clash Verge。
- 虚拟机：VMware 中的 Ubuntu。
- 目标：让虚拟机终端、`apt`、Git、浏览器都能走宿主机代理。
- 示例代理端口：`7980`。
- 示例宿主机虚拟网关地址：`192.168.137.1`。

> 注意：`192.168.137.1` 是宿主机的 VMware Network Adapter VMnet8 地址，不是虚拟机自己的 IPv4 地址。这个地址通常不会随着 Wi-Fi 网络变化而变化。

## 一、宿主机 Clash Verge 设置

在 Windows 宿主机上打开 Clash Verge：

1. 开启局域网连接 / Allow LAN。
2. 将代理端口设置为需要的端口，这里使用 `7980`。
3. 如遇连接被拒绝，可检查 Windows 防火墙是否拦截。

![](<_assets/ubuntu-vm-clash-proxy-clash-verge.png>)

## 二、虚拟机终端代理配置

在 Ubuntu 虚拟机里，根据你使用的 shell，把下面内容加入 `~/.zshrc` 或 `~/.bashrc`：

```bash
# 定义代理地址变量
export PROXY_ADDR="http://192.168.137.1:7980"

# 一键开启代理
alias pon='
  export http_proxy=$PROXY_ADDR;
  export https_proxy=$PROXY_ADDR;
  export all_proxy="socks5://192.168.137.1:7980";
  echo "Proxy On (7980)";
  curl -I https://www.google.com
'

# 一键关闭代理
alias poff='
  unset http_proxy;
  unset https_proxy;
  unset all_proxy;
  echo "Proxy Off"
'
```

配置完成后执行：

```bash
source ~/.zshrc
# 或
source ~/.bashrc
```

之后可以用：

```bash
pon   # 开启代理
poff  # 关闭代理
```

## 三、确认宿主机虚拟网关地址

在 Windows 宿主机执行 `ipconfig`，找到 VMware Network Adapter VMnet8：

```text
以太网适配器 VMware Network Adapter VMnet8:

连接特定的 DNS 后缀 . . . . . . . :
IPv4 地址 . . . . . . . . . . . . : 192.168.137.1
子网掩码  . . . . . . . . . . . . : 255.255.255.0
默认网关. . . . . . . . . . . . . :
```

虚拟机里的代理地址应使用这里的 IPv4 地址，例如：

```text
http://192.168.137.1:7980
```

不要误填成虚拟机自己的 IPv4 地址。

## 四、apt 代理配置

如果希望 `sudo apt update`、`sudo apt install` 等命令稳定走代理，可以创建或修改：

```text
/etc/apt/apt.conf.d/proxy.conf
```

内容如下：

```text
Acquire {
  HTTP::proxy "http://192.168.137.1:7980";
  HTTPS::proxy "http://192.168.137.1:7980";
}
```

这种方式的特点是：`apt` 会一直使用这个代理，不能跟随 `pon` / `poff` 一键开关。

如果不配置 apt 代理，可能会出现类似网络不可达或连接超时的问题：

![](<_assets/ubuntu-vm-clash-proxy-apt-error-1.png>)

![](<_assets/ubuntu-vm-clash-proxy-apt-error-2.png>)

## 五、Git 代理配置

Git 有自己的代理配置。即使 shell 环境变量已经改成 `7980`，如果 Git 全局配置里仍然写着旧端口，比如 `7890`，Git 仍然会尝试连接旧地址。

### 方案 A：直接设置 Git 全局代理

```bash
git config --global http.proxy http://192.168.137.1:7980
git config --global https.proxy http://192.168.137.1:7980
```

检查配置：

```bash
git config --global --get http.proxy
git config --global --get https.proxy
```

如果返回 `http://192.168.137.1:7980`，说明配置成功。

### 方案 B：取消 Git 硬编码代理，让 Git 跟随环境变量

如果希望 Git 跟随 `pon` / `poff` 开关，建议取消 Git 的全局代理：

```bash
git config --global --unset http.proxy
git config --global --unset https.proxy
```

取消后，Git 会读取当前 shell 的 `http_proxy` / `https_proxy` 环境变量：

- 执行 `pon` 后，Git 走代理。
- 执行 `poff` 后，Git 走直连。

## 六、浏览器代理配置

如果 Ubuntu 虚拟机使用桌面环境，浏览器一般可以跟随系统代理设置。

操作路径大致如下：

1. 打开 Ubuntu 的 Settings / 设置。
2. 进入 Network / 网络。
3. 找到 Network Proxy / 网络代理。
4. 将模式改为 Manual / 手动。
5. 填写代理信息：
   - HTTP Proxy：`192.168.137.1`，Port：`7980`
   - HTTPS Proxy：`192.168.137.1`，Port：`7980`
   - Socks Host：`192.168.137.1`，Port：`7980`（如需要）
6. 保存后重新打开浏览器测试。

> 原始记录里浏览器代理端口曾写成 `7890`，这里按本篇统一配置修正为 `7980`。如果你的 Clash Verge 实际端口不是 `7980`，请全部替换为自己的端口。

## 七、流量的旅行路线

当你在虚拟机里执行：

```bash
curl https://www.google.com
```

流量大致会经过这些环节：

1. **虚拟机内部：环境变量识别**  
   `curl`、`wget`、Git 等程序读取 `http_proxy` / `https_proxy`，发现应该把请求交给 `192.168.137.1:7980`。

2. **虚拟网络传输：跨越虚拟机边界**  
   虚拟机通过 VMware VMnet8 虚拟交换机，把请求发送到宿主机虚拟网卡地址 `192.168.137.1`。

3. **宿主机入口：Clash Verge 接管**  
   Clash Verge 监听 `0.0.0.0:7980`，并且开启 Allow LAN 后，就能接收来自虚拟机的请求。

4. **代理分流：规则、全局或直连**  
   Clash 根据规则判断请求是直连，还是转发给远端代理节点。

5. **物理联网：通过宿主机真实网卡出网**  
   最终流量通过宿主机 Wi-Fi 或有线网卡进入互联网。

6. **数据返回：原路返回虚拟机**  
   响应数据从互联网返回到宿主机 Clash，再经 VMnet8 回到虚拟机终端或浏览器。

## 八、常见故障排查

| 环节 | 关键点 | 常见问题 |
| --- | --- | --- |
| 虚拟机内 | `~/.zshrc` / `~/.bashrc` 环境变量 | 忘记 `source`，或变量没有 `export` |
| 虚拟网关 | `192.168.137.1` | IP 写错，或 VMware 网卡被禁用 |
| 宿主机入口 | `7980` + Allow LAN | 端口写错，或没开启 Allow LAN |
| 宿主机防火墙 | Windows 防火墙 | 连接被拦截，出现 connection refused |
| Clash 核心 | 节点和分流规则 | 节点不可用，或规则导致直连失败 |
| Git | Git 全局代理 | Git 仍使用旧端口，如 `7890` |
| apt | `/etc/apt/apt.conf.d/proxy.conf` | `sudo` 环境下没有读取 shell 代理变量 |

## 九、最终测试

配置完成后建议按顺序测试：

```bash
# 1. 重新加载 shell 配置
source ~/.zshrc
# 或 source ~/.bashrc

# 2. 开启代理
pon

# 3. 测试终端联网
curl -I https://www.google.com

# 4. 测试 Git
git ls-remote https://github.com/git/git.git HEAD

# 5. 测试 apt
sudo apt update
```

如果 `curl` 能看到 HTTP 响应头，Git 能返回远端信息，`apt update` 能正常拉取软件源，就说明代理链路基本配置成功。


- Gemini 对话分享：[gemini整个对话过程](https://gemini.google.com/share/7f71f4a2dcc6)
