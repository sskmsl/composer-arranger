# Counter / Decoration共通基盤（Issue #42）

Reactive LayerはActive Melodyを直接変更せず、CounterとDecorationを独立候補・独立MIDIトラックとして管理する。

## 共通保護

- Active MelodyからGap、最高音、ロングトーン、跳躍着地点、非和声音解決を解析する。
- 同音、長時間短2度、Protected Moment、Voice Crossing、同時Attackを検出する。
- 意図的な`tension-hold`を除く非和声音は`plannedResolution`を持ち、指定Pitch Class・Beat・最大遅延内に実音の解決先が存在することを検証する。
- CounterとDecorationを同時採用するときは、両レイヤー間の同音・短2度とSection全体の総Note Densityを再評価する。
- Blocking Collision、未解決非和声音、総密度超過がある組み合わせはSet Activeしない。

## 独立性

- Counterは`targetMelodyVariantId`を持ち、Active Melody変更時にstaleとなる。
- Decorationは`structureFingerprint`を持ち、Section Role、前後Section、コード、長さが変わるとstaleとなる。
- CounterとDecorationは別々の採用枠を持つため同時利用できるが、採用前に共通Compatibility評価を通る。
- Favorite、Reject、再生成、Preview、MIDIはMelody Variantを上書きしない。

候補カードにはRole、対象Melody、使用音域、Note Density、Collision状態を表示する。
