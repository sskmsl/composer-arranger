# Composer OS — Composer Arranger 仕様書

- Version: 1.5 Final
- Status: Product Specification
- 対象環境: Logic Pro 12
- 連携対象: Composer OS Chord Generator / Logic Pro 12
- 基本方針: Local First / AIは提案者 / 作曲者が最終決定者
- ターゲット世界観: Fairlight CMI、Prophet-5、DX7、LinnDrum、オーケストラルテクスチャを中核とし、Woodkidのシネマティック方向を補助線とする、ヨーロピアン・シネマティックサウンド

### 改訂履歴

- v1.0: 初稿
- v1.1: レビュー指摘を反映。生成エンジンの実装方式を明記（9.0）、技術スタック・保存形式を追記（16章）、モチーフ統一性の評価基準を追記（5.2・9.6）、UI言語・Undo粒度・コード判定方式の未決事項を明記（7章・10章・6.2）
- v1.2: 製品名をComposer Arrangerへ拡張。同一アプリ内にMelody・Arrangement・Auditionの3モジュールを定義し、音によるA/B比較、Logic ProとのMIDI／ステム往復、段階的なアレンジ生成を追加。
- v1.3: 「唯一無二の世界観」に対する接続不足を是正。Emotional/Arrangement Profileを単一のSong Profileへ統合（7章）し、Phase別のProfile反映範囲を明記（19章）。Role Allocator／Part GeneratorsにBoutonnat期の音色的アンカーを付与（9.8.2・9.8.4）。Energy Plannerに非対称性パラメータを追加（9.8.1）。Arrangement ScoringにProfile整合性軸を追加（9.8.5）。プレビュー音色をProfile連動に変更（12章）。成功指標に世界観の一貫性を追加（21章）。
- v1.4: Song ProfileのPhase記述を修正。Core Aestheticを追加し、固定世界観とSong Profileを分離。Composer ProjectへSong ProfileとArrangement Settingsを追加。音声解析をStereo Analysis／Stem-Assisted Analysisへ分割。音色アンカーを固定指定から重み付けへ変更。Asymmetry Intentを数値化。候補操作を種別ごとに整理。Product VersionとPhaseの対応、Song Profile差分の検証条件、Cinematic Expansion Anchorを追加。
- v1.5: Core Aestheticの和声記述をSong Profile名（Dark Romantic）と重複しない語彙へ修正（3.9）。Cinematic Expansion AnchorをEnergy Plannerへ接続（9.8.1）。Arrangement Settingsの数値レンジ（0.0〜1.0）を明文化（7章）。Arrangement客観的特徴量を新設（3.3b）。schemaVersionを1.1へ改め、旧schemaVersion読込時のデフォルト値方針を追記（16.0）。最終版として確定。

---

## 1. 製品概要

Composer Arrangerは、コード進行、曲のセクション、任意の短いモチーフを入力として、メロディ案とアレンジ案を提案・比較・修正し、実際の音で確認してLogic Proへ受け渡す作曲支援アプリである。

完成曲を自動決定するアプリではない。

作曲者が選択、修正、発展させるための「感情のあるメロディ候補」と「物語性のあるアレンジ候補」を短時間で得ることを目的とする。

利用者から見れば1つのアプリだが、内部は次の3モジュールに分離する。

- Melody: メロディ生成・発展・改善
- Arrangement: 楽器配置、エネルギーカーブ、各パートMIDI生成
- Audition: 実音による試聴、A/B比較、Logic Proとの往復

### コアコンセプト

> Generate notesではなく、Develop musical ideas and hear the difference.

コードトーンを機械的に並べるのではなく、モチーフ、休符、反復、変奏、跳躍、緊張と解決、セクション内の頂点を設計してメロディを生成する。さらに、楽器の出入り、音域、密度、ダイナミクスを設計し、文字情報だけでなく実際の音で判断できる状態を作る。

---

## 2. 製品上の位置付け

Composer OS内では、Chord Generatorとは別アプリとして実装する。

Composer Arrangerの内部にはMelody・Arrangement・Auditionを持たせる。3機能を別アプリにはせず、同一Composer Projectと同一トランスポートを共有する。

```text
Chord Generator
      ↓
Composer Project
      ↓
Composer Arranger
  ├── Melody
  ├── Arrangement
  └── Audition
      ↓
Logic Pro 12
```

Chord GeneratorとComposer Arrangerは直接密結合させず、共通のComposer Projectデータを介して連携する。一方、Composer Arranger内部の3モジュールは同じプロジェクト状態を即時共有し、書き出し・読み込みを挟まずに試聴と修正を反復できるようにする。

### 役割分担

#### Chord Generator

- コード進行を生成する
- キー、テンポ、拍子、セクションを定義する
- コードの開始位置と長さを保存する

#### Composer Arranger — Melody

- コード進行を解析する
- メロディ案を生成する
- 既存モチーフを発展させる
- 既存メロディを改善する

#### Composer Arranger — Arrangement

- セクションごとのエネルギーカーブを設計する
- 楽器の出入りと役割を定義する
- ベース、パッド、ピアノ、ストリングス等のMIDI案を生成する
- メロディを埋めず、静と動の対比を作る

#### Composer Arranger — Audition

- コード、メロディ、アレンジを実際の音で再生する
- 候補をA/B比較する
- パート単位でSolo／Muteする
- Logic Pro用MIDIを書き出す
- Logic Proから戻したWAVまたはステムを比較資料として読み込む

#### 共通

- 採用案と履歴をComposer Projectへ保存する
- 元データを破壊せずVariantとして管理する

#### 作曲者

- 案を選ぶ
- 修正する
- 採用を決定する
- 最終的な歌心と作品性を与える

---

## 3. 最重要の設計判断

### 3.1 生成数は6案を標準とする

8〜32案の大量生成は行わない。

候補が多いほど品質が上がるわけではなく、比較負荷と選択疲れが増えるためである。

標準では、リズム、輪郭、緊張度が明確に異なる6案を生成する。

追加生成はユーザー操作で行う。

### 3.2 アーティスト名によるStyle生成は採用しない

固有名詞を直接的な生成モードにはしない。

特定作品の表面的な模倣になりやすく、オリジナル作品を作る目的から外れるためである。

代わりに、音楽的な特徴を抽象化したプロファイルを使用する。

- Dark Romantic
- Cinematic French Pop
- Minimal Tension
- Dramatic Synth Pop
- Original Custom

### 3.3 類似度スコアは採用しない

固有名詞らしさ82%」のような類似度表示は実装しない。

数値の根拠を保証しにくく、制作判断を誤らせるためである。

代わりに、以下の客観的な特徴量を表示する。

