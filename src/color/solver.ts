import type { Bitmap, HeightMap, Palette } from './types.ts'
import { deltaE, deltaESq, linearToLab, rgbToLab, srgbToLinear, type Lab } from './space.ts'

/**
 * Decide a altura de cada pixel: o índice da paleta cuja cor é a mais próxima
 * em Lab. Sem dithering — para isso ver `dither.ts`.
 */

/** srgbToLinear tem um `**` por canal; o solver roda milhões deles. */
export const LINEAR_LUT = Float64Array.from({ length: 256 }, (_, i) => srgbToLinear(i))

/** Lab de cada entrada da paleta, calculado uma vez. Também valida a paleta. */
export function paletteLab(palette: Palette): Lab[] {
  if (palette.length === 0) throw new Error('paleta vazia')
  // HeightMap.data é Uint8Array — mais que 256 alturas não caberia no índice.
  if (palette.length > 256) throw new Error(`paleta com ${palette.length} entradas; o máximo é 256`)
  return palette.map(rgbToLab)
}

/** Índice da entrada mais próxima. ponytail: busca linear; k-d tree só se a paleta passar de ~centenas. */
export function nearestIndex(lab: Lab, labs: Lab[]): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < labs.length; i++) {
    const d = deltaESq(lab, labs[i])
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/**
 * Nº de células. Valida **cada** dimensão, não o produto: 1.5×4 e -2×-3 dão
 * produto inteiro e positivo, e vazariam para dentro do HeightMap.
 */
function cellCount(width: number, height: number): number {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`dimensões inválidas: ${width}×${height}`)
  }
  return width * height
}

/** cellCount + o cheque de bytes do RGBA. Fronteira única para quem consome Bitmap. */
export function pixelCount(img: Bitmap): number {
  const n = cellCount(img.width, img.height)
  if (img.data.length < n * 4) throw new Error(`bitmap tem ${img.data.length} bytes, esperado ${n * 4}`)
  return n
}

export function solveHeights(img: Bitmap, palette: Palette): HeightMap {
  const labs = paletteLab(palette)
  const n = pixelCount(img)
  const out = new Uint8Array(n)
  const d = img.data
  for (let i = 0; i < n; i++) {
    const p = i * 4
    const lab = linearToLab([LINEAR_LUT[d[p]], LINEAR_LUT[d[p + 1]], LINEAR_LUT[d[p + 2]]])
    out[i] = nearestIndex(lab, labs)
  }
  return { width: img.width, height: img.height, data: out }
}

/** Volta do mapa de alturas para a imagem que o olho veria. Opaco. */
export function renderHeightMap(hm: HeightMap, palette: Palette): Bitmap {
  if (palette.length === 0) throw new Error('paleta vazia')
  const n = cellCount(hm.width, hm.height)
  if (hm.data.length < n) throw new Error(`mapa de alturas tem ${hm.data.length} células, esperado ${n}`)
  const data = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const c = palette[hm.data[i]]
    if (!c) throw new Error(`altura ${hm.data[i]} fora da paleta de ${palette.length} entradas`)
    const p = i * 4
    data[p] = c.r
    data[p + 1] = c.g
    data[p + 2] = c.b
    data[p + 3] = 255
  }
  return { width: hm.width, height: hm.height, data }
}

/** ΔE médio pixel a pixel. Serve para pontuar um cronograma de cores. */
export function imageError(a: Bitmap, b: Bitmap): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`imagens de tamanhos diferentes: ${a.width}×${a.height} vs ${b.width}×${b.height}`)
  }
  const n = pixelCount(a)
  pixelCount(b)
  let soma = 0
  for (let i = 0; i < n; i++) {
    const p = i * 4
    const la = linearToLab([LINEAR_LUT[a.data[p]], LINEAR_LUT[a.data[p + 1]], LINEAR_LUT[a.data[p + 2]]])
    const lb = linearToLab([LINEAR_LUT[b.data[p]], LINEAR_LUT[b.data[p + 1]], LINEAR_LUT[b.data[p + 2]]])
    soma += deltaE(la, lb)
  }
  return soma / n
}
