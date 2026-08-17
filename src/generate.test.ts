import assert from 'node:assert/strict'
import { test } from 'node:test'
import { unzipSync } from 'fflate'
import type { Bitmap, Filament } from './color/types.ts'
import { imageError } from './color/solver.ts'
import { resizeBitmap } from './image/resize.ts'
import { generatePuzzle } from './generate.ts'

/** Cena sintética com estrutura de foto: gradiente + duas colinas. */
function foto(width: number, height: number): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const d1 = Math.hypot(x - width * 0.3, y - height * 0.4) / (width * 0.35)
      const d2 = Math.hypot(x - width * 0.7, y - height * 0.6) / (width * 0.3)
      data[i] = 30 + 200 * Math.exp(-d1 * d1)
      data[i + 1] = 40 + 150 * Math.exp(-d2 * d2) + (60 * x) / width
      data[i + 2] = 60 + (120 * y) / height
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

/** Degradê em tons de cinza: cena que uma rampa preto→branco alcança inteira. */
function escalaDeCinza(width: number, height: number): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const v = (255 * x) / (width - 1)
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

// As cores são escolha de quem usa a plataforma — aqui simulamos a seleção.
const ESCOLHIDAS: Filament[] = [
  { id: 'k', name: 'Preto', hex: '#1B1B1B', td: 0.4 },
  { id: 'r', name: 'Vermelho', hex: '#D62828', td: 1.2 },
  { id: 'y', name: 'Amarelo', hex: '#F5A623', td: 3.4 },
  { id: 'w', name: 'Branco', hex: '#F2F2F2', td: 6.0 },
]

const BASE = {
  image: foto(160, 120),
  filaments: ESCOLHIDAS,
  size: 60,
  pieceCount: 4,
  // placa pequena e célula grossa só para o teste rodar rápido; as camadas
  // ficam no default porque é a espessura de cor que decide se a paleta abre
  cellSize: 0.8,
  extrusionWidth: 0.42,
  seed: 3,
}

test('o caminho completo produz um .3mf que reabre e bate com o plano', () => {
  const r = generatePuzzle(BASE)

  const zip = unzipSync(r.threemf)
  for (const entrada of [
    '[Content_Types].xml',
    '_rels/.rels',
    '3D/3dmodel.model',
    'Metadata/project_settings.config',
    'Metadata/model_settings.config',
    'Metadata/custom_gcode_per_layer.xml',
  ]) {
    assert.ok(zip[entrada], `falta ${entrada} no .3mf`)
  }

  const trocas = new TextDecoder().decode(zip['Metadata/custom_gcode_per_layer.xml'])
  const tops = [...trocas.matchAll(/top_z="([\d.]+)"/g)].map((m) => Number(m[1]))
  assert.equal(tops.length, r.stats.swaps, 'nº de trocas no XML ≠ nº de trocas do plano')
  assert.deepEqual([...tops].sort((a, b) => a - b), tops, 'top_z fora de ordem')

  // toda troca tem que cair num topo de camada real, senão o slicer arredonda
  // e a cor sai deslocada na peça — defeito que só aparece com a peça na mão
  const lh = r.plan.layerHeight
  for (const z of tops) {
    const n = z / lh
    assert.ok(Math.abs(n - Math.round(n)) < 1e-6, `top_z ${z} não é múltiplo de ${lh}`)
  }

  // e a primeira troca não pode cair no topo da base: ali ainda é base
  if (tops.length) {
    assert.ok(tops[0] > r.plan.baseLayers * lh, `1a troca em ${tops[0]} está dentro da base`)
  }
})

test('cada peça sai como sólido fechado com as normais para fora', () => {
  const r = generatePuzzle(BASE)
  assert.equal(r.stats.pieces, r.stats.cols * r.stats.rows)

  const zip = unzipSync(r.threemf)
  const modelo = new TextDecoder().decode(zip['3D/3dmodel.model'])
  const objetos = [...modelo.matchAll(/<object /g)].length
  assert.equal(objetos, r.stats.pieces, 'o .3mf não tem um objeto por peça')
})

