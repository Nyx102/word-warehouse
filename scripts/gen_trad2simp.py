#!/usr/bin/env python3
"""Generate app/trad2simp.py from parallel simplified/traditional corpus text.

Alignment: two lines from the simp and trad editions of the same translation
match if they have equal length and an identical "skeleton" (every non-Han char
identical, Han positions wildcarded). Char pairs at differing Han positions are
harvested as (trad -> simp) candidates; majority vote resolves conflicts.
"""

import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import CORPUS, ROOT  # noqa: E402

OUT = ROOT / "trad2simp.py"

# High-confidence manual seed (common chars; also covers pairs the harvest may miss)
SEED = {
    "來": "来", "沒": "没", "時": "时", "說": "说", "話": "话", "語": "语", "讀": "读",
    "寫": "写", "萬": "万", "與": "与", "體": "体", "見": "见", "現": "现", "麼": "么",
    "麽": "么", "為": "为", "爲": "为", "這": "这", "裡": "里", "裏": "里", "兩": "两",
    "點": "点", "們": "们", "個": "个", "會": "会", "學": "学", "國": "国", "問": "问",
    "間": "间", "開": "开", "關": "关", "門": "门", "聽": "听", "覺": "觉", "還": "还",
    "後": "后", "從": "从", "動": "动", "務": "务", "應": "应", "當": "当", "對": "对",
    "將": "将", "經": "经", "給": "给", "結": "结", "統": "统", "維": "维", "綠": "绿",
    "紅": "红", "級": "级", "紀": "纪", "約": "约", "縱": "纵", "織": "织", "繼": "继",
    "續": "续", "臉": "脸", "腦": "脑", "頭": "头", "頁": "页", "順": "顺", "須": "须",
    "顏": "颜", "題": "题", "額": "额", "風": "风", "飛": "飞", "食": "食", "餘": "余",
    "馬": "马", "駛": "驶", "騎": "骑", "驚": "惊", "魚": "鱼", "鳥": "鸟", "鳴": "鸣",
    "黃": "黄", "齊": "齐", "龍": "龙", "屆": "届", "歲": "岁", "歷": "历", "歸": "归",
    "殺": "杀", "氣": "气", "決": "决", "沖": "冲", "況": "况", "淚": "泪", "測": "测",
    "濟": "济", "灣": "湾", "無": "无", "煙": "烟", "熱": "热", "燈": "灯", "爭": "争",
    "牆": "墙", "物": "物", "獨": "独", "獸": "兽", "玆": "兹", "環": "环", "現": "现",
    "瑪": "玛", "甦": "苏", "產": "产", "畢": "毕", "異": "异", "當": "当", "疊": "叠",
    "發": "发", "皚": "皑", "盡": "尽", "監": "监", "盤": "盘", "直": "直", "眞": "真",
    "眾": "众", "睜": "睁", "瞭": "了", "確": "确", "碼": "码", "礎": "础", "禮": "礼",
    "萬": "万", "稱": "称", "種": "种", "穩": "稳", "窩": "窝", "競": "竞", "筆": "笔",
    "節": "节", "範": "范", "簡": "简", "籍": "籍", "類": "类", "糧": "粮", "緊": "紧",
    "縣": "县", "總": "总", "聲": "声", "聯": "联", "職": "职", "肅": "肃", "臟": "脏",
    "艦": "舰", "藝": "艺", "藥": "药", "蘭": "兰", "處": "处", "號": "号", "蟲": "虫",
    "術": "术", "衛": "卫", "製": "制", "見": "见", "規": "规", "視": "视", "親": "亲",
    "覽": "览", "觀": "观", "計": "计", "記": "记", "訓": "训", "訪": "访", "設": "设",
    "許": "许", "詞": "词", "試": "试", "詩": "诗", "誰": "谁", "課": "课", "調": "调",
    "談": "谈", "論": "论", "諸": "诸", "謝": "谢", "識": "识", "譯": "译", "議": "议",
    "護": "护", "讓": "让", "豐": "丰", "貝": "贝", "負": "负", "財": "财", "貨": "货",
    "責": "责", "貴": "贵", "買": "买", "費": "费", "資": "资", "賦": "赋", "質": "质",
    "賽": "赛", "贊": "赞", "車": "车", "軍": "军", "輕": "轻", "輛": "辆", "輪": "轮",
    "轉": "转", "辦": "办", "農": "农", "邊": "边", "遞": "递", "遠": "远", "適": "适",
    "選": "选", "遺": "遗", "鄉": "乡", "醫": "医", "釋": "释", "重": "重", "野": "野",
    "金": "金", "針": "针", "鈍": "钝", "鈴": "铃", "鉄": "铁", "銀": "银", "銃": "铳",
    "銳": "锐", "鋒": "锋", "鋼": "钢", "錄": "录", "錯": "错", "錢": "钱", "鍵": "键",
    "鎖": "锁", "鏡": "镜", "鐘": "钟", "鐵": "铁", "長": "长", "陣": "阵", "陰": "阴",
    "陸": "陆", "陽": "阳", "隊": "队", "階": "阶", "際": "际", "隨": "随", "險": "险",
    "隱": "隐", "雖": "虽", "雙": "双", "雜": "杂", "離": "离", "難": "难", "電": "电",
    "靈": "灵", "靜": "静", "面": "面", "韋": "韦", "音": "音", "響": "响",
}
SEED = {k: v for k, v in SEED.items() if k != v}


