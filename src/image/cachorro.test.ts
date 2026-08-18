import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { lerPPM } from './ppm.ts'
import { resolveColor } from '../color/resolve.ts'
import type { Filament } from '../color/types.ts'

/**
 * Regressão com FOTO DE VERDADE — a primeira do projeto.
 *
 * Tudo o mais usava gradiente sintético, e foi numa foto real (um cachorro
 * preto sobre madeira) que apareceram os dois piores defeitos da semana: o
 * bicho virou mancha chapada e o ΔE premiou o plano errado. O tone map
 * consertou isso remapeando a foto para o que os filamentos alcançam; estes
 * dois números — a fatia de pixels no nível mais populoso e o nº de níveis
 * usados — foram o que PROVOU a correção. Se alguém regredir o tone map, este
 * teste tem que ficar vermelho.
 *
 * Limiares com folga (o ganho medido é ~22 pontos de fatia e +2 níveis): a
 * intenção é travar a DIREÇÃO, não congelar o número exato.
 */

const foto = lerPPM(new Uint8Array(readFileSync(new URL('./fixtures/cachorro.ppm', import.meta.url))))

const FILAMENTOS: Filament[] = [
  { id: 'k', name: 'Preto', hex: '#1B1B1B', td: 0.4 },
  { id: 'b', name: 'Azul', hex: '#0682AC', td: 6.6 },
  { id: 'w', name: 'Branco', hex: '#F2F2F2', td: 6.0 },
]

// A configuração que faz AMBOS os sinais se moverem com folga (medido): a fatia
// cai de ~31% para ~9% e os níveis sobem de 24 para 26 com o tone map ligado.
const OPCOES = {
  width: 120,
  height: 90,
  cellSize: 0.42,
  layerHeight: 0.16,
  baseLayers: 15,
  layers: 25,
  maxSwaps: FILAMENTOS.length - 1,
  dither: false,
  seed: 1,
}

interface Metrica {
  /** % de pixels no nível mais populoso da paleta. */
  fatia: number
  /** nº de níveis distintos presentes no mapa de alturas. */
  niveis: number
}

function medir(toneMap: 'auto' | 'off'): Metrica {
  const r = resolveColor(foto, FILAMENTOS, { ...OPCOES, toneMap })
  const conta = new Map<number, number>()
  for (const v of r.heightMap.data) conta.set(v, (conta.get(v) ?? 0) + 1)
  const fatia = (Math.max(...conta.values()) / r.heightMap.data.length) * 100
  return { fatia, niveis: conta.size }
}

test('a fixture é a foto real, em 160×120', () => {
  assert.equal(foto.width, 160)
  assert.equal(foto.height, 120)
  assert.equal(foto.data.length, 160 * 120 * 4)
})

test('o tone map reduz a fatia no nível mais populoso e aumenta os níveis usados', () => {
  const sem = medir('off')
  const com = medir('auto')

  // direção 1: com o tone map, a fatia de pixels colapsada num único nível cai
  assert.ok(
    com.fatia < sem.fatia - 5,
    `com tone map a fatia (${com.fatia.toFixed(1)}%) devia ser bem menor que sem (${sem.fatia.toFixed(1)}%)`,
  )

  // sanidade: sem tone map a mancha chapada é real (não é teste que passa por acaso)
  assert.ok(sem.fatia > 25, `sem tone map a fatia (${sem.fatia.toFixed(1)}%) devia estar concentrada`)

  // direção 2: com o tone map, mais níveis da paleta são usados
  assert.ok(
    com.niveis > sem.niveis,
    `com tone map devia usar mais níveis (${com.niveis}) do que sem (${sem.niveis})`,
  )
})
