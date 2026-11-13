# 文件关系图 · Demo（对应 PRD-GRAPH.md）

离线、单文件、零依赖。**关系图和代码是两个独立窗口**，通过 postMessage 联动。

## 打开顺序

1. 双击 `host-demo.html` —— 这是「代码阅读窗口」的模拟（左文件列表 + 代码区）
2. 点右上「打开关系图（独立窗口）」—— 弹出一个**单独的** 1280×860 窗口
3. 在关系图里**双击节点** → 代码窗口自动切到那个文件
4. 在代码窗口里**切换文件** → 关系图自动聚焦到它（`icn:focus`）

> 浏览器可能拦弹窗：地址栏右侧允许一次即可。

## 里面有什么

| 文件 | 作用 |
|---|---|
| `extract.py` | 扫描器：按 PRD §5 的规则把一个工程扫成「文件节点 + 引用边」，输出 `graph-data.json`，并可把数据注入 HTML |
| `graph.html` | 关系图窗口：力导向 / 树形 / 表格三视图，单文件离线 |
| `host-demo.html` | 代码窗口（模拟）：用来演示两窗口联动 |
| `graph-data.json` | 示例工程的扫描结果（7 文件 / 14 条边） |
| `sample-ic-project/` | 示例工程：Perl + Verilog + Python，含 resolved / missing / external 三种边 |

## 架构决定（本次定稿）

- **图不在代码窗口里**：独立窗口 / 独立页面，代码区不被挤压
- 默认布局：力导向
- 箭头语义：A → B 表示 A 引用 B（箭头指向被依赖方）
- 联动协议：`icn:focus`（代码→图，聚焦文件）、`icn:open-file`（图→代码，打开文件），都用 `window.postMessage`

## 怎么用在自己的工程上

```bash
python extract.py D:/你的工程目录 --html    # 重新生成 graph.html（数据内嵌）
python extract.py D:/你的工程目录           # 只出 graph-data.json
```

## 已实现（对照 PRD）

| PRD 条目 | 状态 |
|---|---|
| §2.1 节点=文件、边={from,to,kind,line,raw,status} | ✅ |
| §2.2 四种边：require / include / instantiate / import | ✅（call 边属 P2，未做） |
| §2.3 三种可信度：resolved 实线 / missing 玫红虚线 / external 折叠 | ✅ |
| §3.1 力导向：圆角卡片、语言色点、箭头、悬停高亮邻居其余 15%、拖拽、滚轮缩放、空白平移 | ✅ |
| §3.2 树形：横向分层、深度可调（1–4）、依赖方向切换 | ✅ |
| §3.3 表格兜底：引用数 / 被引用数 / 依赖文件 | ✅ |
| §4.3 控制条：布局 / 方向 / 深度 / 显示外部依赖 / 重新布局 | ✅（「只看当前文件」未做） |
| §4.4 与批注联动（角标显示批注数） | ⬜ 未做（示例工程没有批注数据） |
| §5 解析规则（Perl/Verilog/Python 正则 + 路径补全） | ✅ |
| §6 边界：自引用不画、重复引用合并 ×N、外部聚合、环形依赖不卡死 | ✅（>200 文件时的 2 跳子图未做） |
| §7 视觉：8px 圆角、12px 等宽文件名、语言色点、1.5px 连线、点阵背景 | ✅ |

## 示例工程的扫描结果

```
文件 7 · 边 14（resolved 5 / missing 3 / external 6）· Verilog 模块 2 个
```

关键几条（可以直接验证 PRD §10 的验收标准）：

```
resolved  include     rtl/sat_alu.sv  -> rtl/defs.svh          line [1]
resolved  include     rtl/tb_top.sv  -> rtl/defs.svh           line [1]
resolved  instantiate rtl/tb_top.sv  -> rtl/sat_alu.sv         line [7]   ← 模块实例化
resolved  import      tools/parse_report.py -> tools/utils.py  line [3]
missing   include     rtl/sat_alu.sv -> missing_localparams.svh line [2]
missing   require     uart_log_tools/check_log.pl -> missing_helper.pl
external  require     uart_log_tools/check_log.pl -> strict
```

## 已验证 / 未验证

- 已验证：扫描器输出正确（三种边、模块实例化、路径补全）、`node --check` 通过、数据注入 HTML 后能被解析（7 nodes / 14 edges）
- 未验证：**浏览器里的实际渲染**——本机 Chromium 启动失败（`exited with code 3`），我没能截图。请你双击打开看一眼。

## 已知限制（demo 阶段）

1. 力导向用朴素 O(n²) 斥力 + 每帧重建 DOM，7–50 个文件没问题，200+ 会卡；正式版应改成节点/边增量更新 + 四叉树。
2. call 边（函数级）未做，PRD 里本来也标 P2。
3. 批注联动（节点角标显示批注数）未接。
4. 扫描是同步的，大工程应改成 worker + 增量缓存（PRD §5 提到的 `icn-graph` 指纹复用还没做）。

## 下一步（你选一个）

- **A**：把 demo 接进 `ic-code-notes` 主应用，作为第三个 tab「关系图」（对应 PRD D-G1 选项 A）
- **B**：做成 Lapce 插件（`.lapce-research/` 里已经有插件 API 的调研）
- **C**：先把 demo 打磨成可对外展示的独立页面（补批注联动、call 边、性能）
