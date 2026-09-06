#!/bin/bash
# 清理会干扰提交与打包的残留文件。
#
# 用法:
#   ./tools/clean-workspace.sh            # 清理
#   ./tools/clean-workspace.sh --check    # 只报告，不删（verify.sh 用这个）
#
# 处理两类东西：
#
# 1. .DS_Store —— Finder 逛过目录就会生成。Eagle 打包 .eagleplugin 时会把整个
#    插件目录打进去，这些文件会一起进包被审核挑出来。
#
# 2. 陈旧的 .git/index.lock —— 这个仓库反复出现：IDE（.idea 目录说明用的是
#    JetBrains）内置的 git 集成被强杀时会留下锁文件，之后任何 git 写操作都会
#    报「另外一个 git 进程正在运行」而拒绝执行。
#
#    删锁文件本身是危险动作：如果真有 git 进程在跑，删掉会破坏索引。所以这里
#    只在同时满足三个条件时才删 —— 没有任何 git 进程在跑、锁文件是空的
#    （正在工作的 git 会往里写内容）、且已存在超过 1 分钟。任何一条不满足就
#    只报告、不动手。
set -u

MODE="${1:-clean}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FOUND=0

# 变量引用统一写 ${LOCK} 而不是 $LOCK：紧跟中文全角括号时 bash 会把「（」
# 当成变量名的一部分，报 unbound variable。
report() { printf '  %s\n' "$1"; }

# ---- .DS_Store --------------------------------------------------------------

DS_LIST="$(find . -name '.DS_Store' -not -path './.git/*' 2>/dev/null)"
if [ -n "$DS_LIST" ]; then
    DS_COUNT="$(printf '%s\n' "$DS_LIST" | wc -l | tr -d ' ')"
    FOUND=1
    if [ "$MODE" = '--check' ]; then
        report "存在 ${DS_COUNT} 个 .DS_Store，打包前需清理（./tools/clean-workspace.sh）"
        printf '%s\n' "$DS_LIST" | sed 's/^/        /'
    else
        printf '%s\n' "$DS_LIST" | while IFS= read -r f; do rm -f "$f"; done
        report "已删除 ${DS_COUNT} 个 .DS_Store"
    fi
fi

# ---- 陈旧的 git 锁 ----------------------------------------------------------

LOCK='.git/index.lock'
if [ -e "$LOCK" ]; then
    FOUND=1

    # pgrep -x 匹配进程名而非命令行，避免把 "grep git" 这类误判成 git 进程。
    if pgrep -x git >/dev/null 2>&1; then
        report "${LOCK} 存在，但确实有 git 进程在运行 —— 不动它。等该进程结束后重跑。"
    elif [ -s "$LOCK" ]; then
        report "${LOCK} 存在且非空（可能有进程正在写）—— 不自动删除。先确认内容：cat ${LOCK}"
    else
        # find -mmin +1 => 修改时间超过 1 分钟
        STALE="$(find "$LOCK" -mmin +1 2>/dev/null)"
        if [ -z "$STALE" ]; then
            report "${LOCK} 是刚生成的空锁（不到 1 分钟）—— 可能有 git 正在启动，稍等后重跑。"
        elif [ "$MODE" = '--check' ]; then
            report "存在陈旧的 ${LOCK}（空文件、无 git 进程），会阻塞所有 git 写操作。执行 ./tools/clean-workspace.sh 清理。"
        else
            rm -f "$LOCK"
            report "已删除陈旧的 ${LOCK}（空文件、无 git 进程在运行）"
        fi
    fi
fi

# ---- 结论 -------------------------------------------------------------------

if [ "$FOUND" -eq 0 ]; then
    report "工作区干净：无 .DS_Store，无陈旧 git 锁"
fi

# --check 模式永远返回 0：这些是提示，不该让 verify.sh 整体失败。
exit 0
