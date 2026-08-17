import { linearToSrgb, srgbToLinear } from '../color/space.ts'
import type { Bitmap } from '../color/types.ts'

/** LUT sRGB→linear: o laço interno visita cada pixel de origem uma vez (4000² = 16M). */
const LIN = Float64Array.from({ length: 256 }, (_, i) => srgbToLinear(i))

/**
 * Reamostra por **média de área**, em RGB **linear**.
 *
 * Por que média de área e não vizinho mais próximo: a foto chega em ~4000px e o
 * relevo tem ~430 células por peça. O vizinho mais próximo descarta 98% dos
 * pixels e devolve serrilhado; a média de área usa todos eles.
 *
 * Por que linear: sRGB é uma curva de percepção. Somar valores de sRGB e dividir
 * não é a média da luz que chega ao olho — o resultado sai escuro. Xadrez
 * preto-e-branco reduzido 2:1 dá 188, não 128.
 *
 * **A ordem importa: reamostre ANTES do dither.** O Floyd-Steinberg distribui o
 * erro entre pixels vizinhos; se o dither roda em 4000px e a redução vem depois,
 * a média devolve o erro para o próprio pixel e o padrão some. O dither só faz
 * sentido na resolução em que vai ser impresso.
 *
 * ponytail: alfa entra na média sem pré-multiplicar — nenhuma entrada do
 * pipeline tem alfa parcial hoje. Upgrade: pré-multiplicar antes de acumular se
 * um dia entrar PNG com transparência de verdade.
 */
export function resizeBitmap(img: Bitmap, width: number, height: number): Bitmap {
  const sw = img.width
  const sh = img.height
  if (!Number.isInteger(sw) || !Number.isInteger(sh) || sw <= 0 || sh <= 0)
    throw new Error(`imagem de origem tem dimensões inválidas: ${sw}×${sh}`)
  if (img.data.length !== sw * sh * 4)
    throw new Error(`imagem de origem tem ${img.data.length} bytes, esperado ${sw * sh * 4}`)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    throw new Error(`destino precisa de dimensões inteiras positivas, recebi ${width}×${height}`)

  const data = new Uint8ClampedArray(width * height * 4)
  const sx = sw / width
  const sy = sh / height

  for (let y = 0; y < height; y++) {
    // faixa de origem [y0, y1) que este pixel de destino cobre
    const y0 = y * sy
    const y1 = (y + 1) * sy
    const j0 = Math.floor(y0)
    const j1 = Math.min(sh, Math.ceil(y1))

    for (let x = 0; x < width; x++) {
      const x0 = x * sx
      const x1 = (x + 1) * sx
      const i0 = Math.floor(x0)
      const i1 = Math.min(sw, Math.ceil(x1))

      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let total = 0

      for (let j = j0; j < j1; j++) {
        // fração da linha j que cai dentro da faixa — o pixel da ponta entra parcial
        const wy = Math.min(j + 1, y1) - Math.max(j, y0)
        if (wy <= 0) continue
        const row = j * sw
        for (let i = i0; i < i1; i++) {
          const wx = Math.min(i + 1, x1) - Math.max(i, x0)
          if (wx <= 0) continue
          const peso = wx * wy
          const p = (row + i) * 4
          r += LIN[img.data[p]] * peso
          g += LIN[img.data[p + 1]] * peso
          b += LIN[img.data[p + 2]] * peso
          a += img.data[p + 3] * peso
          total += peso
        }
      }

      const q = (y * width + x) * 4
      data[q] = linearToSrgb(r / total)
      data[q + 1] = linearToSrgb(g / total)
      data[q + 2] = linearToSrgb(b / total)
      data[q + 3] = Math.round(a / total)
    }
  }

  return { width, height, data }
}
