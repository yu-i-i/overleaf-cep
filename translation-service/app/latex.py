"""LLM へ渡す前に LaTeX 構文・非散文部分を保護マーカーへ置き換える処理です。

翻訳対象は日本語の散文だけです。コマンド、コメント、数式、コード環境、URL、
ファイル名、参照・引用キー、波括弧などがモデルに書き換えられないよう、
`QZPROTECTED000000XZQ` 形式の透明なマーカーへ置換します（masked）。
置換元の生の文字列は tokens に順番どおり保持し、翻訳後にマーカーと照合して
正確な LaTeX 原文へ復元します（restore_and_validate）。

マーカーはモデルが触りにくい大文字英数の連続列を選び、順序検証と
再_lex（翻訳結果をもう一度 protect_latex にかけて比較）で
モデルが新規に LaTeX 構文をねつ造していないことも確認します。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# 保護マーカーそのもの。順序番号は 6 桁の 0 埋め整数です。
MARKER_RE = re.compile(r"QZPROTECTED\d{6}XZQ")
# LaTeX コマンド（\begin, \alpha など。@ を含む内部名と 1 文字コマンドも対象）。
CONTROL_RE = re.compile(r"\\([A-Za-z@]+\*?|.)", re.DOTALL)
# 数式環境。中身は翻訳せずまとめて保護します。
MATH_ENV_RE = re.compile(
    r"\\begin\s*\{(?P<name>equation\*?|align\*?|gather\*?|multline\*?|"
    r"flalign\*?|eqnarray\*?|math|displaymath|split|cases)\}"
)
# コード・verbatim 系環境。こちらも翻訳対象外です。
CODE_ENV_RE = re.compile(
    r"\\begin\s*\{(?P<name>verbatim\*?|Verbatim|lstlisting|minted|"
    r"comment|alltt|pycode|python|bash|shell|algorithmic)\}"
)
URL_RE = re.compile(
    r"(?:https?://|www\.)[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+",
    re.IGNORECASE,
)
FILENAME_RE = re.compile(
    r"[A-Za-z0-9_./-]+\.(?:tex|bib|sty|cls|bst|png|jpe?g|pdf|eps|svg|csv|json|py|c|cpp|h|m|dat)",
    re.IGNORECASE,
)
# 段落区切り（空行）。チャンク分割の境界候補として保護もします。
PARAGRAPH_RE = re.compile(r"\n[ \t]*\n+")
# 引数の中身が「翻訳してはいけない識別子・パス・コード」であるコマンドたち。
# 引数ごとまとめてマーカーへ隠します。
OPAQUE_ARGUMENT_COMMANDS = {
    "label",
    "ref",
    "eqref",
    "pageref",
    "autoref",
    "cref",
    "Cref",
    "namecref",
    "nameref",
    "cite",
    "citep",
    "citet",
    "citeauthor",
    "citeyear",
    "parencite",
    "textcite",
    "autocite",
    "footcite",
    "supercite",
    "nocite",
    "include",
    "input",
    "subfile",
    "includegraphics",
    "graphicspath",
    "bibliography",
    "addbibresource",
    "lstinputlisting",
    "usepackage",
    "RequirePackage",
    "documentclass",
    "newcommand",
    "renewcommand",
    "providecommand",
    "DeclareMathOperator",
    "lstset",
    "setlength",
    "newlength",
    "def",
    "gdef",
    "xdef",
    "url",
    "path",
    "hrefurl",
    "texttt",
    "mathtt",
    "lstinline",
}
# 見出し・表題など、本文が短いコマンド。引数の中身は翻訳対象に残します。
TEXT_ARGUMENT_COMMANDS = {"section", "subsection", "subsubsection", "chapter", "part", "caption", "title"}
# 定義系コマンド。コマンド行の残り全体を 1 つのブロックとして保護します。
OPAQUE_LINE_COMMANDS = {
    "newcommand", "renewcommand", "providecommand", "DeclareMathOperator",
    "lstset", "setlength", "newlength", "def", "gdef", "xdef",
}
# 数式・コード環境の名前（環境全体の保護に使用）。
OPAQUE_ENVIRONMENTS = {
    "verbatim", "verbatim*", "Verbatim", "lstlisting", "minted", "comment",
    "alltt", "pycode", "python", "bash", "shell", "algorithmic",
    "equation", "equation*", "align", "align*", "gather", "gather*",
    "multline", "multline*", "flalign", "flalign*", "eqnarray", "eqnarray*",
    "math", "displaymath", "split", "cases",
}


@dataclass(frozen=True)
class ProtectedDocument:
    """保護処理の結果。masked はマーカー置換済み文書、tokens は置換元です。"""

    masked: str
    tokens: tuple[str, ...]


def _escaped(source: str, index: int) -> bool:
    """index の直前まで "\\" が連続し、その数が奇数ならエスケープ済みです。"""
    slashes = 0
    cursor = index - 1
    while cursor >= 0 and source[cursor] == "\\":
        slashes += 1
        cursor -= 1
    return slashes % 2 == 1


def _group_end(source: str, start: int, opening: str, closing: str) -> int | None:
    """start の開き括弧に対応する閉じ括弧の直後位置を返します（ネスト対応）。"""
    if start >= len(source) or source[start] != opening:
        return None
    depth = 0
    for cursor in range(start, len(source)):
        if source[cursor] == opening and not _escaped(source, cursor):
            depth += 1
        elif source[cursor] == closing and not _escaped(source, cursor):
            depth -= 1
            if depth == 0:
                return cursor + 1
    return None


def _argument_end(source: str, cursor: int) -> int:
    """コマンドに続く任意引数 [..] と必須引数 {..} を読み飛ばした位置を返します。"""
    while cursor < len(source) and source[cursor].isspace():
        cursor += 1
    if cursor < len(source) and source[cursor] == "[":
        optional_end = _group_end(source, cursor, "[", "]")
        if optional_end is not None:
            cursor = optional_end
            while cursor < len(source) and source[cursor].isspace():
                cursor += 1
    if cursor < len(source) and source[cursor] == "{":
        return _group_end(source, cursor, "{", "}") or cursor
    return cursor


def _math_end(source: str, start: int, delimiter: str) -> int | None:
    """$...$ や $$...$$ の閉じ区切り位置（閉じ区切りの直後）を返します。"""
    cursor = start + len(delimiter)
    while True:
        cursor = source.find(delimiter, cursor)
        if cursor == -1:
            return None
        if not _escaped(source, cursor):
            return cursor + len(delimiter)
        cursor += len(delimiter)


def _environment_end(source: str, start: int, name: str) -> int | None:
    r"""\begin{nam} に対応する \end{nam} の直後位置を返します。"""
    closing = re.compile(r"\\end\s*\{" + re.escape(name) + r"\}")
    match = closing.search(source, start)
    return match.end() if match else None


def _opaque_command_end(source: str, command_end: int, name: str) -> int:
    """保護対象コマンドの引数範囲（保護すべき末尾位置）を決めます。

    定義系（OPAQUE_LINE_COMMANDS）は行末まで、その他は任意引数・必須引数を
    含めた括弧ブロックの末尾までを 1 つの保護単位とします。
    """
    base_name = name.removesuffix("*")
    cursor = command_end
    if base_name in OPAQUE_LINE_COMMANDS:
        return _protected_line_end(source, cursor)
    while cursor < len(source) and source[cursor].isspace():
        cursor += 1
    if cursor < len(source) and source[cursor] == "[":
        optional_end = _group_end(source, cursor, "[", "]")
        if optional_end is not None:
            cursor = optional_end
            while cursor < len(source) and source[cursor].isspace():
                cursor += 1
    if cursor < len(source) and source[cursor] == "{":
        return _group_end(source, cursor, "{", "}") or command_end
    return command_end


def _protected_line_end(source: str, start: int) -> int:
    """コメント・定義行は改行と直後の空行まで一緒に保護します。

    改行だけをモデルに渡すと、削除されたときに次の本文までコメント扱いに
    なります。行末を同じマーカーに含め、原文の有効範囲を保ちます。
    """
    newline = source.find("\n", start)
    if newline == -1:
        return len(source)
    suffix = re.match(r"\n(?:[ \t]*\n)*", source[newline:])
    return newline + suffix.end()


def _consume_inline_verb(source: str, start: int, command_end: int) -> int | None:
    r"""\verb|...| や \lstinline|...| の区切り文字形式を読み取った末尾位置を返します。"""
    cursor = command_end
    if cursor < len(source) and source[cursor] == "*":
        cursor += 1
    if source.startswith("lstinline", start + 1) and cursor < len(source) and source[cursor] == "[":
        optional_end = _group_end(source, cursor, "[", "]")
        if optional_end is not None:
            cursor = optional_end
    if cursor >= len(source) or source[cursor].isspace():
        return None
    delimiter = source[cursor]
    end = source.find(delimiter, cursor + 1)
    return end + 1 if end != -1 else len(source)


def protect_latex(source: str) -> ProtectedDocument:
    """コマンド・コメント・数式・コード・構造括弧を保護マーカーへ置換します。

    左から右へ 1 文字ずつ進み、保護すべき区間を見つけてはマーカー化します。
    残った散文（日本語本文）は masked にそのまま残り、翻訳対象になります。
    """
    tokens: list[str] = []
    output: list[str] = []

    def protect(raw: str) -> None:
        """生の LaTeX 文字列を 1 個の保護ブロックとして登録します。"""
        marker = f"QZPROTECTED{len(tokens):06d}XZQ"
        tokens.append(raw)
        output.append(marker)

    cursor = 0
    plain_start = 0
    length = len(source)

    def flush_plain(until: int) -> None:
        """plain_start から until までの散文部分を output へ写します。"""
        nonlocal plain_start
        if plain_start < until:
            output.append(source[plain_start:until])
        plain_start = until

    while cursor < length:
        end: int | None = None

        # 原文に同じ書式の文字列があっても、生成したマーカーと混同しません。
        # リテラル自身を保護するため、復元後の再検証でも同じ構造になります。
        literal_marker = MARKER_RE.match(source, cursor)
        if literal_marker:
            flush_plain(cursor)
            end = literal_marker.end()

        # 段落境界（空行）は整形の単位なので保護し、行折り返し本文は編集可能に残します。
        paragraph = PARAGRAPH_RE.match(source, cursor)
        if end is None and paragraph:
            flush_plain(cursor)
            end = paragraph.end()

        # コメント（% から行末）は翻訳しない不活性な LaTeX ソースです。
        # \% のようにエスケープされたパーセント記号は本文の一部なので無視します。
        if end is None and source[cursor] == "%" and not _escaped(source, cursor):
            flush_plain(cursor)
            end = _protected_line_end(source, cursor)

        if end is None:
            # URL・ファイル名は書き換え厳禁です。文末の句読点は URL の一部から除きます。
            url = URL_RE.match(source, cursor)
            filename = None if url else FILENAME_RE.match(source, cursor)
            if url or filename:
                flush_plain(cursor)
                match = url or filename
                end = match.end()
                if url:
                    while end > cursor and source[end - 1] in ".,;:!?":
                        end -= 1
                    if end == cursor:
                        end = match.end()

        if end is None:
            # 数式環境・コード環境は \end までまとめて保護します。
            math_env = MATH_ENV_RE.match(source, cursor)
            code_env = CODE_ENV_RE.match(source, cursor)
            environment = math_env or code_env
            if environment:
                flush_plain(cursor)
                end = _environment_end(source, environment.end(), environment.group("name"))
                end = length if end is None else end

        # 行内・表示数式の区切り形式（$$..$, $..$, \[..\], \(..\)）も保護します。
        if end is None and source.startswith("$$", cursor):
            flush_plain(cursor)
            end = _math_end(source, cursor, "$$") or cursor + 2
        if end is None and source[cursor] == "$" and not _escaped(source, cursor):
            flush_plain(cursor)
            end = _math_end(source, cursor, "$") or cursor + 1
        if end is None and (source.startswith(r"\[", cursor) or source.startswith(r"\(", cursor)):
            flush_plain(cursor)
            closing = r"\]" if source.startswith(r"\[", cursor) else r"\)"
            end = source.find(closing, cursor + 2)
            end = length if end == -1 else end + 2

        if end is None and source[cursor] == "\\":
            # コマンドは性質ごとに保護方針を変えます。
            command = CONTROL_RE.match(source, cursor)
            if command:
                name = command.group(1)
                base_name = name.removesuffix("*")
                command_end = command.end()
                if name in {"verb", "verb*", "lstinline", "lstinline*"}:
                    # \verb|..| のような区切り文字形式のコードを保護します。
                    flush_plain(cursor)
                    end = _consume_inline_verb(source, cursor, command_end)
                elif base_name in OPAQUE_ARGUMENT_COMMANDS:
                    # 参照・引用・パッケージ指定など、引数が機械的な情報のもの。
                    flush_plain(cursor)
                    end = _opaque_command_end(source, command_end, name)
                elif name in {"begin", "end"}:
                    # 環境名と区切りそのものは散文ではないため、環境名部分だけ保護し、
                    # 本文（散文を含む環境）は翻訳対象へ残します。
                    flush_plain(cursor)
                    end = _argument_end(source, command_end)
                    if name == "begin" and end > command_end:
                        option_start = end
                        while option_start < length and source[option_start].isspace():
                            option_start += 1
                        if option_start < length and source[option_start] == "[":
                            option_end = _group_end(source, option_start, "[", "]")
                            if option_end is not None:
                                end = option_end
                    if end == command_end:
                        end = command_end
                    # Environment names and delimiters are never prose.
                    protect(source[cursor:end])
                    cursor = end
                    plain_start = cursor
                    continue
                elif name == "href":
                    # \href{URL}{本文} の本文側は翻訳可能なので、{URL} 部分だけを保護します。
                    flush_plain(cursor)
                    url_start = command_end
                    url_start = _argument_end(source, url_start)
                    if url_start > command_end:
                        while url_start < length and source[url_start].isspace():
                            url_start += 1
                        if url_start < length and source[url_start] == "{":
                            protect(source[cursor:url_start + 1])
                            cursor = url_start + 1
                            plain_start = cursor
                            continue
                elif base_name in TEXT_ARGUMENT_COMMANDS:
                    # 見出し・表題は短い本文なので、コマンド名と [省略見出し] だけ保護し、
                    # 必須引数 {見出し本文} は翻訳対象として残します。
                    option_start = command_end
                    if option_start < length and source[option_start] == "*":
                        command_end += 1
                    if command_end < length and source[command_end] == "[":
                        flush_plain(cursor)
                        protect(source[cursor:command_end + 1])
                        cursor = command_end + 1
                        plain_start = cursor
                        continue
                elif name == "\\" or (len(name) == 1 and not name.isalpha()):
                    # \\（改行）や \{ などの 1 文字コマンドはそのまま保護します。
                    flush_plain(cursor)
                    end = command_end

                # 未知の独自マクロも含め、コマンド名は必ず保護します。
                # 引数の散文は残し、波括弧は次の走査で個別に保護します。
                # これにより \textbf → \textit のような書き換えも検出できます。
                if end is None:
                    flush_plain(cursor)
                    end = command_end

        if end is None and source[cursor] in "{}&#_^":
            # 波括弧・表の列区切り・マクロ引数記号・添字なども構造です。
            # 新たな & や _ が散文に挿入された場合も、再検証で拒否できます。
            flush_plain(cursor)
            end = cursor + 1

        if end is not None:
            protect(source[cursor:end])
            cursor = end
            plain_start = cursor
        else:
            cursor += 1

    flush_plain(length)
    return ProtectedDocument("".join(output), tuple(tokens))


def split_chunks(
    masked: str,
    max_chars: int = 3600,
    protected_tokens: tuple[str, ...] = (),
) -> list[str]:
    """保護マーカーを割らず、段落・文の境界でチャンクへ分割します。

    分割位置は (1) 空行、(2) 改行、(3) 空白、(4) 段落マーカー の後ろから
    望ましい方を選び、どれもない場合だけ強制的に切ります。その場合も
    マーカーの途中では切らないよう位置を戻します。
    """
    if max_chars <= 0:
        raise ValueError("Chunk size must be positive")
    if len(masked) <= max_chars:
        return [masked]
    chunks: list[str] = []
    start = 0
    marker_spans = [match.span() for match in MARKER_RE.finditer(masked)]
    # 段落区切りそのものが保護されていた場合、そのマーカー位置も境界候補に加えます。
    paragraph_spans = []
    for match in MARKER_RE.finditer(masked):
        marker_index = int(match.group(0)[len("QZPROTECTED") : -len("XZQ")])
        if marker_index < len(protected_tokens) and re.fullmatch(
            r"\n[ \t]*\n+", protected_tokens[marker_index]
        ):
            paragraph_spans.append(match.span())
    while start < len(masked):
        hard_end = min(start + max_chars, len(masked))
        # 上限位置がマーカーの途中を指す場合、そのマーカーの手前まで縮めます。
        for marker_start, marker_end in marker_spans:
            if marker_start < hard_end < marker_end:
                # 上限より長いマーカーであっても分割せず、一単位として進めます。
                # start と同じ位置へ戻し続ける無限ループを防ぎます。
                hard_end = marker_end if marker_start == start else marker_start
                break
        if hard_end <= start:
            hard_end = min(start + max_chars, len(masked))
        if hard_end < len(masked):
            # 後半（max_chars の半分以上）に境界候補があれば、そこを優先します。
            lower_bound = start + max(1, max_chars // 2)
            candidates = [
                masked.rfind("\n\n", start, hard_end),
                masked.rfind("\n", lower_bound, hard_end),
                masked.rfind(" ", lower_bound, hard_end),
            ]
            candidates.extend(
                paragraph_end - 1
                for paragraph_start, paragraph_end in paragraph_spans
                if lower_bound <= paragraph_start < hard_end
            )
            split_at = max(candidates)
            if split_at >= lower_bound:
                hard_end = split_at + (2 if masked.startswith("\n\n", split_at) else 1)
        if hard_end <= start:
            hard_end = min(start + max_chars, len(masked))
        # 境界調整で再びマーカーの途中へ入った場合、マーカー先頭へ戻します。
        for marker_start, marker_end in marker_spans:
            if marker_start < hard_end < marker_end:
                hard_end = marker_end if marker_start == start else marker_start
                break
        chunks.append(masked[start:hard_end])
        start = hard_end
    return chunks


def restore_and_validate(original: ProtectedDocument, translated_masked: str) -> str:
    """全文翻訳の結果を検証し、保護マーカーを LaTeX 原文へ戻します。

    検証は 2 段構えです。
    (1) マーカーの列が原文と完全一致（追加・欠落・並べ替えの排除）。
    (2) 復元結果をもう一度 protect_latex へかけ、tokens が原文と一致すること
        （モデルが新規の LaTeX コマンドや括弧をねつ造していないことの確認）。
    不一致は ValueError とし、呼び出し側で結果を適用しません。
    """
    actual_markers = MARKER_RE.findall(translated_masked)
    expected_markers = list(re.finditer(MARKER_RE, original.masked))
    expected = [match.group(0) for match in expected_markers]
    if actual_markers != expected:
        raise ValueError("The translation changed or removed protected LaTeX structure.")

    token_by_marker = {
        f"QZPROTECTED{index:06d}XZQ": raw
        for index, raw in enumerate(original.tokens)
    }
    restored = MARKER_RE.sub(lambda match: token_by_marker[match.group(0)], translated_masked)

    # Re-lex the result to catch LaTeX commands/braces newly introduced by the model.
    translated_structure = protect_latex(restored)
    if translated_structure.tokens != original.tokens:
        raise ValueError("The translation introduced, removed, or altered LaTeX syntax.")
    return restored


def document_context(source: str, masked: str, limit: int = 2600) -> str:
    """文書全体の要約（見出し一覧と冒頭・末尾の散文抜粋）を作ります。

    翻訳中のチャンクだけを見ても失われる論文全体の文脈を、各チャンクの
    プロンプトへ添えるために使います。
    """
    headings = re.findall(
        r"\\(?:part|chapter|section|subsection|subsubsection)\*?\s*\{([^{}]{1,180})\}",
        source,
    )
    # マーカーと残ったコマンドを削って散文だけを取り出し、空白をまとめます。
    prose = MARKER_RE.sub(" ", masked)
    prose = re.sub(r"\\[A-Za-z@]+\*?", " ", prose)
    prose = re.sub(r"\s+", " ", prose).strip()
    lines = []
    if headings:
        lines.append("Document headings: " + " / ".join(headings[:24]))
    if prose:
        lines.append("Opening document context: " + prose[: max(0, limit - 1200)])
        lines.append("Closing document context: " + prose[-800:])
    return "\n".join(lines)[:limit]
