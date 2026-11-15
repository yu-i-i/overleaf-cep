#!/bin/sh
# ローカル環境のイメージをまとめてビルドするスクリプトです。
#
# 手順:
#   1. server-ce/Dockerfile-base    → local/overleaf-iisec-base      (フル TeX Live)
#   2. Dockerfile.jp-base           → local/overleaf-iisec-ja-base   (日本語クラス・フォント)
#   3. compose.yaml のビルド定義    → Overleaf アプリ / 翻訳サービス / Git 連携
#
# 初回は TeX Live scheme-full の取得で時間がかかります。リポジトリの
# どのディレクトリから実行しても動作します（自前でリポジトリ最上位に移動）。

set -eu

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$repo_root"

# 必須設定を先に確認し、大きなイメージを作った後で設定不足に気付くのを防ぎます。
docker compose -f compose.yaml config --quiet

docker build -f server-ce/Dockerfile-base -t local/overleaf-iisec-base:latest .
docker build --build-arg OVERLEAF_BASE_IMAGE=local/overleaf-iisec-base:latest -f Dockerfile.jp-base -t local/overleaf-iisec-ja-base:latest .
docker compose -f compose.yaml build sharelatex translation-service git-bridge
