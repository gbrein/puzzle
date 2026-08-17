import type { Bitmap, HeightMap, Palette } from './types.ts'
import { linearToLab, toLinear } from './space.ts'
import { LINEAR_LUT, nearestIndex, paletteLab } from './solver.ts'

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Floyd-Steinberg. O erro é difundido em **RGB linear**: em sRGB a difusão
 * soma quantidades de uma curva de percepção, e o resultado sai mais claro
 * que o original.
 */
export function ditherToPalette(img: Bitmap, palette: Palette): HeightMap {
  const labs = paletteLab(palette)
  const palLin = palette.map(toLinear)
  const w = img.width
  const h = img.height
  const n = w * h
  if (img.data.length < n * 4) throw new Error(`bitmap tem ${img.data.length} bytes, esperado ${n * 4}`)

  // Alvo em luz linear, mutável: cada pixel acumula o erro dos vizinhos já resolvidos.
  const buf = new Float64Array(n * 3)
  for (let i = 0; i < n; i++) {
    const p = i * 4
    buf[i * 3] = LINEAR_LUT[img.data[p]]
    buf[i * 3 + 1] = LINEAR_LUT[img.data[p + 1]]
    buf[i * 3 + 2] = LINEAR_LUT[img.data[p + 2]]
  }

  const out = new Uint8Array(n)
  const espalha = (x: number, y: number, er: number, eg: number, eb: number, peso: number) => {
    if (x < 0 || x >= w || y >= h) return
    const j = (y * w + x) * 3
    buf[j] += er * peso
    buf[j + 1] += eg * peso
    buf[j + 2] += eb * peso
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const j = i * 3
      const r = buf[j]
      const g = buf[j + 1]
      const b = buf[j + 2]
      // O acumulado pode sair de 0..1; só o lookup em Lab precisa do clamp.
      const lab = linearToLab([clamp01(r), clamp01(g), clamp01(b)])
      const k = nearestIndex(lab, labs)
      out[i] = k
      const er = r - palLin[k][0]
      const eg = g - palLin[k][1]
      const eb = b - palLin[k][2]
      espalha(x + 1, y, er, eg, eb, 7 / 16)
      espalha(x - 1, y + 1, er, eg, eb, 3 / 16)
      espalha(x, y + 1, er, eg, eb, 5 / 16)
      espalha(x + 1, y + 1, er, eg, eb, 1 / 16)
    }
  }
  return { width: w, height: h, data: out }
}
