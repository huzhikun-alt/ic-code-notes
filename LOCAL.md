# 本地使用说明（内网 API 场景）

这个包是纯静态页面，**不需要安装任何东西**，双击 `start.cmd` 就能用。

## 最快路径

1. 解压 zip 到任意目录（路径别有中文空格问题不大，但避免放在需要管理员权限的目录）
2. 双击 **`start.cmd`**
3. 浏览器会自动打开 `http://127.0.0.1:8710/`

关闭那个黑窗口就停止服务。

## 为什么不能直接双击 index.html

可以直接双击，**读代码、写批注、用配色都不受影响**。

但你要接**内网 API**，直接打开是 `file://` 协议，浏览器会以 `null` 源发请求，绝大多数服务端会因 CORS 拒绝。用 `start.cmd` 起本地服务后，页面源变成 `http://127.0.0.1:8710`，内网接口只要允许该源即可正常调用。

## 内网 API 怎么填

点页面顶部 `✦ AI` → 「接入设置」：

| 字段 | 填什么 |
|---|---|
| 服务商 | 选「自定义」 |
| Base URL | 你内网网关的兼容地址，例如 `http://10.x.x.x:8000/v1` |
| API Key | 内网 Key（只存在你本机 localStorage） |
| 模型 | 内网部署的模型名 |

页面按 **OpenAI Chat Completions 兼容格式**发请求：`POST {BaseURL}/chat/completions`。

如果你的网关路径不同，可以直接把完整地址填在 Base URL 里（不要带结尾斜杠）。

## 内网服务端需要允许的来源

```
Origin: http://127.0.0.1:8710
Access-Control-Allow-Origin: http://127.0.0.1:8710
Access-Control-Allow-Headers: authorization, content-type
```

如果网关无法改 CORS，可以让运维加一条反向代理，或在本机用 nginx 把 `/v1` 转发过去（这样同源，无需 CORS）。

## 数据存在哪

- 工程/批注/函数库：浏览器 localStorage（`icn-*`）
- AI Key 与偏好：同一处
- **换浏览器或清缓存会丢**，请定期用左侧「导出」备份 JSON

## 文件清单

| 文件 | 作用 |
|---|---|
| `index.html` | 页面本体 |
| `ui-refresh.css` / `presets.css` / `ai.css` | 样式与配色 |
| `ui-refresh.js` / `ai.js` | 交互与 AI 侧栏 |
| `icons.svg` | Lucide 图标（已内联进 index.html，可删） |
| `start.cmd` | 一键启动本地服务 |
| `serve.ps1` | 无 Python 时的备用服务 |

## 常见问题

**端口被占用**：改 `start.cmd` 里的 `set PORT=8710` 为其它端口。

**提示找不到 Python**：脚本会自动切到 PowerShell 方案，无需处理。

**打开后是旧界面**：本地服务已带 `Cache-Control: no-store`，正常不会缓存；如果仍异常，`Ctrl+Shift+R`。
