# Tailscale + VNC 远程桌面指南

## 网络拓扑

| 设备 | Tailscale IP | 系统 |
|------|-------------|------|
| 本机 (Windows) | `100.92.132.35` | Windows 11 |
| 远程 Mac (wangchengdemac-mini) | `100.100.201.16` | macOS |

两台设备在同一 Tailscale 网络 (wangchenggv@)，局域网直连，延迟 6-10ms。

## 远程桌面连接

### 前置条件

1. **Mac 端**：系统设置 → 通用 → 共享 → 开启「屏幕共享」
2. **Windows 端**：安装 RealVNC Viewer（TightVNC 窗口显示有兼容问题，不推荐）

### 连接方式

```bash
# 启动 RealVNC Viewer
"C:\Program Files\RealVNC\VNC Viewer\vncviewer.exe" 100.100.201.16::5900
```

- **用户名**: `wangcheng`（VNC 连接后需要手动输入用户名，不是自动填充）
- **密码**: Mac 登录密码

### 可保存地址

在 RealVNC Viewer 中添加书签：
- 地址：`100.100.201.16::5900`
- 名称：Mac Mini

## 故障排查

### 检查连通性

```bash
tailscale status                          # 查看所有设备状态
tailscale ping wangchengdemac-mini        # 测试 Tailscale 连通
powershell -Command "Test-NetConnection -ComputerName 100.100.201.16 -Port 5900"  # 测试 VNC 端口
```

### 常见问题

- **端口 5900 不通**：Mac 未开启屏幕共享
- **认证失败**：用户名是 `wangcheng`（不是 Tailscale 账号 `wangchenggv`）
- **TightVNC 窗口不显示**：兼容性问题，换用 RealVNC Viewer