def is_han(c):
    return "一" <= c <= "鿿" or "㐀" <= c <= "䶿"


def skeleton(line):
    return "".join("□" if is_han(c) else c for c in line)


def norm_lines(path):
    out = []
    for i, l in enumerate(path.read_text(encoding="utf-8").splitlines()):
        l = unicodedata.normalize("NFKC", l).strip()
        if len(l) >= 10:
            out.append(l)
    return out


def main():
    simp_lines = norm_lines(CORPUS / "worldend/zh/v05.txt")
    trad_lines = norm_lines(CORPUS / "worldend/zh/v05-traditional.txt")

    by_skel = defaultdict(list)
    for l in simp_lines:
        by_skel[skeleton(l)].append(l)

    votes = Counter()
    aligned = 0
    for t in trad_lines:
        cands = by_skel.get(skeleton(t), [])
        # Unique skeleton match = reliable alignment
        if len(cands) != 1:
            continue
        s = cands[0]
        diffs = [(tc, sc) for tc, sc in zip(t, s) if tc != sc]
        if not diffs or not all(is_han(a) and is_han(b) for a, b in diffs):
            continue
        aligned += 1
        for tc, sc in diffs:
            votes[(tc, sc)] += 1

    # Majority vote per traditional char
    by_trad = defaultdict(list)
    for (tc, sc), n in votes.items():
        by_trad[tc].append((n, sc))
    table = dict(SEED)
    conflicts = 0
    for tc, lst in by_trad.items():
        lst.sort(reverse=True)
        n, sc = lst[0]
        if len(lst) > 1 and lst[1][0] == n:
            conflicts += 1
            continue
        if n >= 2 and tc != sc:
            table.setdefault(tc, sc)

    print(f"aligned lines: {aligned}, harvested pairs: {len(table) - len(SEED)} "
          f"(+{len(SEED)} seed), ambiguous skipped: {conflicts}")

    # Validation: coverage over ALL traditional files
    trad_files = sorted(CORPUS.glob("worldend2/zh/v0[5-9].txt")) + \
        sorted(CORPUS.glob("worldend2/zh/v1[01].txt")) + \
        [CORPUS / "worldend/zh/v05-traditional.txt"]
    residual = Counter()
    total_han = 0
    for p in trad_files:
        for c in p.read_text(encoding="utf-8"):
            if is_han(c):
                total_han += 1
                if c not in table:
                    residual[c] += 1
    # Chars not in the table are either shared (identical in both scripts) or unmapped-trad;
    # estimate unmapped-trad by checking against seed's value set + simp corpus frequency
    simp_corpus = (CORPUS / "worldend2/zh/v01.txt").read_text(encoding="utf-8") + \
        (CORPUS / "worldend/zh/v04.txt").read_text(encoding="utf-8")
    simp_chars = set(c for c in simp_corpus if is_han(c))
    suspicious = [(c, n) for c, n in residual.most_common(80) if c not in simp_chars]
    print(f"table size: {len(table)}; residual han occurrences not in table: "
          f"{sum(residual.values())}/{total_han}")
    print("top residual chars ABSENT from simplified corpus (likely unmapped traditional):")
    print("  " + " ".join(f"{c}:{n}" for c, n in suspicious[:60]))

    body = ["# Generated by scripts/gen_trad2simp.py — do not edit by hand.",
            "TABLE = {"]
    for tc in sorted(table):
        body.append(f"    {tc!r}: {table[tc]!r},")
    body += ["}", "",
             "_TRANS = str.maketrans(TABLE)", "",
             "def to_simplified(text: str) -> str:",
             "    return text.translate(_TRANS)", ""]
    OUT.write_text("\n".join(body), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
