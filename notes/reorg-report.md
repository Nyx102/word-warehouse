# Corpus reorganization report

mkdir -p worldend/official-en
mkdir -p worldend/jp
mkdir -p worldend/zh
mkdir -p worldend2/jp
mkdir -p worldend2/zh
mkdir -p inbox
mkdir -p notes
mkdir -p archive
mv 'text/worldend/WorldEnd Vol. 1.txt' -> worldend/official-en/v01.txt
mv 'text/worldend/WorldEnd Vol. 2.txt' -> worldend/official-en/v02.txt
mv 'text/worldend/WorldEnd Vol. 3.txt' -> worldend/official-en/v03.txt
mv 'text/worldend/WorldEnd Vol. 4.txt' -> worldend/official-en/v04.txt
mv 'text/worldend/WorldEnd Vol. 5.txt' -> worldend/official-en/v05.txt
mv 'text/worldend/WorldEnd #EX.txt' -> worldend/official-en/ex.txt
mv 'japanese/終末なにしてますか？ 忙しいですか？ 救ってもらっていいですか？#01 - 枯野 瑛.txt' -> worldend/jp/v01.txt
mv 'japanese/シュウマツナニシテマスカイソガシイデスカスクッテモラッテイイデスカ02 - 枯野 瑛.txt' -> worldend/jp/v02.txt
mv 'japanese/シュウマツナニシテマスカイソガシイデスカスクッテモラッテイイデスカ03デンシトクベツバン - 枯野 瑛.txt' -> worldend/jp/v03.txt
mv 'japanese/シュウマツナニシテマスカイソガシイデスカスクッテモラッテイイデスカ04 - 枯野瑛 & ue.txt' -> worldend/jp/v04.txt
mv 'japanese/シュウマツナニシテマスカイソガシイデスカスクッテモラッテイイデスカ05 - 枯野 瑛 & ｕｅ.txt' -> worldend/jp/v05.txt
mv 'japanese/シュウマツナニシテマスカモウイチドダケアエマスカ001 - 枯野 瑛 & ｕｅ.txt' -> worldend2/jp/v01.txt
mv 'japanese/シュウマツナニシテマスカモウイチドダケアエマスカ002 - 枯野 瑛 & ｕｅ.txt' -> worldend2/jp/v02.txt
mv 'japanese/シュウマツナニシテマスカモウイチドダケアエマスカ003 - 枯野 瑛 & ｕｅ.txt' -> worldend2/jp/v03.txt
mv 'japanese/シュウマツナニシテマスカモウイチドダケアエマスカ004 - 枯野 瑛 & ｕｅ.txt' -> worldend2/jp/v04.txt
mv 'japanese/末日时在做什么？有没有空？可以来拯救吗？ 2 - 枯野锳.txt' -> worldend/zh/v02.txt
mv 'japanese/末日时在做什么？有没有空？可以来拯救吗？ 03 - 枯野瑛.txt' -> worldend/zh/v03.txt
mv 'japanese/末日时在做什么？有没有空？可以来拯救吗？04 - 枯野英.txt' -> worldend/zh/v04.txt
mv 'japanese/末日时在做什么？有没有空？可以来拯救吗？ 05 - 枯野瑛.txt' -> worldend/zh/v05.txt
mv 'japanese/末日時在做什麼？有沒有空？可以來拯救嗎？5 - 枯野瑛.txt' -> worldend/zh/v05-traditional.txt
mv 'japanese/末日时在做什么？有没有空？可以来拯救吗？【EX】 - 枯野英 [枯野英] & chenjin5.com.txt' -> worldend/zh/ex.txt
mv 'japanese/末日时在做什么？能不能再见一面？ 01 - 枯野瑛.txt' -> worldend2/zh/v01.txt
mv 'japanese/末日时在做什么？能不能再见一面？ 02 - 枯野瑛.txt' -> worldend2/zh/v02.txt
mv 'japanese/末日时在做什么？能不能再见一面？ 03 - 枯野瑛.txt' -> worldend2/zh/v03.txt
mv 'japanese/末日时在做什么？能不能再见一面？ 04 - 枯野瑛.txt' -> worldend2/zh/v04.txt
write worldend/zh/v01.txt from omnibus vol-1 section (5751 lines)
mv omnibus -> archive/worldend-zh-omnibus-wenku8.txt
# Omnibus similarity check (paragraph-set overlap of omnibus section vs standalone)
- vol 2: 73.6% of omnibus paragraphs found in standalone worldend/zh/v02.txt
- vol 3: 65.4% of omnibus paragraphs found in standalone worldend/zh/v03.txt
- vol 4: 0.2% of omnibus paragraphs found in standalone worldend/zh/v04.txt
- vol 5: 83.0% of omnibus paragraphs found in standalone worldend/zh/v05.txt
- vol ex: 0.0% of omnibus paragraphs found in standalone worldend/zh/ex.txt
DELETE bilingual variant 'japanese/シュウマツナニシテマスカモウイチドダケアエマスカ004 - 枯野 瑛 & ｕｅ (1).txt'
DELETE text/worldend2 (verified duplicate of text/formatting/Volumes)
mv text/formatting -> worldend2/repo
rmdir text/worldend
rmdir text
rmdir japanese
