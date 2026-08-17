import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPalette, layerTransmission } from './beer-lambert.ts'
import { deltaE, rgbToLab } from './space.ts'
import type { Filament, LayerPlan } from './types.ts'

const fil = (hex: string, td: number): Filament => ({ id: hex, name: hex, hex, td })

const plan = (layerHeight: number, baseHex: string, schedule: Filament[]): LayerPlan => ({
  layerHeight,
  baseLayers: 3,
  base: fil(baseHex, 0.5),
  schedule,
})

const stack = (f: Filament, n: number) => new Array(n).fill(f)

const dist = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
  deltaE(rgbToLab(a), rgbToLab(b))

test('em td a transmissão é 10% — é a definição', () => {
  for (const td of [0.4, 1, 6.3]) assert.equal(layerTransmission(td, td), 0.1)
  assert.equal(layerTransmission(2 * 0.75, 0.75), 0.01)
  assert.equal(layerTransmission(0, 1), 1)
})

test('transmissão cai monotonicamente com a espessura', () => {
  let anterior = Infinity
  for (let h = 0; h <= 2; h += 0.05) {
    const t = layerTransmission(h, 1.2)
    assert.ok(t < anterior, `esperava queda em h=${h}`)
    assert.ok(t > 0 && t <= 1)
    anterior = t
  }
})

test('entrada inválida falha explicitamente', () => {
  assert.throws(() => layerTransmission(0.2, 0), /td inválido/)
  assert.throws(() => layerTransmission(0.2, -1), /td inválido/)
  assert.throws(() => layerTransmission(-0.2, 1), /altura de camada inválida/)
  assert.throws(() => layerTransmission(0.2, NaN), /td inválido/)
})

test('paleta tem schedule+1 entradas e começa na cor da base', () => {
  const p = buildPalette(plan(0.2, '#123456', stack(fil('#FFFFFF', 2), 5)))
  assert.equal(p.length, 6)
  assert.deepEqual(p[0], { r: 0x12, g: 0x34, b: 0x56 })

  assert.equal(buildPalette(plan(0.2, '#123456', [])).length, 1)
})

test('empilhar o mesmo filamento converge para a cor pura dele', () => {
  const puro = { r: 0x0f, g: 0x62, b: 0xfe }
  const p = buildPalette(plan(0.2, '#000000', stack(fil('#0F62FE', 1.0), 40)))

  // longe no começo, colado no fim
  assert.ok(dist(p[1], puro) > 20, 'uma camada só não deveria bastar com td=1.0')
  assert.ok(dist(p[40], puro) < 1, `esperava convergência, ΔE=${dist(p[40], puro)}`)

  // nunca se afasta; e enquanto está longe, o avanço é estrito
  // (perto do fim a paleta já saturou nos 8 bits e ΔE fica parado em 0)
  for (let i = 2; i <= 40; i++) {
    const [antes, agora] = [dist(p[i - 1], puro), dist(p[i], puro)]
    assert.ok(agora <= antes, `regrediu na camada ${i}: ${antes} → ${agora}`)
    if (antes > 1) assert.ok(agora < antes, `estagnou longe do alvo na camada ${i}`)
  }
})

test('td menor converge em menos camadas', () => {
  const puro = { r: 0x0f, g: 0x62, b: 0xfe }
  const camadasAte1 = (td: number) => {
    const p = buildPalette(plan(0.2, '#000000', stack(fil('#0F62FE', td), 60)))
    return p.findIndex((c, i) => i > 0 && dist(c, puro) < 1)
  }
  const rapido = camadasAte1(0.4)
  const lento = camadasAte1(1.6)
  assert.ok(rapido > 0 && lento > 0, 'ambos precisam convergir dentro de 60 camadas')
  assert.ok(rapido < lento, `td menor deveria convergir antes: ${rapido} vs ${lento}`)
})

test('filamento quase opaco esconde a base em uma camada', () => {
  const opaco = fil('#D62828', 0.02) // T = 10^-10 com camada de 0.2mm
  const sobrePreto = buildPalette(plan(0.2, '#000000', [opaco]))[1]
  const sobreBranco = buildPalette(plan(0.2, '#FFFFFF', [opaco]))[1]
  assert.deepEqual(sobrePreto, sobreBranco, 'a base ainda está vazando')
  assert.ok(dist(sobrePreto, { r: 0xd6, g: 0x28, b: 0x28 }) < 0.5)
})

test('filamento muito translúcido quase não muda a cor de baixo', () => {
  const base = { r: 0x20, g: 0x80, b: 0x40 }
  const p = buildPalette(plan(0.05, '#208040', [fil('#FFFFFF', 150)]))
  assert.ok(dist(p[1], base) < 1, `ΔE=${dist(p[1], base)} — translúcido demais para mudar tanto`)
  assert.notDeepEqual(p[1], p[0], 'mas alguma coisa tem que mudar')
})

test('schedule heterogêneo compõe de baixo para cima, na ordem do array', () => {
  // Três filamentos diferentes: só assim a ordem de composição fica travada.
  // Valores conferidos à mão fora do código sob teste (Beer-Lambert em luz linear).
  const p = buildPalette({
    layerHeight: 0.16,
    baseLayers: 4,
    base: fil('#1B1B1B', 0.5),
    schedule: [fil('#D62828', 1.2), fil('#F5A623', 3.4), fil('#0F62FE', 0.7)],
  })

  assert.deepEqual(p, [
    { r: 27, g: 27, b: 27 },
    { r: 119, g: 31, b: 31 },
    { r: 140, g: 64, b: 31 },
    { r: 110, g: 80, b: 172 },
  ])

  // A paleta invertida seria [.., {23,67,172}, {90,85,164}, {138,76,144}]:
  // o vermelho tem que aparecer primeiro, não o azul.
  assert.ok(dist(p[1], { r: 23, g: 67, b: 172 }) > 50, 'ordem do schedule invertida')
})

test('layerHeight entra no cálculo: camada mais grossa esconde mais a base', () => {
  const branco = [fil('#FFFFFF', 1.0), fil('#FFFFFF', 1.0)]
  const fino = buildPalette(plan(0.08, '#000000', branco))
  const grosso = buildPalette(plan(0.32, '#000000', branco))

  // Nenhum dos dois é 0.2 — um layerHeight fixo no código erraria os dois.
  assert.deepEqual(fino, [{ r: 0, g: 0, b: 0 }, { r: 114, g: 114, b: 114 }, { r: 151, g: 151, b: 151 }])
  assert.deepEqual(grosso, [{ r: 0, g: 0, b: 0 }, { r: 191, g: 191, b: 191 }, { r: 227, g: 227, b: 227 }])

  for (let i = 1; i < fino.length; i++) {
    assert.ok(grosso[i].r > fino[i].r, `camada ${i}: a mais grossa tinha que cobrir mais o preto`)
  }
})

test('branco sobre preto com T=0.5 dá 188, não 127 (mistura em luz linear)', () => {
  const camada = 0.2
  const td = camada / Math.log10(2) // 10^(-camada/td) = 0.5
  assert.ok(Math.abs(layerTransmission(camada, td) - 0.5) < 1e-12)

  const p = buildPalette(plan(camada, '#000000', [fil('#FFFFFF', td)]))
  // metade da luz do branco (linear 0.5) em sRGB: 1.055*0.5^(1/2.4)-0.055 = 0.73536 → 187.5 → 188
  assert.deepEqual(p[1], { r: 188, g: 188, b: 188 })
  assert.notEqual(p[1].r, 127, 'composição feita na curva sRGB — errado')
})