- 音域
- 最大跳躍
- 平均跳躍
- 休符率
- 同音反復率
- テンション使用率
- コードトーン使用率
- シンコペーション率
- モチーフ反復率
- フレーズ最高音の位置

### 3.3b Arrangement客観的特徴量

Melody候補（3.3）と同様、Arrangement候補についても類似度スコアではなく客観的特徴量を表示する。

- パート数（セクションごと）
- 楽器の開始位置（小節単位）
- エネルギーカーブの最小値・最大値・傾斜
- 音色カテゴリの内訳（9.8.2b参照）
- ステレオ幅の変化量
- 低域帯域の重複度
- 主要音域の帯域分布

これらは9.8.5 Arrangement Scoringの評価軸、および18章受け入れ条件でのSong Profile差分検証の根拠として共有する。

### 3.4 Chord Generatorへの自動書き戻しは行わない

Composer Arrangerがコードを自動変更する機能は初期仕様に含めない。

必要な場合は「コード再検討メモ」をComposer Projectへ保存する。

例:

- サビの最高音を支えるコードへ変更候補
- 4小節目のみ属音ベースを提案
- メロディの着地点に対する代理コード候補

コード変更の決定はChord Generatorまたは作曲者が行う。

### 3.5 製品として統合し、実装として分離する

Melody、Arrangement、Auditionは別アプリにしない。

メロディとアレンジは相互依存し、音で比較する際にも同一タイムライン上で即座に切り替えられる必要があるためである。

一方で、内部実装は独立モジュールとし、Melody機能の完成前にArrangement機能が複雑化しないよう依存方向を制御する。

### 3.6 音源ホストは初期実装に含めない

Repro、Kontakt、Guitar Rig等のAUプラグインをComposer Arranger内部で直接ホストする機能は、初期仕様に含めない。

アプリ内音源は構成と演奏内容を判断するための確認用とし、最終音色はLogic Proの専用テンプレートで鳴らす。

これにより、音源管理やプラグイン互換性ではなく、作曲・編曲ロジックへ開発資源を集中する。

### 3.7 アレンジは一括完成ではなく段階生成する

一度に全パートを生成しない。

次の順序で段階的に生成する。

1. Arrangement Map
2. Bass
3. Harmonic Layers（Piano / Pad）
4. Strings
5. Drums
6. Texture / Bell / FX

各段階で実際の音を聴き、採用・修正・再生成を行う。

### 3.8 判断の主軸は音とする

コード名、音名、特徴量、内部スコアは補助情報である。

候補の採用判断は、原則としてAudition上の再生結果を基準とする。文字情報のみで採用を確定させる導線は作らない。

候補生成後は自動的に試聴可能な状態へ移行し、最低限次の比較を1クリックで行えるようにする。

- 原案と生成案
- Melody AとMelody B
- Arrangement AとArrangement B
- Melody OnlyとFull Arrangement
- Composer Arranger内プレビューとLogic Bounce

### 3.9 Core Aesthetic

Composer Arrangerは、Song Profileとは別に、全プロジェクトへ共通適用するCore Aestheticを持つ。

Core Aestheticはユーザーが選択するStyleではなく、本製品の生成思想を定義する固定ルールである。

- 半音階的な経過音とテンションを含む、単純な長短調に留まらない和声語彙
- シンセと生楽器の共存
- 静と動の明確な対比
- 長い残響と奥行き
- 音数で埋めない
- モチーフの回収
- 非解決音と余韻
- アナログ／デジタル音色の混在
- 映画的なセクション展開

Song ProfileはCore Aestheticを置き換えず、その中での表現方向を調整する。Core Aestheticの和声語彙は全Profile共通の下地であり、「Dark Romantic」という特定Profileの感情ラベルを固定的に強制するものではない。Minimal TensionやCinematic French Popであっても、この和声語彙の範囲内でテンションの密度や解決の仕方が変わるだけであり、感情的な「暗さ」自体を強制しない。

### 3.10 Cinematic Expansion Anchor

Woodkid的な方向性は選択可能なStyleではなく、映画的スケールを拡張する内部アンカーとして扱う。

- 低音ストリングスの反復
- 大型パーカッション
- ブラス的な短いアクセント
- 静かな区間と巨大な区間の落差
- 長いクレッシェンド
- 音数ではなく音圧と音域による拡大

このAnchorはDramatic Synth PopまたはCinematic French Popで重みを高めるが、全パートへ常時適用しない。

---

## 4. 対象ユーザー

### 主対象

- Logic Proでオリジナル曲を制作する作曲者
- コード進行は作れるが、歌メロの発展に時間がかかる人
- ダーク、ロマンティック、メランコリック、映画的な作品を作る人
- 自動作曲ではなく、提案を素材として使いたい人
- コード名や譜面だけでなく、実際の音を聴いて判断したい人
- Logic Pro上の音源環境を活かしながら、構成とアレンジ案を効率化したい人

### 非対象

- ワンクリックで完成曲を作りたい人
- 歌詞、ボーカル合成、ミックスまで一括生成したい人
- 特定アーティストの曲をそのまま再現したい人
- Composer Arrangerだけで最終ミックスやマスタリングまで完結させたい人

---

## 5. 必須ワークフロー

Melodyモジュールには3つの主要モードを実装する。ArrangementとAuditionは後述の専用ワークフローを持つ。

### 5.1 Generate from Chords

コード進行から新しいメロディ案を生成する。

#### 入力

- コード進行
- キー
- テンポ
- 拍子
- セクション
- 対象小節
- 音域
- 密度
- Song Profile

#### 出力

- 6つのメロディ候補
- 各候補のMIDI
- 音域・跳躍・休符・テンション等の特徴量
- モチーフ構造
- 簡潔な生成意図

---

### 5.2 Develop a Seed

ユーザーが入力した1〜4小節のモチーフを発展させる。

#### 操作

- Continue: 続きを生成
- Variation: リズムまたは音程を変奏
- Answer Phrase: 応答フレーズを生成
- Expand: 2小節を4小節または8小節へ発展
- Lift: サビ向けに音域とエネルギーを上げる
- Restrain: Aメロ向けに音数と音域を抑える

#### 重要方針

入力されたモチーフの識別性を保持する。

完全に別の旋律へ置き換えない。

#### 識別性の判定基準

「識別性を保持している」状態を、以下3項目の一致度で判定する（9.6のモチーフ統一性スコアに反映する）。

- 音程輪郭の一致度: 跳躍方向（上行／下行／同音）の並びが、入力モチーフとどの程度一致するか
- リズムパターンの一致度: 音価と休符位置の並びが、入力モチーフとどの程度一致するか
- 開始音の一致: 最初の1〜2音が入力モチーフと一致しているか

3項目のうち2項目以上が高い一致度を示す場合を「識別性を保持している」と判定する。

