# Monaco / VS Code 对齐（2026-11-13 v2）

当前加载 ed-monaco.js（Monaco 0.57）。三个遗留实现仅标记 DEPRECATED，不再作为验收对象。本说明取代旧的自定义编辑器布局要求。

- 删除 ed.css 半字符 transform，以及 ed-monaco.js 中仅为该补偿提供 CSS 变量的监听器；功能选项不变。
- 官方 docs/vscode-reference/indentGuides.ts:213 使用 `(indentLvl - 1) * indentSize + 1`，即字符单元左边缘；两级缩进行只有两条线。
- 官方 docs/vscode-reference/folding.css:10、15、26–30：初始 opacity 0、字号 140%、整个 gutter 悬停或折叠状态 opacity 1。
- 官方 docs/vscode-reference/folding.css:33–39：原生 inline-folded 省略号。保留 Monaco 自带实现。
- gutter 与代码间无全高分隔线是本次验收要求；不声称该要求来自 folding.css。

## 验证

在项目目录启动 HTTP 服务（端口 8720），使用安装 playwright、Pillow 的 Python 分别运行四个 verify-*.py 脚本。使用本机 Google Chrome、独立页面，不依赖旧 EditorGuides / FoldingUI 全局对象。

verify-guide-placement.py 同时提供公共 fixture：YAML 两级四空格缩进，以实际行坐标筛选 Monaco DOM guide；断言 left 去重为 2、位置对应 0 与 4 个空格宽度、computed transform 为 none。
verify-gutter-divider.py 扫描整个 gutter 到代码边界的截图列，要求不存在贯穿采样高度的非背景列。
verify-guide-visibility.py 比较原生 guide 隐藏前后截图，验证深浅主题两条线实际绘制。
verify-vscode-folding.py 检查原生 codicon-folding-*（Monaco 实际没有 .folding 类）的 opacity：移出为 0、悬停 gutter 非箭头位置为 1、点击折叠后移出仍为 1，并验证原生省略号。

原偏移已通过新 placement 断言复现：transform matrix 的水平偏移为 3.57422px。删除后 left 为 0 / 28.5938，spaceWidth 为 7.1484375，transform 均为 none。
