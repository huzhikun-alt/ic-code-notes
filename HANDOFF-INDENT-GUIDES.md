# 交接文档 · 缩进参考线（括号作用域线）1:1 复刻

> 目的：当前实现的位置和样式都与参考图差距很大，需要在新会话中**按参考图 1:1 重做**。
> 参考图：`docs/reference-indent-guides.png`（1020×1214，深色主题编辑器截图）
> 本文档自包含：读完即可开工，不需要回看之前的对话。

> **2026-11-07 实际使用反馈后的调整（已落地，以此为准）**
> - 每一级一条线，画在**该级缩进边界再往左 2px**；位于折叠箭头右侧，不压到代码文字。
> - 活动范围线落在**所在块的缩进左边界再往左 2px**，同样不压到代码。
> - 折叠箭头缩小；点击箭头可**折叠/展开**。
> - 折叠行显示 `… (N 行已折叠)`，gutter 显示 `⋮`；输入、回车、粘贴时自动展开并写回原位置。
> - 活动块范围线高亮在**当前块内容缩进列**上。

---

## 1. 项目背景（30 秒版）

一个**单文件离线网页**：读 IC 代码（Perl / Verilog / Python）、写个人笔记。

| 文件 | 作用 |
|---|---|
| `index.html` | 页面骨架 + 主脚本（状态、存储、导航、函数库、撤销） |
| `ed.js` / `ed.css` | **代码编辑器本体**（重点） |
| `guides.js` | **本次要重做的缩进参考线**（当前版本不合格） |
| `ai.js` / `ai.css` | AI 侧栏 |
| `mindmap.js` / `graph.js` | 结构图 / 关系图 |
| `indent.js` | 回车自动缩进 |
| `verify-editor.py` | 验收测试（19 项，必须保持全绿） |

### 编辑器架构（关键）

代码区**不是**一行一个 div，而是：

```
.ed (flex)
├── .ed-gutter        行号列（固定 54px）
├── .ed-main          代码列
│   ├── pre.ed-hl     语法高亮层（真实文字颜色，pointer-events:none）
│   ├── svg.ed-guides 缩进参考线层（本次目标，z-index:1）
│   └── textarea.ed-input  透明文字 + 可见光标，原生选择/输入（z-index 之上）
└── （笔记列已删除，笔记改为行内 # // 注释）
```

- 字体：`13px/22px var(--mono)`，`white-space:pre`，**不换行**，`tab-size:4`
- 内边距：`padding: 16px 24px 60px`（上 / 左右 / 下）
- 行高常量：`LH = 22`，顶部内边距 `PAD_T = 16`，左内边距 `PAD_L = 24`
- 三层共用同一套字体与 padding，所以**文字坐标可直接按"列 × 字符宽"算**
- 滚动同步：`ed.js` 的 `syncScroll()` 把 `hl` / `gutter` / `guides` 一起 `translate(-scrollLeft, -scrollTop)`

### 扩展钩子

```js
ED.afterRender(fn)   // 每次重绘（输入、切换文件、滚动后）都会调用，guides 在这里重画
```

---

## 2. 要复刻的效果（参考图逐项拆解）

参考图是一个 VS Code / JetBrains 风格的编辑器：

1. **每一级缩进都有一条竖线**，不是"每个块一条"。
   - 第 1 级在列 4、第 2 级在列 8、第 3 级在列 12……
   - 同一条竖线在整段作用域内**连续贯通**，遇到块结束就停。
2. 竖线**紧贴在对应缩进处的文字左侧**，视觉上像"文字的左边界参考线"。
3. 块起始行有一个**折叠箭头 `∨`**，位置与竖线同一条 x，**在行号与文字之间的空隙里**，不与代码字符重叠。
4. 竖线很细（1px），颜色比正文暗很多但清晰可见；嵌套越深颜色基本一致（参考图没有明显深浅变化）。
5. 参考图红框圈出的正是「折叠箭头列 + 竖线列」所在的窄条区域。

### 目标示意（Perl）

```
行号 │  ∨  while (my $l = <STDIN>) {
   6 │  │      chomp $l;
   7 │  │      if ($l =~ /x/) {
   8 │  │      │   do_something();
   9 │  │      }
  10 │  │      ...
  11 │  }
```

- `while` 那一行的 `∨` 在列 0 的位置（块头所在缩进）
- 竖线在列 4（块内容的缩进）
- `if` 行的 `∨` 在列 4，内层竖线在列 8

---

## 3. 当前实现为什么不对（已确认的问题）

`guides.js` 现有逻辑的问题：

