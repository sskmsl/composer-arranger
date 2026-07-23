export function ComingSoonTab({ name, phase }: { name: string; phase: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-surface-tile-3 text-center">
      <p className="font-display text-[28px] font-semibold tracking-tight text-body-on-dark">{name}</p>
      <p className="text-[14px] text-ink-muted-48">{phase}で実装予定です。現在はMelodyモジュールが利用できます。</p>
    </div>
  )
}
