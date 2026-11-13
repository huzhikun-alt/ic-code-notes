# Folding implementation and approved guide layout

## Approved visual contract (latest, 2026-11-07)

The YAML reference screenshot supplied by the user supersedes the earlier midpoint/character-center experiment:

1. Full-height divider is between line numbers and folding arrows, independent of code.
2. Indent guides are drawn at each ancestor indent boundary **and the line's own indent boundary**: a line at level n gets n+1 columns at `0..n*indentSize`, each at the character-cell left edge, 2px left of the glyph, segmented by block. Top-level rows (level 0) get none. No midpoint or character-center offsets.
3. The YAML reference's deepest line therefore has 4 independent columns; a one-level Perl block gets 2 (parent column 0 plus its own 4-space boundary). The full-height divider is NOT a guide and spans the whole editor.
4. Verilog module/endmodule is connected by the level-1 column-zero guide; the separate center-aligned pair line was removed to avoid a duplicate column.
5. This restores the user's earlier per-level boundary look and remains a project-specific layout choice where it differs from stock VS Code.

Acceptance: verify-guide-placement.py checks cell-origin columns and independent nested columns; verify-gutter-divider.py checks the full-height divider; verify-guide-visibility.py checks actual raster pixels; T14/T24 assert classic cell-origin positions.

## Normative revision

VS Code `1745a4a6102e93173430b4b2debc1247a91cd036` retrieved from GitHub main commit API on 2026-11-07. Official sources downloaded from `raw.githubusercontent.com/microsoft/vscode/<SHA>/...` are retained in `vscode-reference/`, with Microsoft's MIT license. Codicon font package is `@vscode/codicons@0.0.46-49`, matching the pinned package.json dependency; chevron-down U+EAB4 and chevron-right U+EAB6 match pinned codiconsLibrary.ts.

## Architecture and changes

The application is NOT Monaco. It retains its native editable textarea, highlight pre, original model `files()[cur].lines`, notes/AI integrations and gutter.

- `folding-model.js`: official bottom-up indentation fallback, registered language-provider extension point, sanitized parent-child range tree, independent collapsed flags, hidden-line projection, view-edit to source transaction, text undo/redo history.
- `folding-ui.js`: official icon resources, gutter decorations, hover/always/never, same-line down/up validation with 4px exclusion, Shift/middle and Alt batch semantics, commands/key chords.
- `editor-guides.js`: independent indent/bracket rendering, active scope, visible model-row mapping, overlap merge. NEVER renders folding ranges as lines.
- `ed.js`: canonical source preserved separately from editable visible projection. Inline U+22EF is decoration (not source), real line numbers and mapped selection/clipboard/navigation.
- Legacy `guides.js` no longer loaded; its prior experimental assumptions are not normative.

## Official vs project-specific

Ported behavior: indentation provider stack and off-side handling; hidden start+1..end; parent retains child collapsed flags; modifiers follow folding.ts:473–507; default options from editorOptions.ts; opacity/motion/Codicon/ellipsis conventions from folding.css.

Project-specific: native textarea projection/edit adapter, DOM Range measurement, state storage per project+file, synchronous fallback provider. VS Code's services, tracked decoration ranges, selection model, adaptive provider scheduling and built-in language extensions are not directly imported. No claim that syntax fallback equals every installed VS Code language provider.

## Current verification and visual comparison

Real Google Chrome 156.0.8078.80: `python verify-vscode-folding.py` ran 26 scenarios, 26 passed, no skipped; original `python verify-editor.py` 19 passed. Test IDs group/reorder the requested cases (see test table in script); this does not mean every combinatorial edge case is proven.

A real Microsoft Monaco 0.57.0 editor was run locally for visual comparison, NOT a hand-drawn mock. It is an additional released-engine baseline, not the exact VS Code main commit build. At DPR=1, Consolas 13px, lineHeight=22, tabSize=4: official content-left=59px, custom content-left=59px (custom zero left-padding plus dedicated decoration lane); official and custom icon font-size=18.2px; custom indent spacing=28.5898px, consistent with measured 4×7.1484375px. Both use the actual Codicon font. Retained images/metrics: monaco-reference-dark.png, custom-reference-dark.png, corresponding *-metrics.json. Icon raw element bounds are NOT comparable: official icon itself occupies a 38×22 flex lane; custom inner glyph occupies ~18.2×20 inside a separate 38×22 hit area. Glyph raster-level comparison has not been completed. Theme colors currently follow the project's palettes, not identical stock VS Code palettes. Do not claim pixel-perfect parity.

Additional `python verify-folding-options.py` executed successfully: region markers, foldAll, hidden-EOF full-source clipboard, actual Ctrl+K chords, foldLevel2, never-controls without disabling commands, recursive commands, per-file state, registered language provider. These tests caught and fixed modifier-key chord cancellation.

## Known limitations / non-native differences

- No installed VS Code language extensions/LSPs. Built-in default provider is the official indentation fallback; external synchronous providers may be registered. Template interpolation, Perl regex/heredoc and arbitrary language syntax are not fully tokenized by the lightweight bracket scanner. These remain approximate, not equivalent to TextMate/Tree-sitter/VS Code language services.
- Native textarea projection requires source-offset remapping; this is project-owned, not Monaco. IME, accessibility/screen-reader representation and native drag/drop across folded boundaries need broader coverage.
- Undo is a model text snapshot stack, not VS Code's operation/decoration history; note/AI toolbar undo retains the existing fallback. Typing undo grouping is per input event, not VS Code's grouping rules.
- Fold range state is preserved per live file/session and shifted across local edits; no persisted folding state across full page reload. External whole-document replacement may invalidate old folds.
- Wrapping geometry is measured using browser text layout; CodeLens/inline widgets are not implemented in this project. Current tests cover ordinary text/CJK/tab layout, scrolling and zoom, not every ligature or RTL case.
- Mouse drag cancellation uses a local 5px guard in addition to official down/up target matching; this is a deliberate textarea safety adaptation.

## Verification policy

Tests and visual artifacts must be reported separately. Passing custom assertions is not proof of pixel parity. Old verify-guides/verify-scope-anchors scripts assert earlier experimental layouts and must not be reported as conformance to the new official contract. New T01–T26 suite is `verify-vscode-folding.py`; final results and known gaps will be appended after real execution.