| 问题 | 说明 |
|---|---|
| **一个块只画一条线** | 现在按"块"画，而不是按"缩进级"画。多层嵌套时只看到最内层那条，参考图是每级都有 |
| **x 坐标算错** | 现在用离屏 `<span>` 测 `charW`，再 `PAD_L + col*charW - 4`。离屏 span 的字体继承链与 `.ed-hl` 不一定一致，且 `-4` 是拍脑袋的偏移，导致线**压在文字上或偏离文字** |
| **没有折叠箭头** | 参考图的 `∨` 完全没有 |
| **颜色太淡** | `#c8d2e0` 在白底上几乎看不见；参考图是对比明显但克制的灰 |
| **列的语义混乱** | Verilog 分支里用 `indentOf(raw)+2`，Perl 里 `+2`，单位是"空格数"而不是"视觉列"，遇到 Tab 就错位 |
| **没有按行区间合并** | 同一级的多段作用域会画成多条独立线，中间断开 |
| **没有 hover 反馈** | 参考图（VS Code）鼠标悬停会加粗当前级 |

---

## 4. 正确做法（建议直接照这个实现）

### 4.1 核心思路：按"行 × 缩进级"生成线段

不要从"块"出发，改成**逐行扫描缩进级**，把相邻行同一级的线连成一段：

```
for 每一行 i:
    levels[i] = 这一行的缩进级 = 视觉列数 / 缩进单位（向下取整）
    # 视觉列数要先把 Tab 展开成 tabSize 个空格
for 每一级 L:
    # 在所有 levels[i] >= L 的连续区间里画一条线
    scan i from 0..n: 若 levels[i] >= L 则延长当前段，否则结束当前段
```

这条规则天然处理：
- 每个缩进级都有一条线（解决"只画一条"）
- 块结束自动断线（`}` / `end` 行缩进降级）
- 多层嵌套自然出现多条线
- 空行不打断（空行视为"沿用上一行的级"，VS Code 就是这样）

### 4.2 x 坐标必须实测，不要用字符宽估算

```js
// 取第 1 行第一个字符的真实左边界
const line0 = 第一行文本节点;
const r = document.createRange();
r.setStart(line0, 0); r.setEnd(line0, 1);
const charLeft = r.getBoundingClientRect().left;   // 视口坐标
// 转成 .ed-main 内坐标：减去 .ed-main 的 rect.left，并补偿 scrollLeft
```

然后：`x(level) = charLeftInMain + level * indentUnit * charWidthMeasured`

`charWidthMeasured` 用**同一行连续 10 个字符的宽度 / 10** 得到，比离屏 span 可靠：

```js
r.setStart(line0, 0); r.setEnd(line0, 10);
const w10 = r.getBoundingClientRect().width;
const charW = w10 / 10;
```

> 如果第一行太短，取文本最长的一行做测量。

### 4.3 缩进单位

- 优先"探测"：统计相邻两行缩进差的正值众数（`indent.js` 里的 `detectIndentUnit` 已经实现了同样的逻辑，可直接复用）
- 兜底：Verilog 2，Perl/Python 4
- 注意：`indent.js` 返回的是**空格数**，如果文件用 Tab，需要先 `expandTabs(tabSize=4)`

### 4.4 渲染

```js
<svg class="ed-guides">
  <line x1=x y1=y1 x2=x y2=y2 class="gline" data-level="L"/>
  ...
</svg>
```

- SVG 绝对定位覆盖 `.ed-main`，`pointer-events:none`（除非要做折叠点击）
- `width/height` 取 `.ed-main` 的 `clientWidth/clientHeight`
- `transform: translate(-scrollLeft, -scrollTop)`，与 `ed.js` 的 `syncScroll` 保持一致
- 线段 y：
  - `y1 = PAD_T + i * LH`（第一行的顶部）
  - `y2 = PAD_T + j * LH + LH`（最后一行底部），实际可微调 1~2px 让它与文字视觉对齐

### 4.5 折叠箭头（第二阶段）

- 只在"块起始行"画：该行 `levels[i] > levels[i-1]` 或该行有开括号/`begin`/`:` 且下一行更深
- 位置：`x = x(level of block) - 10`，`y = 该行中心`
- 用 `<path>` 画 `∨`，尺寸 8×8，`stroke-width:1.4`
- 交互：点击折叠 —— **当前 textarea 架构无法隐藏行**，两种选择：
  1. 只做视觉箭头，点击滚动到块尾（低风险）
  2. 折叠时把区间替换成一行 `… (N 行已折叠)`，仅存在于**展示副本**中，编辑时自动展开（中等成本）
- 建议本阶段**先只做视觉箭头**，折叠留到下个迭代

### 4.6 配色

| 主题 | 线色 | 说明 |
|---|---|---|
| 浅色（默认） | `#d7dce5` | 比背景深一档，比正文 `#1f2b3d` 浅很多 |
| 深色 | `#3a4048` | 参考图接近这个 |
| hover 当前级 | 线宽 1px→2px，颜色加深一档 | 可选 |

参考图的线是不透明的实线，**不要用虚线、不要加透明度**（当前 `opacity` 让它更淡了）。

---

## 5. 具体改动清单

1. **重写 `guides.js`**
   - 删除现在的 `blocksOf()`（按块画的那套）
   - 新写 `levelsOf(lines, tabSize)` → `number[]`
   - 新写 `segmentsOf(levels)` → `[{level, from, to}]`（连续区间）
   - 新写 `measureColumns()` → `{charLeftInMain, charW}`
   - 渲染 + 注册 `ED.afterRender(draw)`
