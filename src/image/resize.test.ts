import assert from 'node:assert/strict'
import test from 'node:test'

import { linearToSrgb, srgbToLinear } from '../color/space.ts'
import type { Bitmap } from '../color/types.ts'
import { resizeBitmap } from './resize.ts'

/** Constrói um bitmap a partir de uma função (x,y) → [r,g,b,a]. */
function make(w: number, h: number, f: (x: number, y: number) => number[]): Bitmap {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = f(x, y)
      data.set([r, g, b, a], (y * w + x) * 4)
    }
  return { width: w, height: h, data }
}

const px = (img: Bitmap, x: number, y: number) =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4))

test('imagem chapada mantém a cor exata na redução e na ampliação', () => {
  for (const cor of [
    [0, 0, 0, 255],
    [255, 255, 255, 255],
    [15, 98, 254, 255],
    [1, 2, 3, 4],
    [254, 253, 252, 251],
  ]) {
    const src = make(9, 7, () => cor)
    for (const [w, h] of [
      [3, 2],
      [1, 1],
      [18, 21],
      [9, 7],
    ]) {
      const out = resizeBitmap(src, w, h)
      assert.equal(out.width, w)
      assert.equal(out.height, h)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          assert.deepEqual(px(out, x, y), cor, `cor ${cor} em ${w}×${h}, pixel ${x},${y}`)
    }
  }
})

test('redução 2:1 de xadrez preto-e-branco dá o cinza LINEAR (188, não 128)', () => {
  // xadrez perfeito: cada bloco 2×2 de origem tem exatamente 2 pretos e 2 brancos
  const src = make(8, 8, (x, y) => {
    const v = (x + y) % 2 === 0 ? 255 : 0
    return [v, v, v, 255]
  })
  const out = resizeBitmap(src, 4, 4)

  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      assert.deepEqual(px(out, x, y), [188, 188, 188, 255], `célula ${x},${y}`)
    }

  // a média ingênua em sRGB daria isto — o teste existe para separar os dois
  assert.notEqual(px(out, 0, 0)[0], 128)
})

test('média em RGB linear também no caso desbalanceado (3 brancos, 1 preto)', () => {
  // bloco 2×2 com 3 brancos e 1 preto: linear (3·1 + 0)/4 = 0.75 → 225 em sRGB
  const src = make(2, 2, (x, y) => {
    const v = x === 0 && y === 0 ? 0 : 255
    return [v, v, v, 255]
  })
  assert.deepEqual(px(resizeBitmap(src, 1, 1), 0, 0), [225, 225, 225, 255])
})

test('pixel parcial entra com peso fracionário (3→2 numa linha)', () => {
  // destino 0 cobre [0, 1.5) = A inteiro + metade de B; destino 1 cobre [1.5, 3)
  const src = make(3, 1, (x) => (x === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]))
  const out = resizeBitmap(src, 2, 1)

  const esperado0 = linearToSrgb((srgbToLinear(255) * 1 + srgbToLinear(0) * 0.5) / 1.5)
  const esperado1 = linearToSrgb(srgbToLinear(0))
  assert.deepEqual(px(out, 0, 0), [esperado0, esperado0, esperado0, 255])
  assert.deepEqual(px(out, 1, 0), [esperado1, esperado1, esperado1, 255])
  // peso inteiro em vez de fracionário daria a média simples de A e B
  assert.notEqual(px(out, 0, 0)[0], linearToSrgb((srgbToLinear(255) + srgbToLinear(0)) / 2))
})

test('pixel parcial entra com peso fracionário também em Y (3→2 numa coluna)', () => {
  const src = make(1, 3, (_x, y) => (y === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]))
  const out = resizeBitmap(src, 1, 2)

  const esperado0 = linearToSrgb((srgbToLinear(255) * 1 + srgbToLinear(0) * 0.5) / 1.5)
  assert.deepEqual(px(out, 0, 0), [esperado0, esperado0, esperado0, 255])
  assert.deepEqual(px(out, 0, 1), [0, 0, 0, 255])
  assert.notEqual(px(out, 0, 0)[0], linearToSrgb((srgbToLinear(255) + srgbToLinear(0)) / 2))
})

test('ampliar replica sem trocar os eixos', () => {
  // valores distintos por posição: qualquer transposição ou troca de índice quebra
  const src = make(2, 3, (x, y) => [10 + x, 100 + y, 200, 255])
  const out = resizeBitmap(src, 4, 6)
  assert.equal(out.width, 4)
  assert.equal(out.height, 6)
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 4; x++)
      assert.deepEqual(px(out, x, y), [10 + (x >> 1), 100 + (y >> 1), 200, 255], `pixel ${x},${y}`)
})

test('reduzir não transpõe: imagem não quadrada mantém a orientação', () => {
  // metade de cima branca, metade de baixo preta — transpor viraria esquerda/direita
  const src = make(4, 4, (_x, y) => {
    const v = y < 2 ? 255 : 0
    return [v, v, v, 255]
  })
  const out = resizeBitmap(src, 2, 2)
  assert.deepEqual(px(out, 0, 0), [255, 255, 255, 255])
  assert.deepEqual(px(out, 1, 0), [255, 255, 255, 255])
  assert.deepEqual(px(out, 0, 1), [0, 0, 0, 255])
  assert.deepEqual(px(out, 1, 1), [0, 0, 0, 255])
})

test('alfa entra na média (em sua própria escala, não em linear)', () => {
  const src = make(2, 1, (x) => [0, 0, 0, x === 0 ? 0 : 200])
  assert.equal(px(resizeBitmap(src, 1, 1), 0, 0)[3], 100)
})

test('dimensões inválidas lançam', () => {
  const src = make(4, 4, () => [0, 0, 0, 255])
  for (const [w, h] of [
    [0, 4],
    [4, 0],
    [-2, 4],
    [4, -2],
    [2.5, 4],
    [4, 2.5],
    [Number.NaN, 4],
  ]) {
    assert.throws(() => resizeBitmap(src, w, h), /dimensões inteiras positivas/, `${w}×${h}`)
  }
})

test('imagem de origem inconsistente lança', () => {
  const curta: Bitmap = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4 - 4) }
  assert.throws(() => resizeBitmap(curta, 2, 2), /bytes, esperado/)
  const vazia: Bitmap = { width: 0, height: 4, data: new Uint8ClampedArray(0) }
  assert.throws(() => resizeBitmap(vazia, 2, 2), /dimensões inválidas/)
})