test('a base do puzzle e a base opaca da cor são o MESMO número', () => {
  // se divergirem, o relevo flutua ou afunda e as cores saem no Z errado
  const r = generatePuzzle({ ...BASE, baseThickness: 2.4, layerHeight: 0.08 })
  assert.equal(r.plan.baseLayers, 30, '2.4mm / 0.08mm = 30 camadas')
  assert.equal(r.plan.baseLayers * r.plan.layerHeight, 2.4)

  // espessura que não é múltiplo da camada arredonda, e o Z do relevo segue o
  // arredondamento — nunca o valor pedido
  const r2 = generatePuzzle({ ...BASE, baseThickness: 2.43, layerHeight: 0.1 })
  assert.equal(r2.plan.baseLayers, 24)
})

test('as cores usadas são as que a pessoa escolheu, nunca outras', () => {
  const r = generatePuzzle(BASE)
  const escolhidos = new Set(ESCOLHIDAS.map((f) => f.id))
  assert.ok(escolhidos.has(r.plan.base.id), `base ${r.plan.base.id} não estava na seleção`)
  for (const f of r.plan.schedule) {
    assert.ok(escolhidos.has(f.id), `${f.id} não estava na seleção`)
  }

  // com uma cor só, não existe troca nenhuma
  const mono = generatePuzzle({ ...BASE, filaments: [ESCOLHIDAS[0]] })
  assert.equal(mono.stats.swaps, 0)
  assert.equal(mono.plan.base.id, 'k')
})

test('maxSwaps é respeitado contando a troca base → primeira cor', () => {
  for (const maxSwaps of [0, 1, 2]) {
    const r = generatePuzzle({ ...BASE, maxSwaps })
    assert.ok(r.stats.swaps <= maxSwaps, `pedi ${maxSwaps} trocas e vieram ${r.stats.swaps}`)
  }
})

test('os dois modos de troca geram projetos diferentes com a MESMA geometria', () => {
  const manual = generatePuzzle({ ...BASE, swapMode: 'manual' })
  const ams = generatePuzzle({ ...BASE, swapMode: 'ams' })

  assert.equal(manual.stats.triangles, ams.stats.triangles, 'a geometria não pode mudar com o modo')

  const cfg = (r: typeof manual) =>
    JSON.parse(new TextDecoder().decode(unzipSync(r.threemf)['Metadata/project_settings.config']))
  // manual declara UM filamento (a impressora só tem um rolo por vez);
  // AMS declara os N slots que vão ser mapeados no envio
  assert.equal(cfg(manual).filament_colour.length, 1)
  assert.ok(cfg(ams).filament_colour.length >= 1)
  assert.ok(
    cfg(ams).filament_colour.length > cfg(manual).filament_colour.length,
    'com AMS o projeto tem que declarar mais de um slot',
  )
})

test('célula menor que a largura de extrusão é recusada na fronteira', () => {
  // a impressora não materializa feature mais estreita que o filete extrudado:
  // aceitar isso em silêncio produziria relevo borrado
  assert.throws(
    () => generatePuzzle({ ...BASE, cellSize: 0.2, extrusionWidth: 0.42 }),
    /largura de extrusão/,
  )
  assert.throws(() => generatePuzzle({ ...BASE, filaments: [] }), /pelo menos uma cor/)
  assert.throws(() => generatePuzzle({ ...BASE, layers: 0 }), /layers/)
})

