#!/bin/sh
# MongoDB 単一ノード replica set を 1 回だけ初期化するスクリプトです。
# compose の mongo-init サービスから起動直後に実行されます。
#
# - 既に replica set が初期化済みなら（rs.status() が成功すれば）何もしません。
# - primary が選出されるまで最大 60 秒待ち、失敗時は非 0 で終了します。

set -eu

mongosh mongodb://mongo:27017/admin --quiet --eval '
try {
  rs.status();
} catch (error) {
  // 未初期化だけを初期化対象にし、認証・ネットワーク等の障害は隠しません。
  if (error.code !== 94) throw error;
  const initialized = rs.initiate({ _id: "overleaf", members: [{ _id: 0, host: "mongo:27017" }] });
  if (initialized.ok !== 1) throw new Error(JSON.stringify(initialized));
}
' >/dev/null

attempt=0
while [ "$attempt" -lt 60 ]; do
  # myState が 1（PRIMARY）になったことを確認して成功終了します。
  if mongosh mongodb://mongo:27017/admin --quiet --eval 'rs.status().myState' 2>/dev/null | grep -qx 1; then
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 1
done

echo 'MongoDB replica set did not elect a primary' >&2
exit 1
