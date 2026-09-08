#!/bin/bash
# 把插件同步到本机 Eagle 插件目录（开发期用）。
#
# 用法: ./sync-to-eagle.sh
#
# 真正的组装逻辑在 tools/build-package.sh：它按白名单产出 dist/<plugin-id>/，
# 再 rsync 到 Eagle 的插件目录。这里只是个入口，不要在这个文件里再写一份
# 排除列表 —— 上一次投稿被拒就是因为「打包源」和「排除列表」是两回事，
# 黑名单根本没参与打包。白名单只存在于 build-package.sh 一处。
exec "$(cd "$(dirname "$0")" && pwd)/tools/build-package.sh" --install
