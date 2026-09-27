# リズムの覚えやすさ:対照と評価の設計(案)

Codex desktop との合意(PR #174)にもとづく設計案。新しいリズムの物差しは、この手順で確かめるまで選抜に使わない。

## 研究から分かっていること

| 手がかり | 内容 | 出典 |
|---|---|---|
| リズムだけでは曲を思い出しにくい | 長期記憶にある曲の手がかりとして、リズムだけでは弱い。最もよく思い出されたのは、音高と音価が正しく組み合わさったとき | Hébert & Peretz (1997) *Memory & Cognition* 25 |
| シンコペーションが強いと記憶に残りにくい | 24時間後の再認では、単純なリズムの方がシンコペーションの強いリズムよりしっかり覚えられていた。強いシンコペーションは、弱いものとして「聴き直される」ことがあった | Fitch & Rosenfeld (2007) *Music Perception* 25(1) |
| 拍の感覚を強く生むリズムほど、正しく再現しやすい | 聴き手は、長い音や区切りの位置(局所的なアクセント)から内なる拍を作る。アクセントが拍の上に並ぶほど拍を強く作れ、再現もしやすい | Povel & Essens (1985) *Music Perception* 2(4) |
| 覚えられるのは長短の「輪郭」 | 短期記憶では、隣り合う音の長い・短いの並び(リズムの輪郭)が変わると違いに気づきやすく、輪郭が同じなら音価が多少違っても気づきにくい | Schmuckler & Moranis (2023) *Attention, Perception, & Psychophysics* |
| くり返しは規則的な位置にあると見つけやすい | くり返しを見つけやすいのは、それが時間的に規則的な位置で起きるとき | Rajendran, Harper, Abdel-Latif & Schnupp (2016) *Frontiers in Neuroscience* 10 |

- 1つ目は、「核のリズムだけの物差しでは、16組の好みを説明できなかった」という今回の結果と合っている。
- 2〜4つ目は、測る候補になる。

## 測る候補(選抜には使わない)

1. **シンコペーションの強さ**(Longuet-Higgins & Lee の指標。Fitch & Rosenfeld が使ったもの)。予想:弱い方が覚えやすい。
2. **拍を作る強さ**(Povel & Essens のクロック指標)。予想:強い方が覚えやすい。
3. **リズムの輪郭のくり返し**。音価そのものではなく、隣り合う音の「長い・短い・同じ」の並びが、核の中や曲の中でくり返されるか。予想:くり返される方が覚えやすい。
   - 以前の物差しは音価そのものを比べていた。そのため、輪郭が同じで音価だけ違う変形を、別物と数えていた。

予想の向きは、調べる前にここに書いて固定する(結果を見てから向きや重みを変えない)。

## 対照(合成の最小例)

音高・音数・総発音長を固定し、配置と休符だけを変える。既存の曲の音型は使わない。

| 対照 | A | B | 予想 |
|---|---|---|---|
| 拍を作る強さ | 長い音が拍の頭に並ぶ | 同じ音価の並びで、長い音が裏拍に来る | A が高い(Povel & Essens) |
| シンコペーション | 弱い | 同じ音価のまま、発音位置を裏へずらす | A が高い(Fitch & Rosenfeld) |
| 輪郭のくり返し | 長短の並びが2回くり返す(2回目は音価を少し変える) | 同じ音価の組で、輪郭がくり返さない | A が高い(Schmuckler & Moranis) |

それぞれ、指標が予想の向きに順位を付けることを単体テストにする(実装の確認であって、好みの証拠ではない)。

## 評価(未使用のデータで)

1. これまでに使っていない seed と進行で、サビの最終候補の組を 12 組作る(従来の型と素直な型、同じ条件)。これまでの 16 組は開発・診断用として使わない。
2. Codex が答えを見ずに判断する(A / B / 同程度)。判断の出典(どのレビューか)を記録する。
3. 各指標の予測と Codex の判断の一致数を数える。合格の目安:同程度を除いて 12 組中 9 組以上(偶然なら約 7% 以下)。
4. 合格した指標だけを、素直な型の選抜に加える候補にする。方向が変わる判断のときだけ、作曲者に 3 組まで聴いてもらう。

## 権利

使うのは、合成の最小例と、アプリが生成した旋律だけ。研究は論文の知見だけを参照し、実験の刺激や楽曲は使わない。

## 出典

- Hébert, S., & Peretz, I. (1997). Recognition of music in long-term memory: Are melodic and temporal patterns equal partners? *Memory & Cognition*, 25. https://link.springer.com/article/10.3758/BF03201127
- Fitch, W. T., & Rosenfeld, A. J. (2007). Perception and production of syncopated rhythms. *Music Perception*, 25(1), 43–58. https://online.ucpress.edu/mp/article-abstract/25/1/43/95281/Perception-and-Production-of-Syncopated-Rhythms
- Povel, D.-J., & Essens, P. (1985). Perception of temporal patterns. *Music Perception*, 2(4), 411–440. https://online.ucpress.edu/mp/article/2/4/411/62235/Perception-of-Temporal-Patterns
- Schmuckler, M. A., & Moranis, R. (2023). Rhythm contour drives musical memory. *Attention, Perception, & Psychophysics*. https://pubmed.ncbi.nlm.nih.gov/36991289/
- Rajendran, V. G., Harper, N. S., Abdel-Latif, K. H. A., & Schnupp, J. W. H. (2016). Rhythm facilitates the detection of repeating sound patterns. *Frontiers in Neuroscience*, 10. https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2016.00009/full