---

### 5.3 Improve Existing Melody

既存MIDIのメロディを読み込み、選択範囲のみ改善案を生成する。

#### 改善方向

- より歌いやすくする
- 余白を増やす
- 緊張感を増やす
- サビの解放感を強める
- モチーフの統一感を高める
- コードトーン追従を減らす
- 着地点を改善する

#### 出力

原案を保持したまま、変更量の異なる3段階を提示する。

- Light: 最小限の修正
- Medium: 輪郭を維持した再構成
- Bold: モチーフを残した大胆な再提案

---

## 5.4 Generate Arrangement Map

コード、メロディ、セクション構成から、楽器を鳴らす前の「編曲設計図」を生成する。

### 入力

- セクション一覧
- コード進行
- Active Melody
- Song Profile
- Drama
- 目標とする最大パート数
- 使用可能なパート種別

### 出力

- 小節単位のエネルギーカーブ
- 楽器の参加／退出
- 各パートの役割
- 音域方針
- リズム密度
- トランジション指示
- 余白を作る区間

### 重要方針

Arrangement MapはMIDI生成より先に作る。

音数を増やすことを「盛り上がり」とみなさず、音域、音価、アタック、ステレオ幅、ダイナミクスを含めてエネルギーを設計する。

---

## 5.5 Generate Arrangement Parts

Arrangement Mapに基づき、必要なパートのみMIDIを生成する。

### 初期対応パート

- Bass
- Piano / Arpeggio
- Pad
- Strings High
- Strings Low

### 後期対応パート

- Drums
- Guitar Texture
- Bell / Mallet
- Counter Melody
- Transition FX Trigger

### 操作

- Generate Part
- Regenerate Selected Bars
- Simplify
- Intensify
- Raise Register
- Lower Register
- Make Space for Melody
- Lock Part
- Mute / Solo

### 制約

- Active Melodyと同一音域へ常時集中しない
- 全パートを常時演奏させない
- セクションごとに主役を1〜2パートへ絞る
- 低域の重複を避ける
- ストリングスやパッドはコードの単純な全音保持に限定しない

---

## 5.6 Audition and Compare

文字や数値ではなく、実際の音で候補を比較する。

### 比較対象

- Melody Variant
- Arrangement Map Variant
- Part Variant
- Full Arrangement Variant

### 操作

- Play
- Stop
- Loop
- A/B
- Blind Compare
- Solo
- Mute
- Level
- Pan
- Candidate Switch
- Favorite
- Reject
- Comment at Bar

### 試聴モード

- Melody Only
- Chords + Melody
- Rhythm Section
- Harmonic Layers
- Full Arrangement
- Reference Bounce

---

## 5.7 Logic Pro Round Trip

Composer ArrangerとLogic Pro 12の間で、MIDIと音声を往復する。

### Composer Arranger → Logic Pro

- SMF Type 1
- セクションマーカー
- パート別トラック
- Variant名
- テンポ
- 拍子
- ベロシティ
- 任意のCC情報

### Logic Pro → Composer Arranger

- Stereo WAV / AIFF
- パート別ステム
- 更新したMIDI
- 任意のセクション範囲

### 音声の扱い

初期段階では音声を自動的にMIDIへ復元しない。

音声解析は、入力形式に応じて2段階に分ける。

#### Stereo Analysis

ステレオバウンスのみで解析可能な項目。

- ラウドネス
- セクション間の音量差
- スペクトルバランス
- ダイナミックレンジ
- 低域エネルギー
- 高域密度
- 無音と余白
- クレストファクター

#### Stem-Assisted Analysis

メロディ、ベース、ドラム等のステムがある場合に解析する項目。

- メロディと伴奏のマスキング
- ベースとキックの低域衝突
- ストリングスとパッドの音域重複
- パート別ダイナミクス
- セクションごとのパート過密

ステレオバウンスのみの場合、特定パート間の衝突を断定せず、「可能性が高い」等の補助的な表現に留める。

解析結果は「修正候補」として表示し、元MIDIの自動上書きは行わない。

---

## 5.8 推奨制作フロー

```text
1. Chord Generatorでコードと構成を作る
2. Composer ProjectをComposer Arrangerで開く
3. Melodyで6案を生成・選択する
4. Develop / Improveでモチーフを育てる
5. Arrangement Mapを3案生成する
6. アプリ内音源でA/B比較する
7. 必要なパートだけMIDI生成する
8. Logic Proテンプレートへ書き出す
9. Repro / Kompleteで本来の音色を割り当てる
10. WAVまたはステムをComposer Arrangerへ戻す
11. 問題区間だけ再生成・再配置する
```

---

## 6. 入力仕様

### 6.1 Composer Project読込

最優先の入力形式とする。

Chord Generatorから次の情報を受け取る。

- Project ID
- 曲名
- キー
- テンポ
- 拍子
- セクション一覧
- コード記号
- コード開始位置
- コード長
- ベース音
- 任意のムード情報
- 任意の制作メモ

### 6.2 MIDI読込

SMF Type 0およびType 1を読み込める。

#### MIDI読込時の扱い

- テンポを取得する
- 拍子を取得する
- ノートイベントを取得する
- コードトラック候補をユーザーが選択する
- 自動コード判定結果を表示する
- 誤判定を手動修正できる

MIDIのみからのコード認識は補助機能とし、Composer Projectのコード情報を正とする。

自動コード判定は、Chord Generator側に既存の判定ロジックがあればそれを流用することを優先し、なければ軽量なルールベース判定（音高集合とコードテンプレートの照合）を新規実装する。統計/ML方式の採用は行わない（9.0参照）。

### 6.3 手動入力

以下の形式でコードを直接入力できる。

```text
F#m(add9) | E | D | Dsus2
```

コードごとの長さを指定できる。

---

## 7. ユーザー設定

初期画面に表示する設定は必要最小限とする。画面上部には `[ Melody ] [ Arrangement ] [ Audition ]` の3タブを配置し、同一タイムラインと同一Composer Projectを共有する。

### 表示言語

UIラベルは日本語表示を基本とし、本仕様書中の英語表記（Sparse / Balanced / Active 等）は内部識別子として扱う。表示文言（例: 「密度」「バランス型」）は別途ローカライズ用語集で定義する。

### 基本設定

#### Section Role

- Intro
- Verse
- Pre-Chorus
- Chorus
- Breakdown Chorus
- Grand Chorus
- C-Melody
- Bridge
- Outro
- Instrumental

#### Song Profile（旧: Emotional Profile / Arrangement Profile）

Composer Project単位で1つ設定する。MelodyとArrangementの両エンジンが同一の値を参照し、セクション単位の上書きのみ許容する（例: サビだけDramatic Synth Popへ一時的に切り替える）。MelodyとArrangementが独立して異なるProfileを持つことは初期仕様では認めない。曲全体として世界観が分裂することを防ぐための制約である。

