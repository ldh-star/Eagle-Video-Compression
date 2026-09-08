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
for f in js/*.js tools/*.js tests/*.js tests/cases/*.js; do
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

# 3b. 标准用例集
#
# 与 3a 的区别：3a 是「当前行为对不对」的回归脚本；这一批是「已知缺陷的契约」，
# 里面有一半是刻意写成 xfail 的 —— 它们现在就该失败，等修好了运行器会报 XPASS
# 逼你回来翻状态。所以这里不能用「有没有用例失败」判断好坏，只看运行器退出码：
# 退出码非 0 意味着 FAIL（已实现的行为被改坏）或 XPASS（缺陷已修但状态没翻）。
step "标准用例集"
if [ -f tools/run-tests.js ]; then
    OUT="$("$NODE" tools/run-tests.js 2>&1)"
    RC=$?
    echo "$OUT" | grep -E '^(FAIL|XPASS)' | sed 's/^/        /'
    echo "$OUT" | grep -E '^通过 ' | sed 's/^/  /'
    if [ "$RC" -eq 0 ]; then
        ok "无 FAIL / XPASS（KNOWN-FAIL 是已登记待修的缺陷，不算红）"
    else
        bad "用例集未通过：FAIL = 已实现的行为被改坏；XPASS = 缺陷已修复，请把该用例 status 从 xfail 翻成 implemented"
        echo "$OUT" | tail -30 | sed 's/^/        /'
    fi
else
    bad "tools/run-tests.js 不存在"
fi

# ---- 4. 多语言一致性 --------------------------------------------------------
step "多语言"
if "$NODE" tools/check-i18n.js; then :; else bad "语言包检查未通过"; fi

# ---- 5. 版本号与简述文档 ----------------------------------------------------
step "版本与文档"
if "$NODE" tools/check-docs.js; then :; else bad "简述文档检查未通过"; fi

# ---- 5a. 提交文案是否跟得上 docs/ --------------------------------------------
# SUBMISSION.md 是 docs/ 的产物，但生成是手动的 —— 它在 1.1.0 上停了整整两个
# 版本没人发现，因为改 docs/ 不会让任何检查变红。这里重新生成一份到临时文件
# 再比对，内容不一致就报错，把「忘了重跑生成器」变成一个当场可见的失败。
step "提交文案"
if [ -f tools/gen-submission.js ]; then
    TMP_SUB="$(mktemp -t submission)"
    # 生成器只写死路径 SUBMISSION.md，先备份原件、生成、比对、还原。
    cp SUBMISSION.md "$TMP_SUB" 2>/dev/null || : > "$TMP_SUB"
    if "$NODE" tools/gen-submission.js >/dev/null 2>&1; then
        if diff -q "$TMP_SUB" SUBMISSION.md >/dev/null 2>&1; then
            ok "SUBMISSION.md 与 docs/ 一致（$("$NODE" -p "require('./manifest.json').version")）"
        else
            # 已经就地更新了，说清楚要把它一并提交，而不是让人再跑一次
            ok "SUBMISSION.md 落后于 docs/，已重新生成 —— 记得一起提交"
        fi
    else
        bad "tools/gen-submission.js 执行失败"
        cp "$TMP_SUB" SUBMISSION.md 2>/dev/null || true
    fi
    rm -f "$TMP_SUB"
else
    bad "tools/gen-submission.js 不存在"
fi

# ---- 5b. 商店提交字段 -------------------------------------------------------
# 名称和描述过去只填在提交表单里，仓库里没有副本，超限只能等审核告诉你。
step "商店提交字段"
if "$NODE" tools/check-store.js; then :; else bad "商店名称/描述检查未通过"; fi

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

# 安装包内容由 tools/build-package.sh 的白名单决定。这里核对它的清单里没有
# 任何开发期产物 —— 上一次投稿就是因为 tests/ tools/ reports/ SUBMISSION.md
# 全都进了包而被驳回。
if [ -x tools/build-package.sh ]; then
    MANIFEST_LIST="$(./tools/build-package.sh --list 2>/dev/null)"
    if [ -z "$MANIFEST_LIST" ]; then
        bad "tools/build-package.sh --list 没有输出，无法核对安装包内容"
    else
        # 顶层目录/文件名必须落在这个集合里。新增运行时文件时同步改这里和白名单。
        STRAY="$(printf '%s\n' "$MANIFEST_LIST" | cut -d/ -f1 | sort -u |
            grep -vxE 'manifest\.json|index\.html|logo\.png|LICENSE|css|js|_locales' || true)"
        if [ -n "$STRAY" ]; then
            bad "安装包清单里有非运行时内容：$(printf '%s' "$STRAY" | tr '\n' ' ')"
        else
            ok "安装包清单只含运行时内容（$(printf '%s\n' "$MANIFEST_LIST" | wc -l | tr -d ' ') 个文件）"
        fi
    fi
else
    bad "tools/build-package.sh 不存在或没有执行权限"
fi

# ---- 结论 -------------------------------------------------------------------
echo ""
if [ "$FAILED" -eq 0 ]; then
    printf '\033[32m全部通过\033[0m — 可以提交 / 打包。\n'
else
    printf '\033[31m存在必须修复的问题\033[0m — 上面标 ✗ 的项。\n'
fi
exit "$FAILED"
