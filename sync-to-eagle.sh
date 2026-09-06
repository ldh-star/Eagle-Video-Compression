#!/bin/bash
# 把工程同步到 Eagle 插件目录。
#
# 用法: ./sync-to-eagle.sh
#
# Eagle 在启动时扫描插件目录，所以同步完需要重启 Eagle（或至少重新打开插件窗口）
# 才会加载新代码。脚本会顺带做一次 JS 语法检查，避免把语法错误推进去。
set -e

SRC="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ID="$(node -e "console.log(require('$SRC/manifest.json').id)")"
DST="$HOME/Library/Application Support/Eagle/Plugins/$PLUGIN_ID"

echo "源目录: $SRC"
echo "目标  : $DST"

# 先自查语法，别把跑不起来的东西推进 Eagle
echo ""
echo "语法检查..."
JS_COUNT=0
for f in "$SRC"/js/*.js; do
    node --check "$f" || { echo "*** 语法错误: $f —— 已中止同步"; exit 1; }
    JS_COUNT=$((JS_COUNT + 1))
done
echo "  $JS_COUNT 个 JS 文件全部通过"

mkdir -p "$DST"
rsync -a --delete \
    --exclude '.DS_Store' \
    --exclude '.git' \
    --exclude 'sync-to-eagle.sh' \
    "$SRC/" "$DST/"

echo ""
echo "已同步，安装内容:"
find "$DST" -type f -not -name '.DS_Store' | sed "s|$DST/||" | sort | while read -r f; do
    printf "  %-22s %8s bytes\n" "$f" "$(stat -f%z "$DST/$f")"
done

# 注意：排除项必须和上面 rsync 的 --exclude 保持一致，
# 否则 .git 这类"故意不同步"的目录会让校验永远失败。
if diff -r --exclude='.DS_Store' --exclude='.git' --exclude='sync-to-eagle.sh' "$SRC" "$DST" >/dev/null 2>&1; then
    echo ""
    echo "校验: 与源目录完全一致 ✓"
else
    echo ""
    echo "*** 警告: 同步后内容不一致，请检查"
    exit 1
fi

# Eagle 正在运行时提醒重启：它只在启动时扫插件目录
if pgrep -x "Eagle" >/dev/null 2>&1; then
    echo ""
    echo "Eagle 正在运行 —— 需要重启 Eagle 才会加载新代码。"
fi