- Dark Romantic
- Cinematic French Pop
- Minimal Tension
- Dramatic Synth Pop
- Original Custom

各値の音楽的な意味は「9.9 Song Profileパラメータ定義」で規定する。

#### Density

- Sparse
- Balanced
- Active

#### Range

- Low
- Middle
- High
- Custom

#### Drama

- Restrained
- Growing
- Open

### 詳細設定

通常は折りたたんで表示する。

- 最低音
- 最高音
- 最大跳躍
- 休符量
- シンコペーション量
- テンション使用量
- 同音反復量
- フレーズ長
- クライマックス位置
- 終止の解決度
- ランダムシード

### Arrangement基本設定

- Maximum Parts: 同時発音する主要パート数
- Energy Curve: セクションごとのエネルギー
- Space Priority: メロディのための余白
- Rhythm Activity: 伴奏リズムの活動量
- Stereo Width Intent: 狭い／段階的に広げる／広い
- Acoustic / Synthetic Balance: 生楽器とシンセの比率
- Asymmetry Intent: フレーズ長・展開タイミングの均等/不均等の度合い
- Song Profile: 上記「Song Profile」を参照する（Arrangement専用の別設定は持たない）

数値パラメータの型: Stereo Width Intentを除き、Space Priority、Rhythm Activity、Acoustic/Synthetic Balance、Asymmetry Intentはいずれも0.0〜1.0に正規化された実数値とする。Stereo Width Intentのみ「狭い／段階的に広げる／広い」の3値列挙とする。

### Audition基本設定

- Preview Sound Set
- Melody Level
- Chord Level
- Arrangement Level
- Metronome
- Count-in
- Loop Range
- A/B切替方法
- Logic Round Trip Folder

---

## 8. セクション別生成ルール

### 8.1 Intro

- 歌メロよりモチーフ性を優先
- 休符とロングトーンを多くする
- 1〜3音の識別可能な核を作る
- 完全解決を避ける
- 後のセクションで再利用できる形にする

### 8.2 Verse

- 音域を狭くする
- 歌詞が置ける余白を作る
- 同音反復と順次進行を中心にする
- 最高音を温存する
- 1フレーズを歌い切らず、次小節へ持ち越すことを許容する

### 8.3 Pre-Chorus

- 音域または音価を段階的に変化させる
- サビ直前に緊張を残す
- フレーズ終端を属音またはテンションへ置く
- サビの最高音を先に使わない

### 8.4 Chorus

- 曲中の最高音候補を設定する
- 2〜4音の短いフックを作る
- 反復可能性を重視する
- 音数を増やすだけでなく、音価と跳躍で開放感を作る
- コード進行が同じ場合でもVerseと輪郭を明確に変える

### 8.5 Bridge

- 既存モチーフの変形または対照的な新モチーフを使用する
- 音域、リズム、開始拍のいずれかを変える
- Final Chorusへ戻る理由を作る

### 8.6 Breakdown Chorus

- サビのモチーフ同一性を保ちながら音数と音域を抑える
- 休符と長い音価で静けさを作る
- Grand Chorusの最高音を先に使わない
- 完全解決を急がず、次の解放へ余白を残す

### 8.7 Grand Chorus

- サビの主要モチーフを最も強い形で回収する
- 曲中の最高音候補とクライマックスを許可する
- 休符を減らし、終止の解放感を高める

### 8.8 C-Melody

- A/B/サビとは異なる新しい旋律視点を作る
- 跳躍、音域、開始拍のいずれかを明確に変える
- Grand Chorusへ向かう緊張または問いを残す

### 8.9 Instrumental

- 歌唱性よりモチーフ展開と楽器的な間を優先する
- 前後の歌セクションをつなぐ機能を持たせる

### 8.10 Outro

- Introまたは主要モチーフを回収する
- 音数を減らす
- 未解決のテンションを許容する
- 最終音を必ずルートにしない

---

## 9. メロディ生成エンジン

### 9.0 実装方式

Version 1.0〜2は、以下の理由により**ルールベース方式**（重み付き確率選択＋条件分岐）で実装する。統計モデル（コーパス学習型）や機械学習モデルの採用は行わない。

- 決定論的seed（14章・受け入れ条件13）との相性が良く、同一入力から同一結果を再現しやすい
- 学習コーパスの選定自体が3.2「アーティスト名模倣を採用しない」という設計思想と緊張関係を持つため、当面は回避する
- Local First方針（16章）に沿い、外部モデルの配布・推論コストが不要になる

統計/MLモデルの採用は、Phase 4以降の検討事項とし、採用する場合は学習データの出所と著作権整理を別途仕様化する。

生成は、ノートを一音ずつランダムに選ぶ方式ではなく、以下の順番で行う。

### 9.1 Harmonic Map

各時点について以下を計算する。

- コードトーン
- 使用可能テンション
- 経過音候補
- 前後コードとの共通音
- 半音衝突の危険
- ベースとの距離
- 解決先候補

### 9.2 Phrase Plan

先にフレーズ構造を設計する。

- フレーズ長
- 開始位置
- 休符位置
- クライマックス位置
- 上昇、下降、弧状などの輪郭
- 問いと答えの関係
- セクション末尾の緊張度

### 9.3 Rhythm Motif

音程より先にリズムの核を作る。

- 同一リズム反復
- 一部変奏
- シンコペーション
- ロングトーン
- 小節頭の休符
- フレーズの食い込み

### 9.4 Pitch Motif

2〜5音の核を生成する。

以下を評価しながら選択する。

- 歌いやすさ
- 識別性
- コードとの関係
- テンションの美しさ
- 次の音への方向性
- 音域内での位置

### 9.5 Motif Development

生成した核を次の方法で展開する。

- Repeat
- Sequence
- Inversion
- Rhythmic Variation
- Interval Expansion
- Interval Compression
- Truncation
- Answer Phrase
- Register Shift

### 9.6 Scoring

各候補を100点満点で内部評価する。

- モチーフ統一性: 25（5.2「識別性の判定基準」の音程輪郭・リズムパターン・開始音の一致度を根拠とする）
- 歌いやすさ: 20
- 和声との緊張と解決: 20
- セクション適合性: 15
- 休符と呼吸: 10
- 新規性: 10

内部スコアは順位付けに使うが、ユーザーには総合点を強調しない。

ユーザー画面には、判断に役立つ特徴量を表示する。

### 9.7 Diversity Filter

似た候補を除外する。

6案のうち少なくとも4案は、以下の2項目以上が異なること。

- リズム
- 輪郭
- 開始位置
- 最高音
- 休符配置
- 着地点
- 跳躍量

