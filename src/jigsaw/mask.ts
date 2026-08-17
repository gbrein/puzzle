import type { Ring } from '../geom/types.ts'

/** Ponto dentro do anel — cruzamento de raio, ímpar = dentro. */
function inside(ring: Ring, x: number, y: number): boolean {
  let dentro = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro
  }
  return dentro
}

/** Segmento p→q toca o retângulo fechado [x0,x1]×[y0,y1]? Recorte por faixas. */
function cortaRet(
  px: number,
  py: number,
  qx: number,
  qy: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  let t0 = 0
  let t1 = 1
  const dx = qx - px
  const dy = qy - py

  if (dx === 0) {
    if (px < x0 || px > x1) return false
  } else {
    let a = (x0 - px) / dx
    let b = (x1 - px) / dx
    if (a > b) [a, b] = [b, a]
    if (a > t0) t0 = a
    if (b < t1) t1 = b
    if (t0 > t1) return false
  }

  if (dy === 0) {
    if (py < y0 || py > y1) return false
  } else {
    let a = (y0 - py) / dy
    let b = (y1 - py) / dy
    if (a > b) [a, b] = [b, a]
    if (a > t0) t0 = a
    if (b < t1) t1 = b
    if (t0 > t1) return false
  }

  return true
}

/**
 * Rasteriza o contorno da peça em células do mapa de altura.
 *
 * **Conservador de propósito:** a célula só recebe 1 se o quadrado INTEIRO
 * couber dentro do anel. O relevo é feito de blocos alinhados aos eixos e o
 * contorno da peça é bezier; se a célula entrasse pela metade, o bloco avançaria
 * dentro da folga e as peças colariam na impressão. O preço é um rebordo liso de
 * no máximo uma célula na borda de cada peça — o troco certo.
 *
 * O `ring` esperado é o que já veio encolhido pela folga (`shrinkByKerf`), não o
 * da grade: rasterizar o da grade devolve a folga inteira para dentro da máscara.
 *
 * **Convenção de eixo:** o índice é `linha * hm.width + coluna` com a linha 0 no
 * TOPO da foto, igual ao `data` do `HeightMap` — é assim que `heightMapToMesh`
 * lê os dois em paralelo. No plano da placa Y cresce para cima, então a linha `r`
 * ocupa `originY + (hm.height-1-r)*cellSize` até uma célula acima disso.
 *
 * ponytail: O(células × arestas do anel), cortado pela caixa do anel. Medido:
 * 7ms por peça (1200 células, anel de ~200 pontos), 0,8s para as 108 peças de
 * uma placa de 180mm — irrelevante perto do resto do pipeline. Se um dia a
 * máscara for do mapa da placa inteira por peça, indexar as arestas por faixa
 * de linha.
 */
export function pieceMask(
  ring: Ring,
  hm: { width: number; height: number },
  cellSize: number,
  originX = 0,
  originY = 0,
): Uint8Array {
  const w = hm.width
  const h = hm.height
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0)
    throw new Error(`máscara precisa de dimensões inteiras positivas, recebi ${w}×${h}`)
  if (!(cellSize > 0)) throw new Error('cellSize tem que ser positivo')
  if (ring.length < 3) throw new Error(`anel precisa de pelo menos 3 pontos, recebi ${ring.length}`)

  // Tolerância: uma aresta rente à grade (anel alinhado às células) não conta como
  // invasão — senão um quadrado perfeitamente alinhado perderia a fileira de borda
  // por erro de ponto flutuante, e isso não é conservadorismo, é bug.
  const eps = cellSize * 1e-6

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of ring) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  const out = new Uint8Array(w * h)

  for (let r = 0; r < h; r++) {
    const cy0 = originY + (h - 1 - r) * cellSize
    const cy1 = cy0 + cellSize
    if (cy1 < minY || cy0 > maxY) continue

    for (let c = 0; c < w; c++) {
      const cx0 = originX + c * cellSize
      const cx1 = cx0 + cellSize
      if (cx1 < minX || cx0 > maxX) continue

      // quadrado encolhido por eps: é ele que as arestas do anel não podem tocar
      const x0 = cx0 + eps
      const y0 = cy0 + eps
      const x1 = cx1 - eps
      const y1 = cy1 - eps

      let livre = true
      for (let i = 0, j = ring.length - 1; i < ring.length && livre; j = i++) {
        if (cortaRet(ring[j][0], ring[j][1], ring[i][0], ring[i][1], x0, y0, x1, y1)) livre = false
      }
      // nenhuma aresta atravessa o quadrado ⇒ ele está todo dentro ou todo fora;
      // o centro desempata
      if (livre && inside(ring, (cx0 + cx1) / 2, (cy0 + cy1) / 2)) out[r * w + c] = 1
    }
  }

  return out
}
