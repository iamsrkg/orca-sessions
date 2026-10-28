import { BrowserWindow, nativeImage, type NativeImage } from 'electron'

const SIZE = 16
// 3x5 pixel glyphs; rows top to bottom, bit 2 = left column.
const GLYPHS: Record<string, number[]> = {
  '0': [7, 5, 5, 5, 7],
  '1': [2, 6, 2, 2, 7],
  '2': [7, 1, 7, 4, 7],
  '3': [7, 1, 7, 1, 7],
  '4': [5, 5, 7, 1, 1],
  '5': [7, 4, 7, 1, 7],
  '6': [7, 4, 7, 5, 7],
  '7': [7, 1, 2, 2, 2],
  '8': [7, 5, 7, 5, 7],
  '9': [7, 5, 7, 1, 7],
  '+': [0, 2, 7, 2, 0]
}

function badgeImage(count: number): NativeImage {
  const text = count > 9 ? '9+' : String(count)
  // BGRA, as nativeImage.createFromBitmap expects on Windows.
  const pixels = Buffer.alloc(SIZE * SIZE * 4)
  const center = (SIZE - 1) / 2
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const distance = Math.hypot(x - center, y - center)
      const alpha = Math.max(0, Math.min(1, SIZE / 2 - distance))
      const i = (y * SIZE + x) * 4
      pixels[i] = 0x44
      pixels[i + 1] = 0x44
      pixels[i + 2] = 0xef
      pixels[i + 3] = Math.round(alpha * 255)
    }
  }
  const glyphWidth = 3
  const gap = 1
  const textWidth = text.length * glyphWidth + (text.length - 1) * gap
  const left = Math.floor((SIZE - textWidth) / 2)
  const top = Math.floor((SIZE - 5) / 2)
  ;[...text].forEach((ch, index) => {
    const rows = GLYPHS[ch] ?? []
    rows.forEach((bits, row) => {
      for (let col = 0; col < glyphWidth; col++) {
        if (bits & (1 << (glyphWidth - 1 - col))) {
          const x = left + index * (glyphWidth + gap) + col
          const i = ((top + row) * SIZE + x) * 4
          pixels[i] = 0xff
          pixels[i + 1] = 0xff
          pixels[i + 2] = 0xff
          pixels[i + 3] = 0xff
        }
      }
    })
  })
  return nativeImage.createFromBitmap(pixels, { width: SIZE, height: SIZE })
}

/** Windows has no dock: show the unread count as a red overlay on the taskbar button instead. */
export function applyWindowsTaskbarBadge(count: number): void {
  if (process.platform !== 'win32') {
    return
  }
  const image = count > 0 ? badgeImage(count) : null
  const description = count > 0 ? `${count} unread` : ''
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.setOverlayIcon(image, description)
    }
  }
}