---

## 9.8 Arrangement Engine

Arrangement EngineもVersion 1.xではルールベース方式で実装する。

### 9.8.1 Energy Planner

セクションとDrama設定から、0〜100の内部エネルギー値を作る。

エネルギー値は単純なパート数へ変換せず、以下へ配分する。

- 音域
- 音価
- ベロシティ
- アタック
- リズム密度
- パート数
- ステレオ幅
- 持続音と短音の比率
- Asymmetry Intent: フレーズ長・転換タイミング・左右配置の均等／不均等度

Asymmetry Intentは0.0〜1.0で指定し、以下の生成要素へ反映する。

- 4+4小節を3+5または5+3へ変化させる確率
- パートの開始を小節頭から1〜2拍遅らせる確率
- フレーズ末尾を次小節へ持ち越す確率
- 同一モチーフの反復回数を不均等にする確率
- 左右パートの応答タイミングをずらす確率

0.0では均等な反復を優先し、1.0では非対称なフレーズ配置を積極的に許容する。

Cinematic Expansion Anchor（3.10）が有効な場合、Energy Curveの最小値と最大値のレンジを通常より広げ、立ち上がりの傾斜をより急峻にすることを許容する。音色の重み付け（9.8.2）だけでなく、エネルギーカーブの形状自体にAnchorの「静と巨大の落差」「長いクレッシェンド」という特性を反映する。

### 9.8.2 Role Allocator

各セクションでパートの役割を割り当てる。

- Foundation: Bass / Low Strings
- Harmony: Piano / Pad / Strings
- Pulse: Arpeggio / Percussion / Repeated Synth
- Hook: Bell / Guitar / Counter Melody
- Transition: Fill / Rise / Reverse / Impact
- Atmosphere: Texture / Noise / Long Reverb Tail

同一セクションで主役が過剰に競合しないよう、Primary Roleは最大2パートとする。

### 9.8.2b 時代的・音色的アンカー

各Roleは機能分類であり、音色の固定指定ではない。

Boutonnat期の質感を失わないため、Part Generatorが候補を選ぶ際の重みとして、以下の音色イメージを参照する。

- Foundation: シンセベースを高めに重み付けし、アコースティックベースは補助候補とする
- Harmony: Prophet-5的アナログパッド、DX7的ベル系ハーモニーを候補として重み付けする
- Pulse: Fairlight的サンプルスタブ、シーケンサー的な均等打ち込みを候補として許容する
- Hook: DX7ベル、Fairlight的オーケストラルヒット、ギター、カウンターメロディを候補として重み付けする
- Transition: Fairlight的なリバース／インパクト系サンプルを候補として重み付けする
- Atmosphere: アナログパッドの長い持続音、ノイズ、長いリバーブテールを候補として重み付けする

音色的アンカーは固定指定ではなく、Part Generatorが候補を選ぶ際の確率と重みに使用する。

同じSong Profileであっても、毎回同一音色カテゴリへ収束させない。

音色カテゴリの選択には、以下を反映する。

- セクション
- 既存パート
- 同一プロジェクト内での使用履歴
- 密度
- 前後セクションとの差
- Core Aesthetic
- Song Profile
- Cinematic Expansion Anchor

Fairlight、Prophet-5、DX7、LinnDrumは音色イメージの参照名として扱う。

アプリ内プレビュー音源には、独自制作または適切にライセンスされた音声素材を使用し、商標名をプリセット名として直接利用することを前提としない。

### 9.8.3 Register Planner

Active Melodyを基準に、伴奏の主要音域を配置する。

- メロディ周辺の密集を避ける
- ベースと低域パッドの重複を避ける
- Chorusでのみ上部ストリングスを開放する等、セクション差を作る
- IntroとOutroでは意図的な空洞を許容する

### 9.8.4 Part Generators

各Part GeneratorはArrangement Mapと共通Music Domain Coreを読む。

- Bass Generator
- Harmonic Layer Generator
- Strings Generator
- Drum Generator（LinnDrum的なゲート感を候補として高めに重み付けし、ヒューマナイズ量はSong Profileとセクションに応じて決定する）
- Texture Trigger Generator

Part Generator同士は直接依存せず、Arrangement Stateを介して衝突判定を行う。

### 9.8.5 Arrangement Scoring

各候補を内部評価する。

- メロディの可読性: 25
- セクション間コントラスト: 20
- パート役割の明確さ: 15
- 低域・音域の整理: 10
- モチーフ連携: 10
- 余白: 10
- Song Profile整合性: 10（9.9で定義した初期値傾向からの乖離度。3.3の方針に従い、数値そのものはユーザーへ表示せず、乖離が大きい場合のみ「Profileの想定から外れています」等の注記に留める）

総合点は内部順位付けに使い、ユーザーには理由と特徴量を表示する。

### 9.8.6 Arrangement Diversity

標準では3案を生成する。

- A: Minimal / 空間重視
- B: Balanced / 標準
- C: Dramatic / 展開重視

単なるパート数違いではなく、楽器の入口、音域、リズム、クライマックスの作り方を変える。

---

## 9.9 Song Profileパラメータ定義

### 9.9.0 反映範囲の方針

Song Profileは段階的に生成ロジックへ反映する。

- Phase 1: Composer Projectへの保存とUI表示のみ
- Phase 2: Melody Engineへ反映
- Phase 3〜4: Melodyには反映するが、Arrangementには未反映
- Phase 5以降: MelodyとArrangementの双方へ反映

生成結果に反映されない段階では、対象モジュールを明示して以下のように表示する。

- 「現在、このProfileはMelody生成には影響しません」
- 「現在、このProfileはArrangement生成には影響しません」

### 9.9.1 Melody Engineへの反映（Phase 2以降）

各Profileは、9.1〜9.7の各ステップに対して以下の初期値傾向を与える。詳細設定（7章）で個別に上書きできる。

- Dark Romantic: 半音階的な経過音を許容、フレーズ末尾は非解決終止を優先、休符率を高めに設定
- Cinematic French Pop: 順次進行中心、モチーフ反復率を高め、跳躍幅は控えめ
- Minimal Tension: 音域を狭く、同音反復率を高め、新規性スコアの重みを下げる
- Dramatic Synth Pop: 跳躍幅を広げ、フレーズ最高音の位置をセクション終盤へ集中させる
- Original Custom: 自動初期値を与えず、詳細設定の値をそのまま使う

### 9.9.2 Arrangement Engineへの反映（Phase 5以降）

Energy Planner（9.8.1）、Role Allocator（9.8.2）、Register Planner（9.8.3）に対する初期値傾向。