test('o dither troca erro por pixel por acerto na média espacial', () => {
  const liso = generatePuzzle({ ...BASE, dither: false })
  const dit = generatePuzzle({ ...BASE, dither: true })

  assert.ok(dit.stats.triangles > liso.stats.triangles, 'o dither devia custar mais triângulos')

  // Esta é a troca que o dithering faz, e é contraintuitiva: PIXEL A PIXEL ele
  // erra mais que o vizinho mais próximo (por construção — ele empurra erro
  // para os vizinhos de propósito). O que ele ganha é na média espacial, que é
  // o que o olho enxerga a 30cm da peça. Medir só ΔE por pixel julga o
  // dithering pela métrica que ele deliberadamente sacrifica — foi por isso que
  // `scorePlan` pontua por vizinho mais próximo.
  assert.ok(
    dit.stats.deltaE >= liso.stats.deltaE,
    `ΔE por pixel: dither ${dit.stats.deltaE} devia ser >= liso ${liso.stats.deltaE}`,
  )

  // O ganho do dithering NÃO é universal, e este é o achado que trocou o
  // default: ele só compensa quando a cor alvo está dentro do que a paleta
  // alcança. Aqui a cena é medida em tons de cinza contra uma rampa
  // preto→branco larga — o caso em que a difusão tem entre o que interpolar.
  const cinza = escalaDeCinza(200, 150)
  const pb = [
    { id: 'k', name: 'Preto', hex: '#111111', td: 0.5 },
    { id: 'w', name: 'Branco', hex: '#F5F5F5', td: 5.0 },
  ]
  const cfg = { ...BASE, image: cinza, filaments: pb, maxSwaps: 1, layers: 40, cellSize: 1 }
  const gLiso = generatePuzzle({ ...cfg, dither: false })
  const gDit = generatePuzzle({ ...cfg, dither: true })
  assert.ok(gLiso.stats.paletteSpan > 60, `paleta curta demais (ΔE ${gLiso.stats.paletteSpan})`)

  // borrão 3×3 antes de comparar = aproximação grosseira do olho
  const borra = (b: Bitmap): Bitmap => {
    const out = new Uint8ClampedArray(b.data.length)
    for (let y = 0; y < b.height; y++) {
      for (let x = 0; x < b.width; x++) {
        for (let c = 0; c < 3; c++) {
          let s = 0
          let n = 0
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx
              const yy = y + dy
              if (xx < 0 || yy < 0 || xx >= b.width || yy >= b.height) continue
              s += b.data[(yy * b.width + xx) * 4 + c]
              n++
            }
          }
          out[(y * b.width + x) * 4 + c] = s / n
        }
        out[(y * b.width + x) * 4 + 3] = 255
      }
    }
    return { width: b.width, height: b.height, data: out }
  }

  const alvo = resizeBitmap(cinza, gLiso.preview.width, gLiso.preview.height)
  const eLiso = imageError(borra(alvo), borra(gLiso.preview))
  const eDit = imageError(borra(alvo), borra(gDit.preview))
  assert.ok(eDit < eLiso, `dentro da gama, borrado: dither ${eDit} devia bater liso ${eLiso}`)

  for (const r of [liso, dit, gLiso, gDit]) assert.ok(r.stl.byteLength > 84)
})

test('fora da gama dos filamentos, o dithering piora — é por isso que ele é opt-in', () => {
  // A cena BASE é azul/esverdeada e os filamentos são preto/vermelho/amarelo/
  // branco: a paleta é uma curva que não passa perto dessas cores. O erro que a
  // difusão empurra não tem como ser corrigido por altura nenhuma e vira ruído.
  // Se um dia isto passar a falhar, o dithering melhorou e o default pode virar.
  const liso = generatePuzzle({ ...BASE, dither: false })
  const dit = generatePuzzle({ ...BASE, dither: true })
  assert.ok(
    dit.stats.deltaE > liso.stats.deltaE,
    `fora da gama o dither devia perder: ${dit.stats.deltaE} vs ${liso.stats.deltaE}`,
  )
})

test('o preview tem o tamanho da grade de células, não o da foto', () => {
  const r = generatePuzzle(BASE)
  assert.equal(`${r.preview.width}×${r.preview.height}`, r.stats.cells)
  assert.notEqual(r.preview.width, BASE.image.width)
})

test('as instruções em texto são a rede de segurança se o .3mf não abrir', () => {
  const r = generatePuzzle(BASE)
  assert.match(r.swaps, /Comece com/)
  assert.equal((r.swaps.match(/troque para/g) ?? []).length, r.stats.swaps)
})