2. **`ed.css`**
   - 调整 `.ed-guides .gline` 的颜色/宽度
   - 新增 `.ed-guides .fold` 样式（如果做箭头）
3. **不要动 `ed.js`**，除非需要把 `PAD_L/LH/PAD_T` 抽成常量导出（可以加到 `window.ED.metrics`）
4. **`verify-editor.py`** 追加断言（见第 6 节）

---

## 6. 验收标准（必须逐条自动化验证）

写进 `verify-guides.py`，用 Playwright 直接量坐标：

| # | 断言 | 判定方式 |
|---|---|---|
| 1 | 每个缩进级都有一条线 | 对一个三层嵌套的文件，`data-level` 覆盖 1/2/3 |
| 2 | 线在文字左侧且不重叠 | 线的 x < 该级首字符的 `getBoundingClientRect().left`，差值 ≥ 2px 且 ≤ 6px |
| 3 | 相邻两级线间距 = 缩进单位 × 字符宽 | 误差 ≤ 1px |
| 4 | 块结束时线段终止 | `}` 所在行之后不应再有该级的线 |
| 5 | 滚动后仍对齐 | 滚动 300px 后再测 x（x 不应变），y 应平移 300px |
| 6 | 切换语言仍然正确 | Perl / Verilog / Python 各测一个文件 |
| 7 | 不遮挡选择 | 用鼠标拖选跨行，`getSelection()` 内容完整 |
| 8 | 无 JS 报错 | `pageerror` 为空 |

测试数据：仓库自带示例工程（`PROJECTS` 里的 `uart_log_tools`），
- `uart/uart_rx.pl`：多层 `{}` 嵌套
- `rtl/sat_alu.sv`：`module` + `function`
- `tools/analysis.py`：两个 `def` + 嵌套

---

## 7. 运行与发布

```powershell
# 本地起服务（仓库里已有）
cd ic-code-notes
python -m http.server 8720 --bind 127.0.0.1
# 打开 http://127.0.0.1:8720/index.html
```

发布：
1. 改 `index.html` 里的构建号 `构建 YYYYMMDD-HHMM` 和资源版本 `?v=...`（两个都要改，否则浏览器/Pages 缓存）
2. `git add -A && git commit -m "..."`
3. **推送**：SSH 不通，用 HTTPS + 指定 sslBackend：
   ```powershell
   git -c http.sslBackend=openssl push "https://github.com/huzhikun-alt/ic-code-notes.git" main
   ```
   失败就重试 2~3 次（GitHub 偶发 500）。
4. 等 Pages：`gh api repos/huzhikun-alt/ic-code-notes/pages/builds/latest`
   - 仓库**必须有 `.nojekyll`**，否则会 `Page build failed`（已经加好，别删）
5. 线上验证：`https://huzhikun-alt.github.io/ic-code-notes/`，看 `⋯` 菜单底部的构建号

---

## 8. 踩过的坑（避免重复）

| 坑 | 结论 |
|---|---|
| `guides.js` 里用离屏 span 测字宽 | 字体继承不可靠，**改用 Range 实测** |
| 只按"块"画线 | 必须按"缩进级 + 连续区间"画 |
| `opacity` 压低了线 | 参考图是实色，去掉 opacity |
| CSS 大段正则清理误删规则 | 清理 CSS 时用逐条删除，别用 `(?s)...(?=...)` 大块吞 |
| PowerShell 不支持 heredoc | 测试脚本一律**写成 .py 文件再执行**，别用 `python - <<EOF` |
| PowerShell 里 `\` 转义会破坏 JS 正则 | 用 Python 脚本改文件，或用 `chr(92)` 拼反斜杠 |
| Pages 构建失败 | 检查 `.nojekyll`；仍失败就空提交重触发 |
| 文本选择被自定义事件吃掉 | guides **绝对不能**加 `pointer-events:auto` 或 `mousedown` 监听（除非做折叠） |

---

## 9. 明确的"不要做"

- 不要改编辑器架构（textarea + pre + gutter 三层是刻意的，换成 per-line DOM 会重新引入跨行选择问题）
- 不要给参考线加背景色、圆角、阴影
- 不要把线画在行号列里（参考图的线在行号与文字之间，行号列是独立的）
- 不要在线上页面做 A/B，直接在本地 8720 调完再推

---

## 10. 完成定义（1:1 判定）

拿 `docs/reference-indent-guides.png` 作对照，满足：

- [ ] 三层嵌套时能看到 **3 条平行竖线**，间距一致
- [ ] 每条线底部正好停在对应块的最后一行
- [ ] 线的 x 与文字缩进列对齐（误差 ≤ 1px）
- [ ] 块起始行有 `∨`（如果做）
- [ ] 浅色主题下线的可见度与参考图相当（能看清但不抢眼）
- [ ] 跨行拖选、复制、输入全部正常
- [ ] `verify-editor.py` 19 项 + 新增 `verify-guides.py` 全绿
