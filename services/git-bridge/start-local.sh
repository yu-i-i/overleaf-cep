#!/bin/sh
set -eu

# デフォルト値は上流の JSON テンプレートで管理する。展開に失敗したら起動しない。
umask 077
python3 /app/render-config.py /app/envsubst_template.json > /app/runtime.json

# コンテナのメモリー制限を JVM に反映し、停止シグナルを Java へ直接届ける。
GIT_BRIDGE_JVM_ARGS="${GIT_BRIDGE_JVM_ARGS:--XX:+UseContainerSupport -XX:MaxRAMPercentage=50.0 -XX:+ExitOnOutOfMemoryError}"
# JVM 引数だけを空白で分割する。ワイルドカード展開は抑止する。
set -f
exec java $GIT_BRIDGE_JVM_ARGS -jar /app/git-bridge.jar /app/runtime.json
