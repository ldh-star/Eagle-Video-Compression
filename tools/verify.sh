#!/bin/bash
# 提交 / 发版前的一键校验闸门。
#
# 用法: ./tools/verify.sh
#
# 这个插件没有构建步骤，运行时就是 Eagle 里的一个 Chromium 窗口 —— 语法错误、
# 缺失的翻译键、忘记同步的版本号，全都要等到人肉打开插件才会暴露，而且有些
# （比如某个语系缺键）只在切到那个语言时才看得到。所以所有能静态查出来的
# 问题都集中在这里，一条命令跑完。
#
# 退出码非 0 表示有必须修复的问题；warn 只是提示，不影响退出码。
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAILED=0
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILED=1; }

# Eagle 的运行时是 Chromium + Node，本机 node 只用来做静态检查和跑 jsdom 测试。
NODE="${NODE:-$(command -v node)}"
if [ -z "$NODE" ]; then
    echo "找不到 node，无法执行校验。设置 NODE=/path/to/node 后重试。"
    exit 1
fi
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"

step "环境"
if [ "$NODE_MAJOR" -ge 22 ]; then
    ok "node $("$NODE" -v)"
else
    bad "node $("$NODE" -v) —— 测试依赖 Node 22+（用到了 String.matchAll / structuredClone 之类的新 API）"
fi

# ---- 1. JSON 合法性 ---------------------------------------------------------
# manifest 或任一语言包 JSON 挂了，Eagle 会直接拒载插件，且不给任何提示。
step "JSON 合法性"
JSON_BAD=0
for f in manifest.json _locales/*.json; do
    if ! "$NODE" -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" 2>/dev/null; then
        bad "$f 不是合法 JSON"
        JSON_BAD=1
    fi
done
[ "$JSON_BAD" -eq 0 ] && ok "manifest.json 与 $(ls _locales/*.json | wc -l | tr -d ' ') 个语言包均合法"

# ---- 2. JS 语法 -------------------------------------------------------------
# Chromium 里一个语法错误就是整份脚本不执行，界面卡在 HTML 的初始文案上。
step "JS 语法"
JS_BAD=0
JS_COUNT=0
for f in js/*.js tools/*.js tests/*.js; do
    [ -e "$f" ] || continue
    JS_COUNT=$((JS_COUNT + 1))
    if ! "$NODE" --check "$f" 2>/dev/null; then
        bad "$f 语法错误"
        "$NODE" --check "$f" 2>&1 | sed 's/^/        /'
        JS_BAD=1
    fi
done
[ "$JS_BAD" -eq 0 ] && ok "$JS_COUNT 个 JS 文件通过 node --check"

# ---- 3. 回归测试 ------------------------------------------------------------
# tests/ 下每个文件是独立可执行的脚本，成功时打印 PASS 并以 0 退出。
step "回归测试"
if [ -d tests ]; then
    for f in tests/*.js; do
        [ -e "$f" ] || continue
        OUT="$("$NODE" "$f" 2>&1)"
        if [ $? -eq 0 ]; then
            echo "$OUT" | grep '^PASS' | sed 's/^/  ✓ /'
            echo "$OUT" | grep -q '^PASS' || ok "$(basename "$f") 退出码 0（未打印 PASS）"
        else
            bad "$(basename "$f") 失败"
            echo "$OUT" | tail -20 | sed 's/^/        /'
        fi
    done
else
    bad "tests/ 目录不存在"
fi

# ---- 4. 多语言一致性 --------------------------------------------------------
step "多语言"
if "$NODE" tools/check-i18n.js; then :; else bad "语言包检查未通过"; fi

# ---- 5. 版本号与简述文档 ----------------------------------------------------
step "版本与文档"
if "$NODE" tools/check-docs.js; then :; else bad "简述文档检查未通过"; fi

# ---- 6. 打包卫生 ------------------------------------------------------------
# .eagleplugin 是整个目录打包，开发辅助文件混进去会被审核挑出来。
step "打包卫生"
./tools/clean-workspace.sh --check

if [ ! -f logo.png ]; then
    bad "manifest 指向的 logo.png 不存在"
else
    LOGO_KB=$(( $(stat -f%z logo.png 2>/dev/null || stat -c%s logo.png) / 1024 ))
    if [ "$LOGO_KB" -gt 512 ]; then
        printf '  \033[33m!\033[0m logo.png 有 %s KB，打包体积偏大，建议压到 512 KB 以内\n' "$LOGO_KB"
    else
        ok "logo.png ${LOGO_KB} KB"
    fi
fi

# .eagleplugin 由 Eagle 对整个插件目录打包生成，sync-to-eagle.sh 同步进去的东西
# 就是将来会被打包的东西。开发期目录（tests/tools/docs）没被排除的话会一起进包。
if [ -f sync-to-eagle.sh ]; then
    UNEXCLUDED=""
    for d in tests tools docs .idea .codebuddy; do
        [ -e "$d" ] || continue
        # 匹配 sync-to-eagle.sh 的 EXCLUDES 数组里的一行： '<name>'
        grep -qE "^[[:space:]]*'$d'[[:space:]]*$" sync-to-eagle.sh || UNEXCLUDED="$UNEXCLUDED $d"
    done
    if [ -n "$UNEXCLUDED" ]; then
        printf '  \033[33m!\033[0m sync-to-eagle.sh 未排除开发期目录：%s —— 会被同步进 Eagle 并进入 .eagleplugin\n' "$UNEXCLUDED"
    else
        ok "sync-to-eagle.sh 已排除开发期目录"
    fi
fi

# ---- 结论 -------------------------------------------------------------------
echo ""
if [ "$FAILED" -eq 0 ]; then
    printf '\033[32m全部通过\033[0m — 可以提交 / 打包。\n'
else
    printf '\033[31m存在必须修复的问题\033[0m — 上面标 ✗ 的项。\n'
fi
exit "$FAILED"