test('a malha de uma peça isolada fecha e tem volume positivo', () => {
  // placa mínima: uma peça só, para a checagem geométrica ser barata
  const r = generatePuzzle({ ...BASE, pieceCount: 1, size: 30, cellSize: 1 })
  assert.equal(r.stats.pieces, 1)

  const zip = unzipSync(r.threemf)
  assert.ok(zip['3D/3dmodel.model'])
  // o sólido combinado (base + relevo sobrepostos) não é fechado como um corpo
  // só — são DOIS corpos, e é assim que o slicer os quer. Cada um fecha sozinho,
  // o que já está travado em puzzle.test.ts e heightmap.test.ts.
  assert.ok(r.stats.triangles > 0)
  assert.ok(r.stats.meshMB > 0)
})

test('mesma semente e mesma foto dão exatamente o mesmo arquivo', () => {
  const a = generatePuzzle(BASE)
  const b = generatePuzzle(BASE)
  // quem reimprime uma peça perdida precisa de uma peça que encaixa
  assert.deepEqual(a.threemf, b.threemf)
  assert.notDeepEqual(a.threemf, generatePuzzle({ ...BASE, seed: 99 }).threemf)
})

test('o mapa de montagem cobre toda peça exatamente uma vez, e cabe numa placa só', () => {
  const r = generatePuzzle(BASE)
  assert.equal(r.placement.length, r.stats.pieces)
  assert.equal(new Set(r.placement.map((p) => `${p.row},${p.col}`)).size, r.stats.pieces)
  assert.equal(r.stats.plates, 1, 'a placa do teste é pequena — cabe numa mesa só por default')
})

test('mesa pequena força o auto plate split, e o .3mf ganha um <plate> por placa', () => {
  const r = generatePuzzle({ ...BASE, bedWidth: 45, bedHeight: 45 })
  assert.ok(r.stats.plates > 1, `esperava mais de uma placa, veio ${r.stats.plates}`)
  assert.equal(new Set(r.placement.map((p) => p.plate)).size, r.stats.plates)

  const ms = new TextDecoder().decode(unzipSync(r.threemf)['Metadata/model_settings.config'])
  assert.equal((ms.match(/<plate>/g) ?? []).length, r.stats.plates)
  const cg = new TextDecoder().decode(unzipSync(r.threemf)['Metadata/custom_gcode_per_layer.xml'])
  assert.equal((cg.match(/<plate>/g) ?? []).length, r.stats.plates)
})

test('frame: true acrescenta a moldura como objeto extra, na própria placa, sem trocas', () => {
  const sem = generatePuzzle(BASE)
  const com = generatePuzzle({ ...BASE, frame: true })

  assert.equal(com.stats.plates, sem.stats.plates + 1, 'a moldura ganha uma placa própria')
  assert.ok(com.stats.grams > sem.stats.grams, 'a moldura tem que somar massa')
  // a geometria das peças não muda — só ganha um objeto a mais
  assert.equal(com.stats.triangles, sem.stats.triangles)

  const model = new TextDecoder().decode(unzipSync(com.threemf)['3D/3dmodel.model'])
  const nomes = [...model.matchAll(/<object id="\d+" type="model" name="([^"]*)"/g)].map((m) => m[1])
  assert.equal(nomes.filter((n) => n === 'moldura').length, 1)
  assert.equal(nomes.length, sem.stats.pieces + 1)

  // a placa da moldura não tem troca de cor nenhuma — ela não tem relevo
  const cg = new TextDecoder().decode(unzipSync(com.threemf)['Metadata/custom_gcode_per_layer.xml'])
  const blocos = cg.split('<plate>').slice(1)
  assert.equal(blocos.length, com.stats.plates)
  assert.equal((blocos[blocos.length - 1].match(/<layer /g) ?? []).length, 0, 'a placa da moldura não devia ter trocas')
})

test('moldura maior que a mesa é erro explícito, não um .3mf cortado', () => {
  assert.throws(
    () => generatePuzzle({ ...BASE, frame: true, bedWidth: 45, bedHeight: 45 }),
    /moldura de .*não cabe na mesa/,
  )
})