- Dark Romantic: Acoustic/Synthetic Balanceはシンセ優位、Stereo Width Intentは段階的に広げる、Asymmetry Intentは高め
- Cinematic French Pop: Acoustic/Synthetic Balanceは中間、Rhythm Activityは中程度、Asymmetry Intentは低め
- Minimal Tension: Space Priorityを最大化、Maximum Partsを抑制
- Dramatic Synth Pop: Energy Curveの立ち上がりを急峻にし、Stereo Widthを早期から広く取る
- Original Custom: 詳細設定の値をそのまま使う

音色的な性格（Fairlight/Prophet-5/DX7/LinnDrum、9.8.2b参照）は本項の初期値傾向とは別軸として扱い、Part Generatorsの音色イメージ選択における重み付けに反映する。

---

## 10. 候補の操作

### 10.1 Melody Candidate操作

- Preview
- Solo Melody
- Play with Chords
- Loop
- Compare A/B
- Duplicate
- Rename
- Favorite
- Reject
- Export MIDI
- Set as Active Melody
- Send to Audition

### 10.2 Arrangement Candidate操作

- Preview
- Play Full Arrangement
- Compare A/B
- Duplicate
- Rename
- Favorite
- Reject
- Set as Active Arrangement
- Export Arrangement
- Send to Audition

### 10.3 Part Variant操作

- Preview Part
- Solo
- Mute
- Duplicate
- Rename
- Favorite
- Reject
- Export Selected Part
- Set as Active Part Variant
- Regenerate Selected Bars

### 10.4 共通操作

- Loop
- Compare with Parent
- Comment at Bar
- Restore Previous Variant

### 部分編集

- ノートを移動
- 音価を変更
- ベロシティ変更
- ノート削除
- ノート追加
- 範囲選択
- 選択範囲のみ再生成

### Lock機能

以下を個別に固定できる。

- Pitch Lock
- Rhythm Lock
- Start Position Lock
- Ending Lock
- Motif Lock
- Bar Lock

固定した要素は再生成時に変更しない。

### Undo/Redoの粒度

Undo/Redoは以下2階層で扱う。

- 生成単位: 6候補の再生成、Develop a Seed操作、Improve Existing Melody操作
- ノート単位: 部分編集（ノート移動、音価変更、ベロシティ変更、ノート削除・追加）

いずれの階層でも、操作前のVariantを破壊せず保持する（受け入れ条件14）。

---

## 11. UI仕様

### 11.1 画面構成

```text
┌──────────────────────────────────────────────────────────┐
│ Project / Tempo / Key / Transport / Melody Arrangement Audition │
├──────────────┬──────────────────────────┬────────────────┤
│ Input        │ Timeline / Piano Roll    │ Intent         │
│ Chords       │ Melody / Parts / Regions │ Controls       │
│ Sections     │ Candidate Tabs           │ Analysis       │
├──────────────┴──────────────────────────┴────────────────┤
│ Mixer / A-B Compare / History / Logic Round Trip / Export │
└──────────────────────────────────────────────────────────┘
```

### 11.2 左パネル

- Composer Project
- コード進行
- セクション
- 対象小節
- 入力モチーフ
- Melody Mode
- Arrangement Map
- 使用可能パート

### 11.3 中央

- コード背景付きピアノロール
- メロディノート
- フレーズ境界
- クライマックス表示
- ロック状態
- Melody 6候補のタブ
- Arrangement 3候補のタブ
- パート別リージョン
- エネルギーカーブ
- Logicから戻した音声リージョン

### 11.4 右パネル

- Section Role
- Song Profile
- Density
- Range
- Drama
- 詳細設定
- 特徴量
- Arrangement Role
- Space / Register / Energy

### 11.5 下部

- A/B比較
- 生成履歴
- Undo / Redo
- MIDI書き出し
- Composer Project保存
- Solo / Mute / Level
- Logic Pro書き出し
- WAV / Stem読込

---

## 12. プレビュー仕様

### 必須機能

- 再生
- 停止
- ループ
- 再生位置移動
- テンポ変更
- メロディ音量
- コード音量
- メトロノーム
- 1小節カウント
- パート別Solo / Mute
- A/B候補の即時切替
- ループ切替時の再生位置維持
- ステムとMIDIプレビューの同期

### 音源

アプリ内プレビューは確認用の軽量音源とする。

最低限、Piano、Pad、Bass、Strings、Drums、Bell、Textureの音色カテゴリを持つ。Song Profile、Core Aesthetic、時代的・音色的アンカーに応じて、候補音色の重みを切り替える。例としてDark Romanticではアナログ系Padやゲート感のあるDrumsを選択しやすくするが、毎回同一音色へ固定しない。プレビューが世界観と無関係な汎用音になることを避け、3.8「判断の主軸は音」を実質的に機能させるための措置である。

最終的な音色判断はLogic Proで行う。Repro、Kontakt、Battery 4、Guitar Rig等のAUプラグインをアプリ内で直接ホストすることは初期仕様に含めない。

### 再生モード

- Melody Only
- Chords Only
- Melody + Chords
- Arrangement Parts
- Full Arrangement
- Logic Bounce / Stem

---

## 13. MIDI出力

Logic Pro 12で即座に利用できることを最優先する。

### 出力形式

SMF Type 1

### トラック構成

- Track 1: Tempo / Time Signature / Markers
- Track 2: Chords
- Track 3: Active Melody
- Track 4: Bass
- Track 5: Piano / Arpeggio
- Track 6: Pad
- Track 7: Strings High
- Track 8: Strings Low
- Track 9: Drums
- Track 10: Guitar / Texture Trigger
- Track 11: Bell / FX Trigger
- Track 12以降: 任意の比較候補

### MIDI情報

- ノート
- 音価
- ベロシティ
- テンポ
- 拍子
- セクションマーカー
- トラック名

### 出力単位

- Melody Only
- Chords + Melody
- Selected Bars
- All Candidates
- Active Arrangement
- Selected Parts
- Logic Template Package

---

## 14. Composer Project仕様

### 最小データ構造

