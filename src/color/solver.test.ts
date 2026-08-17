import test from 'node:test'
import assert from 'node:assert/strict'
import type { Bitmap, Palette, RGB } from './types.ts'
import { deltaE, linearToLab, parseHex, srgbToLinear } from './space.ts'
import { imageError, renderHeightMap, solveHeights } from './solver.ts'
import { ditherToPalette } from './dither.ts'

/** Bitmap a partir de uma lista de cores, linha por linha. */
function bitmapFrom(width: number, cores: RGB[]): Bitmap {
  const data = new Uint8ClampedArray(cores.length * 4)
  cores.forEach((c, i) => {
    data.set([c.r, c.g, c.b, 255], i * 4)
  })
  return { width, height: cores.length / width, data }
}

const fill = (w: number, h: number, c: RGB) => bitmapFrom(w, Array.from({ length: w * h }, () => c))

/** Média em luz linear da imagem inteira — é assim que o olho integra o dithering. */
function mediaLinear(img: Bitmap): [number, number, number] {
  const n = img.width * img.height
  let r = 0
  let g = 0
  let b = 0
  for (let i = 0; i < n; i++) {
    r += srgbToLinear(img.data[i * 4])
    g += srgbToLinear(img.data[i * 4 + 1])
    b += srgbToLinear(img.data[i * 4 + 2])
  }
  return [r / n, g / n, b / n]
}

const PALETA: Palette = ['#000000', '#7F1D1D', '#0F62FE', '#B0B0B0', '#FFFFFF'].map(parseHex)

test('imagem feita com as próprias cores da paleta volta com os índices certos e erro ~0', () => {
  const ordem = [4, 0, 2, 1, 3, 0, 4, 4, 2]
  const img = bitmapFrom(3, ordem.map((i) => PALETA[i]))

  const hm = solveHeights(img, PALETA)
  assert.deepEqual(Array.from(hm.data), ordem)
  assert.equal(hm.width, 3)
  assert.equal(hm.height, 3)
  assert.ok(imageError(img, renderHeightMap(hm, PALETA)) < 1e-9)
})

test('renderHeightMap é o inverso de solveHeights para imagens já na paleta', () => {
  const img = bitmapFrom(2, [PALETA[1], PALETA[3], PALETA[0], PALETA[4]])
  const volta = renderHeightMap(solveHeights(img, PALETA), PALETA)
  assert.deepEqual(Array.from(volta.data), Array.from(img.data))
})

test('solveHeights escolhe o vizinho mais próximo, não o primeiro parecido', () => {
  // Cinza levemente mais claro que #B0B0B0: tem que cair no cinza, não no branco.
  const img = fill(1, 1, parseHex('#B8B8B8'))
  assert.equal(solveHeights(img, PALETA).data[0], 3)
  // Um vermelho escuro qualquer cai no #7F1D1D, o único quente da paleta.
  assert.equal(solveHeights(fill(1, 1, parseHex('#6E2A22')), PALETA).data[0], 1)
  // Azul-marinho: tem a *luminância* do #7F1D1D (L 27 vs 28) mas o croma do
  // #0F62FE. Comparar só claridade erraria aqui — Lab inteiro acerta.
  assert.equal(solveHeights(fill(1, 1, parseHex('#1E3A8A')), PALETA).data[0], 2)
  // Cor repetida na paleta: o empate cai no índice mais baixo — menos camadas, mesma cor.
  assert.equal(solveHeights(fill(1, 1, PALETA[3]), [...PALETA, PALETA[3]]).data[0], 3)
})

test('dithering de um cinza a meio caminho mistura as duas alturas e acerta a luz média', () => {
  const preto = parseHex('#000000')
  const branco = parseHex('#FFFFFF')
  const paleta: Palette = [preto, branco]
  // sRGB cuja luz linear é ~0.5 — bem no meio entre as duas entradas da paleta.
  const alvo = { r: 188, g: 188, b: 188 }
  const img = fill(48, 48, alvo)

  const dith = ditherToPalette(img, paleta)
  const usa = new Set(dith.data)
  assert.deepEqual([...usa].sort(), [0, 1], 'o dithering tem que usar as duas alturas')

  const labAlvo = linearToLab(mediaLinear(img))
  const erroDither = deltaE(linearToLab(mediaLinear(renderHeightMap(dith, paleta))), labAlvo)
  const erroNN = deltaE(linearToLab(mediaLinear(renderHeightMap(solveHeights(img, paleta), paleta))), labAlvo)

  assert.ok(erroNN > 10, `o vizinho mais próximo deveria estourar aqui, deu ${erroNN}`)
  assert.ok(erroDither < 2, `luz média do dithering longe do alvo: ΔE ${erroDither}`)
  assert.ok(erroDither < erroNN)
})

test('dithering difunde em luz linear, não em sRGB (senão a imagem clareia)', () => {
  const paleta: Palette = [parseHex('#000000'), parseHex('#FFFFFF')]
  const img = fill(64, 64, { r: 188, g: 188, b: 188 })
  const brancos = ditherToPalette(img, paleta).data.reduce((a, v) => a + v, 0) / (64 * 64)
  // Difundir em sRGB daria ~0.74 de brancos; em luz linear a fração certa é ~0.50.
  assert.ok(Math.abs(brancos - 0.5) < 0.03, `fração de branco ${brancos}, esperado ~0.50`)
})

