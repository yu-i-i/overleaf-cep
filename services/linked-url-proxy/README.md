overleaf/linked-url-proxy
===============

An API for providing linked url proxy

## このプロジェクトでの利用

エディタでファイルを追加し、「From external URL」から公開 HTTP/HTTPS URL と保存名を指定します。取り込んだファイルは、取得元を変更した後に「Refresh」で更新できます。取り込み・更新にはプロジェクトの編集権限が必要です。更新に失敗した場合は、それまでの内容を保持します。

本体内のプロキシを経由して取得し、既定では内部 IP への接続を拒否します。転送先も同じ規則で確認し、取得期限は 30 秒、本文の上限は 50 MB です。

学内の特定サーバーが必要な場合は、`.env` の `OVERLEAF_LINKED_URL_ALLOWED_RESOURCES` に許可する URL を限定した正規表現を指定します。この許可設定は内部 IP・追加 CIDR の制限より優先されます。追加で拒否するネットワークは `OVERLEAF_LINKED_URL_BLOCKED_NETWORKS` に指定できます。

License
=======
The code in this repository is released under the GNU AFFERO GENERAL PUBLIC LICENSE, version 3.

Copyright (c) yu-i-i (https://github.com/yu-i-i/overleaf-cep), 2025.
