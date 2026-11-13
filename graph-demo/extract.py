#!/usr/bin/env python3
"""IC 代码笔记 · 文件关系图 —— 扫描器（G1 数据层）

按 PRD-GRAPH.md 第 5 章的解析规则，把一个工程扫成「文件节点 + 引用边」：

    NODE = 一个文件
    EDGE = {from → to, kind, line, raw, status}

kind:  require(Perl) / include + instantiate(Verilog) / import(Python)
status: resolved(工程内找到) / external(标准库等) / missing(像工程内但没找到)

用法:
    python extract.py <工程目录>            # 生成 graph-data.json
    python extract.py <工程目录> --html     # 同时把数据注入 graph.html，产出可直接双击的单文件

零依赖，只用标准库。
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from typing import Iterable

SKIP_DIRS = {".git", "node_modules", "dist", "build", "__pycache__", ".venv", "venv", ".idea", ".vscode", "out", "coverage"}
LANG_BY_EXT = {
    ".pl": "perl", ".pm": "perl", ".t": "perl",
    ".v": "verilog", ".sv": "verilog", ".vh": "verilog", ".svh": "verilog",
    ".py": "python",
    ".js": "javascript", ".ts": "javascript", ".cjs": "javascript", ".mjs": "javascript",
    ".md": "doc", ".json": "config", ".yaml": "config", ".yml": "config", ".toml": "config",
}
VERILOG_EXT_CANDIDATES = (".sv", ".svh", ".v", ".vh")
PERL_KEYWORDS_AS_EXTERNAL = {
    "strict", "warnings", "utf8", "vars", "constant", "lib", "Exporter", "POSIX", "Data::Dumper",
    "Getopt::Long", "File::Basename", "File::Spec", "Cwd", "FindBin", "Time::HiRes",
}
PY_STDLIB = {
    "os", "sys", "re", "json", "time", "datetime", "math", "random", "collections", "itertools",
    "functools", "pathlib", "typing", "subprocess", "shutil", "glob", "csv", "sqlite3", "logging",
    "argparse", "unittest", "dataclasses", "enum", "io", "hashlib", "base64", "struct", "socket",
}
VERILOG_NOT_MODULES = {
    "module", "endmodule", "always", "always_ff", "always_comb", "initial", "assign", "if", "else",
    "case", "casez", "for", "while", "function", "task", "generate", "for", "begin", "end",
    "input", "output", "inout", "logic", "wire", "reg", "parameter", "localparam", "return",
}

PERL_REF = re.compile(r"^\s*(require|use|do)\s+['\"]?([^'\";\s]+)")
VG_INCLUDE = re.compile(r"`include\s+[\"<]([^\">]+)[\">]")
VG_MODULE_DEF = re.compile(r"^\s*(?:macro)?\s*module\s+(\w+)")
VG_INSTANCE = re.compile(r"^\s*(\w+)\s*(?:#\s*\([^;]*\)\s*)?(\w+)\s*\(")
PY_IMPORT = re.compile(r"^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))")


def lang_of(path: str) -> str:
    return LANG_BY_EXT.get(os.path.splitext(path)[1].lower(), "other")


def iter_files(root: str) -> Iterable[str]:
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for name in files:
            full = os.path.join(base, name)
            if os.path.getsize(full) > 4 * 1024 * 1024:
                continue
            yield full


def rel(root: str, path: str) -> str:
    return os.path.relpath(path, root).replace("\\", "/")


def read_text(path: str) -> str:
    for enc in ("utf-8", "utf-8-sig", "gbk", "latin-1"):
        try:
            with open(path, encoding=enc) as fh:
                return fh.read()
        except UnicodeDecodeError:
            continue
    return ""


class Project:
    def __init__(self, root: str):
        self.root = os.path.abspath(root)
        self.files: list[str] = []
        self.lang: dict[str, str] = {}
        self.lines: dict[str, int] = {}
        self.modules: dict[str, str] = {}   # verilog module name -> file
        self.edges: list[dict] = []

    # ---------- 扫描 ----------
    def load(self) -> None:
        for full in iter_files(self.root):
            path = rel(self.root, full)
            self.files.append(path)
            self.lang[path] = lang_of(path)
            self.lines[path] = read_text(full).count("\n") + 1
        for path in self.files:
            if self.lang[path] != "verilog":
                continue
            for line in read_text(os.path.join(self.root, path)).splitlines():
                m = VG_MODULE_DEF.match(line)
                if m:
                    self.modules.setdefault(m.group(1), path)

    # ---------- 解析 ----------
    def resolve(self, from_path: str, raw: str, exts: tuple[str, ...]) -> tuple[str | None, str]:
        """把引用解析成工程内相对路径；返回 (path|None, status)"""
        target = raw.strip()
        base_dir = os.path.dirname(from_path)
        candidates: list[str] = []
        joined = os.path.normpath(os.path.join(base_dir, target)).replace("\\", "/")
        candidates.append(joined)
        if not os.path.splitext(joined)[1]:
            candidates += [joined + e for e in exts]
        for cand in candidates:
            cand = cand.lstrip("./")
            if cand in self.lang or os.path.exists(os.path.join(self.root, cand)):
                return cand, "resolved"
        return None, "missing"

    def add_edge(self, src: str, dst: str | None, kind: str, line: int, raw: str, status: str) -> None:
        if dst == src:
            return  # 自引用不画边
        self.edges.append({"from": src, "to": dst or raw, "kind": kind, "line": line, "raw": raw, "status": status})

    def scan_perl(self, path: str, text: str) -> None:
        for no, line in enumerate(text.splitlines(), 1):
            m = PERL_REF.match(line)
            if not m:
                continue
            raw = m.group(2)
            name = os.path.basename(raw).split(".")[0]
            if not raw.startswith(("./", "../", "/")) and name in PERL_KEYWORDS_AS_EXTERNAL:
                self.add_edge(path, None, "require", no, raw, "external")
                continue
            dst, status = self.resolve(path, raw, (".pl", ".pm"))
            self.add_edge(path, dst, "require", no, raw, status)

    def scan_verilog(self, path: str, text: str) -> None:
        for no, line in enumerate(text.splitlines(), 1):
            for m in VG_INCLUDE.finditer(line):
                raw = m.group(1)
                dst, status = self.resolve(path, raw, VERILOG_EXT_CANDIDATES)
                self.add_edge(path, dst, "include", no, raw, status)
            m = VG_INSTANCE.match(line)
            if m and m.group(1) in self.modules and m.group(1) not in VERILOG_NOT_MODULES:
                self.add_edge(path, self.modules[m.group(1)], "instantiate", no, m.group(1), "resolved")

    def scan_python(self, path: str, text: str) -> None:
        for no, line in enumerate(text.splitlines(), 1):
            m = PY_IMPORT.match(line)
            if not m:
                continue
            raw = (m.group(1) or m.group(2)).strip()
            root_mod = raw.split(".")[0]
            local = os.path.join(os.path.dirname(path), *raw.split("."))
            probe = [local + ".py", os.path.join(local, "__init__.py")]
            if os.path.exists(os.path.join(self.root, probe[0].replace("\\", "/"))):
                self.add_edge(path, probe[0].replace("\\", "/"), "import", no, raw, "resolved")
            elif os.path.exists(os.path.join(self.root, probe[1].replace("\\", "/"))):
                self.add_edge(path, probe[1].replace("\\", "/"), "import", no, raw, "resolved")
            elif root_mod in PY_STDLIB:
                self.add_edge(path, None, "import", no, raw, "external")
            else:
                self.add_edge(path, None, "import", no, raw, "missing")

    def scan(self) -> None:
        self.load()
        for path in self.files:
            text = read_text(os.path.join(self.root, path))
            lang = self.lang[path]
            if lang == "perl":
                self.scan_perl(path, text)
            elif lang == "verilog":
                self.scan_verilog(path, text)
            elif lang == "python":
                self.scan_python(path, text)

    # ---------- 输出 ----------
    def merged_edges(self) -> list[dict]:
        merged: dict[tuple, dict] = {}
        for edge in self.edges:
            key = (edge["from"], edge["to"], edge["kind"], edge["status"])
            if key in merged:
                merged[key]["count"] += 1
                merged[key]["lines"].append(edge["line"])
            else:
                merged[key] = {**edge, "count": 1, "lines": [edge["line"]]}
        return sorted(merged.values(), key=lambda e: (e["from"], e["kind"], e["to"]))

    def to_json(self) -> dict:
        edges = self.merged_edges()
        out_deg: dict[str, int] = {}
        in_deg: dict[str, int] = {}
        for e in edges:
            out_deg[e["from"]] = out_deg.get(e["from"], 0) + 1
            if e["status"] == "resolved":
                in_deg[e["to"]] = in_deg.get(e["to"], 0) + 1
        nodes = [
            {
                "id": path,
                "name": os.path.basename(path),
                "dir": os.path.dirname(path) or ".",
                "lang": self.lang[path],
                "lines": self.lines[path],
                "out": out_deg.get(path, 0),
                "in": in_deg.get(path, 0),
            }
            for path in sorted(self.files)
        ]
        return {
            "project": os.path.basename(self.root),
            "root": self.root.replace("\\", "/"),
            "scannedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "nodes": nodes,
            "edges": edges,
            "stats": {
                "files": len(nodes),
                "edges": len(edges),
                "resolved": sum(1 for e in edges if e["status"] == "resolved"),
                "missing": sum(1 for e in edges if e["status"] == "missing"),
                "external": sum(1 for e in edges if e["status"] == "external"),
                "modules": len(self.modules),
            },
        }


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    root = sys.argv[1]
    if not os.path.isdir(root):
        print(f"不是目录: {root}")
        return 2
    project = Project(root)
    project.scan()
    data = project.to_json()

    here = os.path.dirname(os.path.abspath(__file__))
    json_path = os.path.join(here, "graph-data.json")
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)

    print(f"扫描完成: {root}")
    print(f"  文件 {data['stats']['files']} · 边 {data['stats']['edges']} "
          f"(resolved {data['stats']['resolved']} / missing {data['stats']['missing']} / external {data['stats']['external']})")
    print(f"  Verilog 模块 {data['stats']['modules']} 个")
    print(f"  -> {json_path}")

    if "--html" in sys.argv:
        tpl_path = os.path.join(here, "graph.html")
        out_path = os.path.join(here, "graph.html")
        with open(tpl_path, encoding="utf-8") as fh:
            tpl = fh.read()
        payload = json.dumps(data, ensure_ascii=False)
        marker = "/*__GRAPH_DATA__*/null"
        if marker not in tpl:
            print("!! graph.html 里找不到数据占位符，跳过注入")
            return 1
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(tpl.replace(marker, payload))
        print(f"  -> {out_path}（可直接双击打开）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
