/**
 * モーダルの背景をクリックしたときだけ閉じるためのハンドラー。
 * 押し始めと離した位置の両方が背景そのもののときだけ閉じる。入力欄の文字をドラッグで選び、
 * パネルの外で指を離すと、click は共通の祖先である背景へ届く。それで閉じないようにする。
 */
export function backdropCloseHandlers(onClose: () => void) {
  let pressedOnBackdrop = false
  return {
    onPointerDown: (event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
      pressedOnBackdrop = event.target === event.currentTarget
    },
    onClick: (event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
      const shouldClose = pressedOnBackdrop && event.target === event.currentTarget
      pressedOnBackdrop = false
      if (shouldClose) onClose()
    },
  }
}
