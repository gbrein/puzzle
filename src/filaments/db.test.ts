import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FILAMENTS, findFilament } from './db.ts'
import { fitTD, type Sample } from './calibrate.ts'
import { parseHex } from '../color/space.ts'

/** Amostras perfeitas geradas pela própria lei T = 10^(-t/TD). */
function synth(td: number, thicknesses: number[]): Sample[] {
  return thicknesses.map((t) => ({ thicknessMm: t, transmission: 10 ** (-t / td) }))
}

const ESPESSURAS = [0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4]

// --- calibração ---

test('recupera o TD de amostras sintéticas com erro < 1%', () => {
  for (const td of [0.4, 3.2, 7.1, 12]) {
    const { td: fit, r2, confidence } = fitTD(synth(td, ESPESSURAS))
    assert.ok(Math.abs(fit - td) / td < 0.01, `TD ${td} virou ${fit}`)
    assert.ok(r2 > 0.999, `R² deveria ser ~1 em dados perfeitos, veio ${r2}`)
    assert.equal(confidence, 'alta')
  }
})

test('poucas amostras, mesmo perfeitas, não dão confiança alta', () => {
  assert.equal(fitTD(synth(4, [1.0, 1.5, 2.0])).confidence, 'media')
  assert.equal(fitTD(synth(4, [1.0])).confidence, 'baixa')
})

test('ruído derruba o R² e a confiança sem estragar o TD', () => {
  const td = 4
  const limpo = synth(td, ESPESSURAS)
  // Fatores fixos (±12%) para o teste ser determinístico — média ~1 para o
  // ruído não virar viés e mascarar a queda do R² como erro de TD.
  const ruido = [1.12, 0.9, 1.1, 0.88, 1.09, 0.91, 1.11, 0.89, 1.1, 0.9]
  const sujo = limpo.map((s, i) => ({ ...s, transmission: s.transmission * ruido[i] }))

  const a = fitTD(limpo)
  const b = fitTD(sujo)

  assert.ok(b.r2 < a.r2, 'ruído tinha que baixar o R²')
  assert.ok(b.r2 < 0.98, `R² com ruído deveria cair abaixo de 0.98, veio ${b.r2}`)
  assert.notEqual(b.confidence, 'alta')
  // O TD sobrevive ao ruído (é a média que manda), só a confiança cai.
  assert.ok(Math.abs(b.td - td) / td < 0.15)
})

test('entrada inválida lança com mensagem clara', () => {
  assert.throws(() => fitTD([]), /ao menos uma amostra/)
  assert.throws(() => fitTD([{ thicknessMm: 0, transmission: 0.5 }]), /espessura inválida/)
  assert.throws(() => fitTD([{ thicknessMm: -1, transmission: 0.5 }]), /espessura inválida/)
  assert.throws(() => fitTD([{ thicknessMm: NaN, transmission: 0.5 }]), /espessura inválida/)
  assert.throws(() => fitTD([{ thicknessMm: 1, transmission: 0 }]), /transmissão inválida/)
  assert.throws(() => fitTD([{ thicknessMm: 1, transmission: -0.2 }]), /transmissão inválida/)
  assert.throws(() => fitTD([{ thicknessMm: 1, transmission: 1.4 }]), /transmissão inválida/)
  // O índice da amostra ruim aparece na mensagem.
  assert.throws(() => fitTD([{ thicknessMm: 1, transmission: 0.5 }, { thicknessMm: 2, transmission: 2 }]), /amostra 1/)
})

test('amostras sem atenuação nenhuma não viram TD infinito', () => {
  assert.throws(
    () => fitTD([{ thicknessMm: 1, transmission: 1 }, { thicknessMm: 2, transmission: 1 }]),
    /não mostram atenuação/,
  )
})

// --- catálogo ---

test('catálogo tem massa crítica e nenhum item quebrado', () => {
  assert.ok(FILAMENTS.length >= 20, `catálogo pequeno demais: ${FILAMENTS.length}`)
  const vistos = new Set<string>()
  for (const f of FILAMENTS) {
    assert.ok(f.id.length > 0 && !vistos.has(f.id), `id duplicado ou vazio: ${f.id}`)
    vistos.add(f.id)
    assert.ok(f.name.length > 0, `${f.id} sem nome`)
    assert.doesNotThrow(() => parseHex(f.hex), `${f.id} tem hex inválido: ${f.hex}`)
    assert.ok(Number.isFinite(f.td) && f.td > 0, `${f.id} tem td inválido: ${f.td}`)
  }
})

test('branco é bem mais translúcido que preto', () => {
  const branco = findFilament('prusament-pla-vanilla-white')
  const preto = findFilament('prusament-pla-jet-black')
  assert.ok(branco && preto)
  assert.ok(branco.td >= 6, `branco deveria ter TD alto, veio ${branco.td}`)
  assert.ok(preto.td <= 1, `preto deveria ter TD baixo, veio ${preto.td}`)
  assert.ok(branco.td > preto.td * 5, 'a diferença entre branco e preto deveria ser de ordem de grandeza')
})

test('findFilament acha pelo id e devolve undefined no que não existe', () => {
  assert.equal(findFilament('prusament-pla-jet-black')?.hex, '#24292A')
  assert.equal(findFilament('nao-existe'), undefined)
})

test('todo TD estimado está marcado, e nenhum verbatim da Prusa está', () => {
  for (const f of FILAMENTS) {
    if (f.id.startsWith('bambu-')) assert.equal(f.estimated, true, `${f.id} deveria estar marcado como estimativa`)
    if (f.id.startsWith('prusament-')) assert.notEqual(f.estimated, true, `${f.id} veio de fonte publicada`)
  }
})

// Um filamento do catálogo, calibrado a partir do próprio TD publicado, volta
// igual: amarra o catálogo e o ajuste na mesma convenção de TD.
test('catálogo e calibração falam a mesma língua', () => {
  const f = findFilament('prusament-pla-pineapple-yellow')!
  const { td } = fitTD(synth(f.td, [1, 2, 3, 4, 5]))
  assert.ok(Math.abs(td - f.td) < 0.01)
})
