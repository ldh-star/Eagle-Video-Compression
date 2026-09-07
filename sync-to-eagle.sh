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

# 排除项只在这里写一份：rsync 和后面的 diff 校验共用。
# 之前两处各写各的，diff 少排除了 .git，校验永远报不一致 —— 同一份列表能
# 从根本上杜绝这类漂移。
#
# tests / tools / docs 是开发期产物：Eagle 打包 .eagleplugin 时会把整个插件
# 目录打进去，同步进来的东西就是将来会进包的东西，所以这里就得挡住。
EXCLUDES=(
    '.DS_Store'
    '.git'
    '.gitignore'
    '.idea'
    # 提交给 Eagle 插件中心的文案汇总，是 docs/ 的产物，不该进 .eagleplugin
    'SUBMISSION.md'
    'sync-to-eagle.sh'
    'tests'
    'tools'
    'docs'
    '.codebuddy'
)

RSYNC_ARGS=()
DIFF_ARGS=()
for e in "${EXCLUDES[@]}"; do
    RSYNC_ARGS+=(--exclude "$e")
    DIFF_ARGS+=(--exclude="$e")
done

rsync -a --delete "${RSYNC_ARGS[@]}" "$SRC/" "$DST/"

echo ""
echo "已同步，安装内容:"
find "$DST" -type f -not -name '.DS_Store' | sed "s|$DST/||" | sort | while read -r f; do
    printf "  %-22s %8s bytes\n" "$f" "$(stat -f%z "$DST/$f")"
done

if diff -r "${DIFF_ARGS[@]}" "$SRC" "$DST" >/dev/null 2>&1; then
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
