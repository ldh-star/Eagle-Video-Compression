#!/bin/bash
# 产出干净的插件目录 —— 只含运行时需要的东西。
#
# 用法:
#   ./tools/build-package.sh              # 生成 dist/<plugin-id>/
#   ./tools/build-package.sh --list       # 只打印会进包的文件清单
#   ./tools/build-package.sh --install    # 生成后同步到本机 Eagle 插件目录
#   ./tools/build-package.sh --zip        # 生成后打成 dist/<name>-<version>.eagleplugin
#
# 为什么是白名单：
#
# 上一次投稿被拒的原因之一，就是 tests/ tools/ reports/ sync-to-eagle.sh
# SUBMISSION.md 全都进了安装包。当时 sync-to-eagle.sh 里明明有一份排除列表，
# 但打包源根本不是它同步出来的目录，而是仓库根目录 —— 黑名单从头到尾没参与。
#
# 黑名单的失效方式是「悄无声息」：新加一个开发期文件，忘了登记，它就进包了，
# 而且要等审核回信才知道。白名单的失效方式是「立刻报错」：新加一个运行时文件
# 忘了登记，插件当场加载失败。后者是能在本机 5 秒内发现的故障。
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-build}"

# 运行时白名单。新增运行时文件（新的 js/、新的图标）必须登记在这里。
INCLUDE=(
    manifest.json
    index.html
    logo.png
    LICENSE
    css
    js
    _locales
)

# ---- 清单 -------------------------------------------------------------------

list_files() {
    for item in "${INCLUDE[@]}"; do
        if [ -d "$item" ]; then
            # -type f 会漏掉符号链接；插件目录里不该有符号链接，发现了就该报出来。
            find "$item" -type f -not -name '.DS_Store' | sort
        elif [ -f "$item" ]; then
            printf '%s\n' "$item"
        else
            echo "*** 白名单里的 $item 不存在" >&2
            exit 1
        fi
    done
}

if [ "$MODE" = '--list' ]; then
    list_files
    exit 0
fi

# ---- 语法自查 ---------------------------------------------------------------
# 这个插件没有构建步骤，一个语法错误 = 整份脚本不执行 = 界面卡在 HTML 初始文案，
# 而且 Eagle 不给任何报错。打包前必须先过一遍。

echo "语法检查..."
for f in js/*.js; do
    node --check "$f" || { echo "*** 语法错误: $f —— 已中止打包"; exit 1; }
done
echo "  $(ls js/*.js | wc -l | tr -d ' ') 个 JS 文件全部通过"

# ---- 组装 -------------------------------------------------------------------

PLUGIN_ID="$(node -e "console.log(require('$ROOT/manifest.json').id)")"
VERSION="$(node -e "console.log(require('$ROOT/manifest.json').version)")"
OUT="$ROOT/dist/$PLUGIN_ID"

rm -rf "$OUT"
mkdir -p "$OUT"

list_files | while IFS= read -r f; do
    mkdir -p "$OUT/$(dirname "$f")"
    cp "$f" "$OUT/$f"
done

echo ""
echo "产物: $OUT"
echo "内容:"
(cd "$OUT" && find . -type f | sed 's|^\./||' | sort | while read -r f; do
    printf "  %-28s %8s bytes\n" "$f" "$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")"
done)
echo "  合计 $(du -sh "$OUT" | cut -f1)"

# ---- 可选动作 ---------------------------------------------------------------

if [ "$MODE" = '--install' ]; then
    DST="$HOME/Library/Application Support/Eagle/Plugins/$PLUGIN_ID"
    mkdir -p "$DST"
    rsync -a --delete "$OUT/" "$DST/"
    echo ""
    echo "已安装到: $DST"
    # Eagle 只在启动时扫描插件目录，改完代码刷新窗口是没用的
    if pgrep -x "Eagle" >/dev/null 2>&1; then
        echo "Eagle 正在运行 —— 需要重启 Eagle 才会加载新代码。"
    fi
fi

if [ "$MODE" = '--zip' ]; then
    PKG="$ROOT/dist/video-compress-$VERSION.eagleplugin"
    rm -f "$PKG"
    # -X 去掉 macOS 的扩展属性与资源分叉条目，避免包里混进 __MACOSX/._* 噪音
    (cd "$OUT" && zip -q -r -X "$PKG" .)
    echo ""
    # ${PKG} 必须带花括号：紧跟其后的全角括号会被 bash 当成变量名的一部分
    echo "安装包: ${PKG}（$(du -h "$PKG" | cut -f1)）"
    echo "包内清单:"
    unzip -Z1 "$PKG" | sort | sed 's/^/  /'

    # ---- 包体自检 -----------------------------------------------------------
    # 下面这几条都是审核标准「安装包内容」「文件安全」里明确列出的检查点。
    # 以前靠手工敲 unzip 命令核对，等于没有闸门：忘了敲就直接提交。
    # 检查对象是 zip 本身而不是 $OUT，因为 zip 的写入过程也可能引入条目
    # （macOS 的 __MACOSX/._*、被当成普通文件跟进去的符号链接）。
    echo ""
    echo "包体自检..."
    PKG_FAIL=0
    NAMES="$(unzip -Z1 "$PKG")"

    # zip 结构本身损坏的话，Eagle 装不上，而且报错信息毫无指向性
    unzip -tqq "$PKG" >/dev/null 2>&1 || { echo "  FAIL  zip 完整性校验未通过"; PKG_FAIL=1; }

    # 绝对路径 / .. 会让解包写到插件目录之外 —— 这是审核直接拒的路径穿越
    if printf '%s\n' "$NAMES" | grep -qE '^/|(^|/)\.\.(/|$)'; then
        echo "  FAIL  存在绝对路径或 .. 条目:"
        printf '%s\n' "$NAMES" | grep -E '^/|(^|/)\.\.(/|$)' | sed 's/^/          /'
        PKG_FAIL=1
    fi

    # macOS 的资源分叉噪音。-X 已经挡住大部分，但 .DS_Store 是真实文件，挡不住
    if printf '%s\n' "$NAMES" | grep -qE '(^|/)(__MACOSX|\._[^/]*|\.DS_Store)(/|$)'; then
        echo "  FAIL  存在 macOS 元数据条目:"
        printf '%s\n' "$NAMES" | grep -E '(^|/)(__MACOSX|\._[^/]*|\.DS_Store)(/|$)' | sed 's/^/          /'
        PKG_FAIL=1
    fi

    # 同名条目：解包结果取决于实现顺序，审核方与用户拿到的可能不是同一份文件
    DUPES="$(printf '%s\n' "$NAMES" | sort | uniq -d)"
    if [ -n "$DUPES" ]; then
        echo "  FAIL  存在重复路径:"
        printf '%s\n' "$DUPES" | sed 's/^/          /'
        PKG_FAIL=1
    fi

    # 符号链接可以指向包外的任意文件，审核默认按可疑处理
    if unzip -Z "$PKG" | grep -qE '^l'; then
        echo "  FAIL  包内存在符号链接"
        PKG_FAIL=1
    fi
    if [ -n "$(find "$OUT" -type l)" ]; then
        echo "  FAIL  产物目录里存在符号链接（zip 会把它跟成普通文件）:"
        find "$OUT" -type l | sed 's/^/          /'
        PKG_FAIL=1
    fi

    [ "$PKG_FAIL" -eq 0 ] || { echo "*** 包体自检未通过 —— 不要提交这个安装包"; exit 1; }
    echo "  完整性 / 路径 / 元数据 / 重复项 / 符号链接 均通过"
fi