```json
{
  "schemaVersion": "1.1",
  "projectId": "uuid",
  "title": "Untitled",
  "song": {
    "key": "F#m",
    "tempo": 76,
    "timeSignature": "4/4",
    "songProfile": "dark-romantic",
    "sectionProfileOverrides": [
      {
        "sectionId": "section-chorus",
        "songProfile": "dramatic-synth-pop"
      }
    ]
  },
  "arrangementSettings": {
    "maximumParts": 5,
    "spacePriority": 0.8,
    "rhythmActivity": 0.4,
    "stereoWidthIntent": "growing",
    "acousticSyntheticBalance": 0.35,
    "asymmetryIntent": 0.7
  },
  "sections": [
    {
      "id": "section-1",
      "name": "Intro",
      "startBar": 1,
      "lengthBars": 8
    }
  ],
  "chords": [
    {
      "id": "chord-1",
      "sectionId": "section-1",
      "startBeat": 0,
      "durationBeats": 4,
      "symbol": "F#m(add9)",
      "bass": "F#"
    }
  ],
  "melodyVariants": [
    {
      "id": "melody-1",
      "name": "Intro Idea 01",
      "sectionId": "section-1",
      "sourceMode": "generate",
      "notes": [],
      "locks": [],
      "features": {},
      "generatorVersion": "1.0",
      "seed": 12345,
      "createdAt": "ISO-8601"
    }
  ],
  "arrangementVariants": [
    {
      "id": "arrangement-1",
      "name": "Balanced Arrangement 01",
      "sourceMode": "generate",
      "energyCurve": [],
      "partAssignments": [],
      "partVariants": [],
      "generatorVersion": "1.2",
      "seed": 67890,
      "createdAt": "ISO-8601"
    }
  ],
  "audioReferences": [
    {
      "id": "audio-1",
      "type": "stereo-bounce",
      "path": "relative/path/to/bounce.wav",
      "startBar": 1,
      "lengthBars": 8,
      "createdAt": "ISO-8601"
    }
  ],
  "activeMelodyId": "melody-1",
  "activeArrangementId": "arrangement-1",
  "notes": []
}
```

### 設計原則

- Generator同士を直接通信させない
- Composer Projectを唯一の共有データとする
- 既存データを破壊せず、Variantとして保存する
- schemaVersionを必須とする
- 生成に使用したseedを保存し、再現可能にする

---

## 15. 保存と履歴

### 自動保存

編集内容をローカルへ自動保存する。

### Version

各生成結果に以下を保存する。

- Generator Version
- Generated At
- Source Mode
- Input Chord Version
- Parameter Set
- Random Seed
- Parent Melody ID
- Parent Arrangement ID
- Parent Part Variant ID
- Song Profile
- Arrangement Settings

### 履歴操作

- Undo
- Redo
- Restore Version
- Compare with Parent
- Delete Variant

---

## 16. 技術アーキテクチャ

既存Chord Generatorと同一技術スタックを優先する。

### 16.0 未決定事項（Chord Generator側の実装確認後に確定）

以下はChord Generatorの既存実装に合わせて決定する。本仕様書では選定理由のみ明記し、確定値はChord Generator仕様を参照する形で別途追記する。

- 実装言語・フレームワーク（例: Electron、ネイティブmacOSアプリ、Web＋ローカルサーバー等）
- Composer Projectのディスク上の保存形式（例: JSON単一ファイル、SQLite等）と拡張子
- Chord GeneratorとComposer Arrangerが同一Composer Projectファイルを同時に開いた場合の競合処理（ファイルロック、最終書き込み優先、マージ等）
- schemaVersion 1.0（songProfile / sectionProfileOverrides / arrangementSettingsを持たない旧形式）を読み込んだ場合のデフォルト値: songProfileは"original-custom"、sectionProfileOverridesは空配列、arrangementSettingsの数値項目は全て0.5、stereoWidthIntentは"growing"とする

UIと生成ロジックは分離する。

```text
Application UI
      ↓
Composer Arranger Use Cases
      ├── Melody Use Cases
      ├── Arrangement Use Cases
      └── Audition Use Cases
      ↓
Domain Engines
      ├── Melody Engine
      ├── Arrangement Engine
      └── Audition Engine
      ↓
Music Domain Core
      ↓
MIDI / Audio / Composer Project Adapters
```

### 必須モジュール

#### Music Domain Core

- Note
- Interval
- Scale
- Chord
- Chord Timeline
- Rhythm
- Phrase
- Section
- Melody Variant
- Arrangement Map
- Arrangement Variant
- Part Role
- Part Variant
- Energy Curve
- Audio Reference
- Logic Track Mapping

#### Melody Engine

- Harmonic Analyzer
- Phrase Planner
- Rhythm Generator
- Pitch Generator
- Motif Developer
- Candidate Scorer
- Diversity Filter

#### Arrangement Engine

- Energy Planner
- Role Allocator
- Register Planner
- Bass Generator
- Harmonic Layer Generator
- Strings Generator
- Drum Generator
- Arrangement Scorer
- Arrangement Diversity Filter

#### Audition Engine

- Transport
- Preview Sound Set
- Variant Switcher
- Part Mixer
- Audio Reference Player
- Logic Round Trip Manager

#### Adapters

- Composer Project Reader / Writer
- MIDI Importer
- MIDI Exporter
- Preview Player
- Audio Importer
- Waveform Cache
- Logic Round Trip Folder Watcher（任意）
- Local Storage

### 実装原則

- Local First
- オフライン利用可能
- 生成処理は決定論的seedに対応
- UIから生成ロジックを独立
- Melody、Bass、Strings、Drumsの各モジュールでMusic Domain Coreを共有する
- 製品としては1アプリ、コード上は独立モジュールとする
- AUプラグインホスト機能を初期アーキテクチャへ含めない

---

## 17. 非機能要件

### 性能

- 32小節、Melody 6候補の生成を通常3秒以内で完了する
- 32小節、Arrangement Map 3候補の生成を通常3秒以内で完了する
- 再生操作への反応は100ms以内を目標とする
- 生成履歴100件を保持しても操作が著しく低下しない

### 安定性

- 保存中のアプリ終了でも直前状態を復元できる
- MIDI出力失敗時に元データを失わない
- 不正なMIDIを読み込んでもアプリがクラッシュしない

### 互換性

- Logic Pro 12でMIDIを正しく読み込める
- macOS Apple Siliconを主要対象とする
- MIDIノート番号、テンポ、拍子を往復して保持する
- WAV / AIFF 44.1kHzおよび48kHzを読み込める
- Logic Proテンプレートのトラック順と出力トラック名を固定できる

### プライバシー

- 楽曲データを外部送信しない
- クラウド接続を必須にしない
- ローカルファイルの保存場所をユーザーが選択できる

---

## 18. 受け入れ条件

製品Version 1.0はPhase 1〜6を対象とし、以下を満たした時点で完成とする。Phase 7はProduct v1.1以降の対象とする。なお、仕様書自体の改訂番号（本書v1.4）とは区別する。

