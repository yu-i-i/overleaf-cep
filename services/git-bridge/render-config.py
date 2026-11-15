"""既存テンプレートの既定値を使い、環境変数から JSON 設定を生成する。"""

import json
import os
from pathlib import Path
import re
import sys


PLACEHOLDER = re.compile(
    r'(?P<quote>")?\$\{(?P<name>[A-Z][A-Z0-9_]*)(?::-(?P<default>[^}]*))?\}(?(quote)")'
)


def render_config(template, environ):
    def replace(match):
        name = match['name']
        default = match['default'] or ''
        # シェルの ${VAR:-default} と同じく、空文字でも既定値を使う。
        value = environ.get(name) or default
        if match['quote']:
            # URL・保存先に引用符や改行があっても、JSON の構造を壊さない。
            return json.dumps(value, ensure_ascii=False)

        try:
            parsed = json.loads(value)
            expected = json.loads(default)
        except ValueError:
            raise ValueError(f'{name}: 数値または真偽値の設定が不正です') from None
        if type(parsed) is not type(expected):
            raise ValueError(f'{name}: 設定の型が既定値と異なります')
        return json.dumps(parsed)

    # 置換は一度だけ行い、環境変数の値に含まれる ${...} を再展開しない。
    return json.loads(PLACEHOLDER.sub(replace, template))


if __name__ == '__main__':
    config = render_config(Path(sys.argv[1]).read_text(), os.environ)
    json.dump(config, sys.stdout, ensure_ascii=False)
