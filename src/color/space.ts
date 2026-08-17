import type { RGB } from './types.ts'

/**
 * Conversões de espaço de cor.
 *
 * Duas regras que valem para o motor inteiro:
 * 1. **Mistura de luz é feita em RGB linear**, nunca em sRGB. O sRGB é uma
 *    curva de percepção; somar luz nele erra a composição de camadas.
 * 2. **Comparação de cores é feita em Lab**, porque distância euclidiana em
 *    RGB não corresponde ao que o olho vê como "parecido".
 */

/** Canal sRGB 0..255 → linear 0..1. */
export function srgbToLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** Canal linear 0..1 → sRGB 0..255. */
export function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(c * 255)))
}

export type LinearRGB = readonly [number, number, number]
export type Lab = readonly [number, number, number]

export const toLinear = (c: RGB): LinearRGB => [srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b)]

export const fromLinear = (c: LinearRGB): RGB => ({
  r: linearToSrgb(c[0]),
  g: linearToSrgb(c[1]),
  b: linearToSrgb(c[2]),
})

/** "#RRGGBB" → RGB. Aceita com ou sem "#", maiúsculas ou minúsculas. */
export function parseHex(hex: string): RGB {
  const h = hex.replace('#', '').trim()
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`cor inválida: ${hex}`)
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

export function toHex(c: RGB): string {
  const p = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${p(c.r)}${p(c.g)}${p(c.b)}`.toUpperCase()
}

// D65, observador 2°
const WHITE = [0.95047, 1, 1.08883] as const
const DELTA = 6 / 29

const f = (t: number): number => (t > DELTA ** 3 ? Math.cbrt(t) : t / (3 * DELTA ** 2) + 4 / 29)

export function linearToLab(c: LinearRGB): Lab {
  const [r, g, b] = c
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / WHITE[0]
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) / WHITE[1]
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / WHITE[2]
  const [fx, fy, fz] = [f(x), f(y), f(z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export const rgbToLab = (c: RGB): Lab => linearToLab(toLinear(c))

/**
 * CIE76. Grosseiro perto do azul saturado, mas 4× mais barato que o CIEDE2000
 * e o solver roda isto milhões de vezes.
 *
 * ponytail: se a fidelidade em azuis incomodar, trocar por CIEDE2000 só no
 * ranking final de cronogramas, mantendo o CIE76 no laço por pixel.
 */
export function deltaE(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/** Distância ao quadrado — evita a raiz no laço quente do solver. */
export function deltaESq(a: Lab, b: Lab): number {
  const dl = a[0] - b[0]
  const da = a[1] - b[1]
  const db = a[2] - b[2]
  return dl * dl + da * da + db * db
}