1. Chord Generator由来のComposer Projectを読み込める
2. 4〜32小節のコード進行に対して6候補を生成できる
3. 候補ごとにリズムと輪郭の差がある
4. コードトーンの単純な分散だけに偏らない
5. Intro、Verse、Pre-Chorus、Chorus、Bridge、Outroで生成傾向が変わる
6. 任意のノートまたは小節をロックできる
7. 選択範囲のみを再生成できる
8. 入力モチーフの続きを生成できる
9. 既存メロディにLight、Medium、Boldの改善案を出せる
10. Melody OnlyおよびChords + Melodyを試聴できる
11. Logic Pro 12向けSMF Type 1を書き出せる
12. 採用案と履歴をComposer Projectへ保存できる
13. 同一seedと同一入力から同じ結果を再生成できる
14. 元のコード、元のメロディ、過去Variantを破壊しない
15. 同一アプリ内でMelody・Arrangement・Auditionを切り替えられる
16. Active MelodyからArrangement Mapを3案生成できる
17. Arrangement Mapごとに楽器の出入り、役割、エネルギーカーブが異なる
18. Bass、Piano / Pad、StringsのMIDIを個別生成・再生成できる
19. 各パートをSolo / Muteし、実際の音でA/B比較できる
20. Melody・Chords・Arrangementを同期再生できる
21. Logic Pro用のパート別SMF Type 1を書き出せる
22. Logic Proから書き出したWAV / AIFFまたはステムを同期再生できる
23. 音声解析結果が元MIDIを自動上書きしない
24. AUプラグインをホストしなくても、確認用音源で制作判断ができる
25. 同一コード、同一seedでSong Profileを変更した場合、以下のうち3項目以上に差が生じる
    - 休符率
    - 平均跳躍
    - フレーズ最高音位置
    - モチーフ反復率
    - パート数
    - 楽器の開始位置
    - エネルギーカーブ
    - 音色カテゴリ
26. Melody側とArrangement側でSong Profileが常に一致しており、独立して食い違う状態が存在しない

---

## 19. 開発フェーズ

### Phase 1: Melody実用最小版

- Composer Project読込
- 手動コード入力
- Generate from Chords
- 6候補生成
- 簡易プレビュー
- Melody MIDI出力
- Song Profileの保存とUI表示（生成ロジックへの反映はPhase 2から）

### Phase 2: Melody作曲支援の核

- ピアノロール
- Lock
- 選択範囲再生成
- Develop a Seed
- A/B比較
- 生成履歴
- Song Profileの初期値反映（9.9.1）

### Phase 3: Audition最小版

- 共通Transport
- Preview Sound Set
- Melody / Chords同期再生
- Variant即時切替
- Solo / Mute / Level
- Logic Pro用SMF Type 1出力

### Phase 4: Arrangement Map

- Energy Curve
- Role Allocation
- Register Planning
- Minimal / Balanced / Dramaticの3案
- Arrangement A/B比較
- コード再検討メモ

### Phase 5: Core Arrangement Parts

- Bass Generator
- Piano / Arpeggio Generator
- Pad Voicing Generator
- Strings High / Low Generator
- パート別Lock
- 選択範囲再生成
- Song Profileの初期値反映（9.9.2）
- Role Allocatorの音色的アンカー反映（9.8.2b）

### Phase 6: Logic Round Trip

- Logic用固定トラックマッピング
- WAV / AIFF読込
- ステム同期再生
- Reference Bounce比較
- 音声特徴の補助解析
- コメント付き小節マーカー

### Phase 7: Extended Arrangement

- Drum Generator
- Guitar Texture Trigger
- Bell / FX Trigger
- Counter Melody
- Arrangement全体の改善モード
- 共通Music Domain Coreの分離と再利用

---

## 20. 初期仕様から除外する機能

以下は魅力的に見えるが、Version 1.0には不要である。

- 32案の一括生成
- アーティスト類似度
- 特定アーティスト名による模倣モード
- 歌詞生成
- ボーカル合成
- 完成アレンジのワンクリック一括生成
- Mix Assistant
- 自動コード変更
- 自動転調
- 完成曲のワンクリック生成
- MusicXML出力
- クラウド同期
- オンライン共同編集
- DAWプラグイン化
- AUプラグインの直接ホスト
- Repro / Kontakt / Guitar Rigのプリセット自動操作
- ステレオWAVから全パートを完全分離・MIDI復元
- 自動ミックス／自動マスタリング

これらはComposer Arrangerの初期開発へ入れず、必要性と技術的成立性を検証した段階で将来機能として検討する。Arrangement自体は同一アプリ内の正式モジュールとして段階実装する。

---

## 21. 成功指標

このアプリの成功は、生成数ではなく以下で評価する。

- 6案の中に「続きを作りたい」と思える案が最低1つある
- コード進行を聴くだけの状態から、歌えるモチーフへ進む時間が短縮される
- 生成案をそのまま採用するのではなく、編集の起点として使える
- Intro、Verse、Chorusの役割がメロディ上で明確になる
- Logic Proへ移した後の修正量が現実的である
- 作曲者自身の判断と個性が失われない
- 文字情報だけでは判断できなかった候補を、音のA/B比較で選べる
- Logic Proへ渡す前に、楽器の出入りとセクションコントラストを確認できる
- Logic Proから戻した音を基に、問題区間だけを修正できる
- 同じSong Profileで生成したMelodyとArrangementを続けて聴いたとき、Core Aestheticに沿ったヨーロピアン・シネマティックな質感として一貫して聴こえる
- 異なるSong Profileへ切り替えたとき、Arrangementの音色的性格（9.8.2b）が体感できるほど変わる

---

## 22. 最終設計原則

1. コードから音を並べるのではなく、モチーフからフレーズを育てる
2. 量より、比較可能な6つの良案を優先する
3. 生成より、部分修正と発展を重視する
4. アーティストを模倣せず、音楽的特徴を抽象化する
5. Melody・Arrangement・Auditionは同一アプリ内で連携する
6. Chord GeneratorとはComposer Projectを介して連携する
7. 文字より音で比較できることを優先する
8. Logic Proへ最短で移動し、本来の音源で確認できることを優先する
9. AIは候補を提示し、作曲者が作品を決定する
10. Song Profileは表示ラベルで終わらせず、Melody・Arrangement双方の生成ロジックへ実際に反映させる
11. Core Aestheticは製品固有の固定思想とし、Song Profileはその表現方向を調整する

---

## 23. 製品定義

Composer Arrangerは、自動作曲・自動編曲アプリではない。

コード進行と作曲者の短い発想を受け取り、モチーフ、リズム、輪郭、緊張と解決を設計してメロディ候補を返す。さらに、そのメロディを中心に、楽器の出入り、音域、密度、ダイナミクスを設計し、実際の音で比較できるアレンジ候補として提示する共同アレンジャーである。

最終目的は、便利なメロディや伴奏を大量に作ることではない。

作曲者が、自分だけでは到達しにくかった一つの旋律と一つの音楽的展開へ、聴覚的な比較を通じて到達する確率を高めることである。

Composer Arrangerが構成・メロディ・アレンジを考え、Logic Proが本来の音を鳴らす。この役割分担を製品の中心原則とする。