test('o kernel Floyd-Steinberg cai nas células e nos pesos exatos (7/16, 3/16, 5/16, 1/16)', () => {
  // Média não prova kernel: qualquer redistribuição que conserve a soma passa
  // pelos testes de luz média. Este aqui fixa a *geometria e os pesos*, conferindo
  // célula a célula uma conta fechada.
  //
  // Cinza neutro tem a*=b*=0, então entre preto e branco o vizinho mais próximo
  // é branco sse L* > 50, isto é, luz linear > T = ((50+16)/116)³ = 0.184187.
  // Imagem 3×2: linha de cima #CACACA (luz linear 0.590619), de baixo #E1E1E1 (0.752942).
  //
  //   (0,0) acc=0.590619 > T → 1, e = acc-1 = -0.409381
  //         7/16·e → (1,0) -0.179104 | 5/16·e → (0,1) -0.127932 | 1/16·e → (1,1) -0.025586
  //         (o 3/16 iria para (-1,1), fora da placa)
  //   (1,0) acc=0.590619-0.179104 = 0.411515 > T → 1, e = -0.588485
  //         7/16 → (2,0) -0.257462 | 3/16 → (0,1) -0.110341 | 5/16 → (1,1) -0.183902 | 1/16 → (2,1) -0.036780
  //   (2,0) acc=0.590619-0.257462 = 0.333157 > T → 1, e = -0.666843
  //         3/16 → (1,1) -0.125033 | 5/16 → (2,1) -0.208389 (7/16 e 1/16 saem pela direita)
  //   (0,1) acc=0.752942-0.127932-0.110341 = 0.514670 > T → 1, e = -0.485330 → 7/16 → (1,1) -0.212332
  //   (1,1) acc=0.752942-0.025586-0.183902-0.125033-0.212332 = 0.206089 > T → 1, e = -0.793911
  //         7/16 → (2,1) -0.347336
  //   (2,1) acc=0.752942-0.036780-0.208389-0.347336 = 0.160437 < T → 0
  //
  // Margem mínima até T: 0.022 — bem acima do ruído de float, e apertada o bastante
  // para que mexer em qualquer célula ou peso do kernel mude a última decisão.
  const paleta: Palette = [parseHex('#000000'), parseHex('#FFFFFF')]
  const cima = parseHex('#CACACA')
  const baixo = parseHex('#E1E1E1')
  const img = bitmapFrom(3, [cima, cima, cima, baixo, baixo, baixo])
  assert.deepEqual(Array.from(ditherToPalette(img, paleta).data), [1, 1, 1, 1, 1, 0])
})

test('imageError sobe com a diferença e reclama de tamanhos diferentes', () => {
  const a = fill(2, 2, parseHex('#000000'))
  const meio = fill(2, 2, parseHex('#808080'))
  const b = fill(2, 2, parseHex('#FFFFFF'))
  assert.equal(imageError(a, a), 0)
  assert.ok(imageError(a, meio) > 40 && imageError(a, meio) < 70)
  assert.ok(imageError(a, b) > imageError(a, meio))
  assert.throws(() => imageError(a, fill(1, 2, parseHex('#000000'))), /tamanhos diferentes/)
})

test('paleta vazia e altura fora da paleta são erro explícito', () => {
  assert.throws(() => solveHeights(fill(1, 1, PALETA[0]), []), /paleta vazia/)
  assert.throws(
    () => renderHeightMap({ width: 1, height: 1, data: Uint8Array.from([7]) }, PALETA),
    /fora da paleta/,
  )
})

test('cada dimensão é validada, não só o produto', () => {
  // 1.5×4 e -2×-3 têm produto inteiro e positivo: o cheque do produto deixava passar.
  const doze = new Uint8ClampedArray(12 * 4)
  for (const [w, h] of [
    [1.5, 4],
    [-2, -3],
    [0, 5],
  ] as const) {
    assert.throws(() => solveHeights({ width: w, height: h, data: doze }, PALETA), /dimensões inválidas/, `${w}×${h}`)
    assert.throws(
      () => ditherToPalette({ width: w, height: h, data: doze }, PALETA),
      /dimensões inválidas/,
      `dither ${w}×${h}`,
    )
    assert.throws(
      () => renderHeightMap({ width: w, height: h, data: new Uint8Array(12) }, PALETA),
      /dimensões inválidas/,
      `render ${w}×${h}`,
    )
  }
})

test('guarda de desempenho: 512×512 com 25 entradas em menos de 2s', () => {
  const paleta: Palette = Array.from({ length: 25 }, (_, i) => ({
    r: (i * 37) % 256,
    g: (i * 91) % 256,
    b: (i * 53) % 256,
  }))
  const n = 512 * 512
  const data = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    data.set([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256, 255], i * 4)
  }
  const img: Bitmap = { width: 512, height: 512, data }

  const t0 = performance.now()
  const hm = solveHeights(img, paleta)
  const dt = performance.now() - t0
  assert.equal(hm.data.length, n)
  assert.ok(dt < 2000, `solveHeights levou ${dt.toFixed(0)}ms`)
})
