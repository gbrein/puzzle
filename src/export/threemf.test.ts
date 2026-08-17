import test from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync } from 'fflate'
import { extrudePolygon } from '../mesh/extrude.ts'
import { triangleCount } from '../mesh/mesh.ts'
import { writeProject3MF, type ProjectOptions } from './threemf.ts'

const cubo = () =>
  extrudePolygon(
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    0,
    5,
  )

const base = (): ProjectOptions => ({
  objects: [{ name: 'peca-1', mesh: cubo() }],
  filaments: [
    { color: '#000000', type: 'PLA' },
    { color: '#FFFFFF', type: 'PLA' },
    { color: '#0F62FE', type: 'PETG' },
  ],
  colorChanges: [
    { topZ: 0.6, extruder: 2, color: '#FFFFFF' },
    { topZ: 1.2, extruder: 3, color: '#0F62FE' },
    { topZ: 2.04, extruder: 1, color: '#000000' },
  ],
  printerModel: 'Bambu Lab X1C',
  layerHeight: 0.12,
})

const abrir = (o: ProjectOptions) => {
  const zip = unzipSync(writeProject3MF(o))
  const txt = (p: string) => new TextDecoder().decode(zip[p])
  return { zip, txt }
}

/** Extrai os atributos de cada tag `<nome ...>` — parser mínimo, sem dependência. */
function tags(xml: string, nome: string): Record<string, string>[] {
  const out: Record<string, string>[] = []
  for (const m of xml.matchAll(new RegExp(`<${nome}\\s([^>]*?)/?>`, 'g'))) {
    const attrs: Record<string, string> = {}
    for (const a of m[1].matchAll(/([\w:]+)="([^"]*)"/g)) attrs[a[1]] = a[2]
    out.push(attrs)
  }
  return out
}

test('o zip tem exatamente as entradas esperadas', () => {
  const { zip } = abrir(base())
  assert.deepEqual(Object.keys(zip).sort(), [
    '3D/3dmodel.model',
    'Metadata/custom_gcode_per_layer.xml',
    'Metadata/model_settings.config',
    'Metadata/project_settings.config',
    '[Content_Types].xml',
    '_rels/.rels',
  ])
})

test('os XMLs têm a estrutura que o slicer espera', () => {
  const { txt } = abrir(base())

  const model = txt('3D/3dmodel.model')
  assert.match(model, /^<\?xml version="1\.0" encoding="UTF-8"\?>/)
  assert.match(model, /<resources>[\s\S]*<object id="1" type="model"[\s\S]*<\/resources>/)
  assert.match(model, /<mesh>\s*<vertices>/)
  assert.equal(tags(model, 'item')[0].objectid, '1')

  const ms = txt('Metadata/model_settings.config')
  assert.equal(tags(ms, 'metadata').find((m) => m.key === 'plater_id')?.value, '1')
  assert.equal(tags(ms, 'metadata').find((m) => m.key === 'extruder')?.value, '1')
  assert.match(ms, /<plate>[\s\S]*<\/plate>/)

  const cg = txt('Metadata/custom_gcode_per_layer.xml')
  assert.match(cg, /<custom_gcodes_per_layer>\s*<plate>\s*<plate_info id="1"\/>/)
  assert.match(cg, /<\/plate>\s*<\/custom_gcodes_per_layer>/)

  assert.match(txt('_rels/.rels'), /Target="\/3D\/3dmodel\.model"/)
  assert.match(txt('[Content_Types].xml'), /Extension="model"/)

  // JSON plano de verdade: nada aninhado além dos arrays de topo.
  const cfg = JSON.parse(txt('Metadata/project_settings.config'))
  assert.equal(typeof cfg, 'object')
  assert.equal(cfg.printer_model, 'Bambu Lab X1C')
  assert.equal(cfg.layer_height, '0.12')
})

test('a malha é indexada: menos vértices que os crus, mesma contagem de triângulos', () => {
  const m = cubo()
  const { txt } = abrir({ ...base(), objects: [{ name: 'c', mesh: m }] })
  const model = txt('3D/3dmodel.model')

  const verts = tags(model, 'vertex')
  const tris = tags(model, 'triangle')

  assert.equal(tris.length, triangleCount(m))
  assert.equal(verts.length, 8, 'um cubo tem 8 esquinas depois do dedupe')
  assert.ok(verts.length < m.verts.length / 3, 'o dedupe tem que reduzir os 36 vértices crus')

  // os índices apontam pra dentro do array e reconstroem a geometria original
  for (let t = 0; t < tris.length; t++) {
    for (const k of ['v1', 'v2', 'v3'] as const) {
      const i = Number(tris[t][k])
      assert.ok(Number.isInteger(i) && i >= 0 && i < verts.length, `índice ${tris[t][k]} fora do intervalo`)
    }
    const cru = m.verts.slice(t * 9, t * 9 + 9)
    const rec = ['v1', 'v2', 'v3'].flatMap((k) => {
      const v = verts[Number(tris[t][k as 'v1'])]
      return [Number(v.x), Number(v.y), Number(v.z)]
    })
    for (let k = 0; k < 9; k++) assert.ok(Math.abs(cru[k] - rec[k]) < 1e-4, `vértice ${k} do triângulo ${t}`)
  }

  // e os 8 vértices são mesmo distintos
  assert.equal(new Set(verts.map((v) => `${v.x},${v.y},${v.z}`)).size, 8)
})

test('as trocas saem na ordem, com top_z e extrusora da entrada', () => {
  const o = base()
  const { txt } = abrir(o)
  const layers = tags(txt('Metadata/custom_gcode_per_layer.xml'), 'layer')

  assert.equal(layers.length, o.colorChanges.length)
  assert.deepEqual(
    layers.map((l) => [Number(l.top_z), Number(l.extruder), l.color]),
    o.colorChanges.map((c) => [c.topZ, c.extruder, c.color]),
  )
  for (const l of layers) {
    assert.equal(l.gcode, 'tool_change')
    assert.equal(l.type, '1')
  }
})

test('filament_colour e filament_type batem com a entrada, na ordem', () => {
  const o = base()
  const cfg = JSON.parse(abrir(o).txt('Metadata/project_settings.config'))
  assert.deepEqual(cfg.filament_colour, ['#000000', '#FFFFFF', '#0F62FE'])
  assert.deepEqual(cfg.filament_type, ['PLA', 'PLA', 'PETG'])
})

test('nome de objeto com & e < sai escapado', () => {
  const o = base()
  o.objects = [{ name: 'peça <A> & "B" \'c\'', mesh: cubo() }]
  const { txt } = abrir(o)
  const esperado = 'pe&#231;a &lt;A&gt; &amp; &quot;B&quot; &apos;c&apos;'.replace('&#231;', 'ç')

  for (const p of ['3D/3dmodel.model', 'Metadata/model_settings.config']) {
    const xml = txt(p)
    assert.ok(xml.includes(esperado), `${p} não escapou o nome`)
    assert.ok(!xml.includes('<A>'), `${p} deixou markup cru vazar`)
    // o parser de atributos ainda lê o nome inteiro: o escape não quebrou a tag
    const nome = tags(xml, p.endsWith('.model') ? 'object' : 'metadata').find((t) => t.name ?? t.value)
    assert.ok(nome)
  }
})

test('vários objetos viram ids sequenciais', () => {
  const o = base()
  o.objects = [
    { name: 'a', mesh: cubo() },
    { name: 'b', mesh: cubo() },
  ]
  const { txt } = abrir(o)
  assert.deepEqual(
    tags(txt('3D/3dmodel.model'), 'object').map((t) => t.id),
    ['1', '2'],
  )
  assert.deepEqual(
    tags(txt('3D/3dmodel.model'), 'item').map((t) => t.objectid),
    ['1', '2'],
  )
})

test('entradas inválidas lançam', () => {
  assert.throws(() => writeProject3MF({ ...base(), objects: [] }), /objetos vazia/)
  assert.throws(() => writeProject3MF({ ...base(), filaments: [] }), /filamento/)
  assert.throws(
    () => writeProject3MF({ ...base(), objects: [{ name: 'vazio', mesh: { verts: [] } }] }),
    /triângulos/,
  )
  // extrusora 0-indexada é o erro clássico: os slots são 1-indexados
  assert.throws(
    () => writeProject3MF({ ...base(), colorChanges: [{ topZ: 1, extruder: 0, color: '#000' }] }),
    /1\.\.3/,
  )
  assert.throws(
    () => writeProject3MF({ ...base(), colorChanges: [{ topZ: 1, extruder: 4, color: '#000' }] }),
    /1\.\.3/,
  )
  assert.throws(
    () =>
      writeProject3MF({
        ...base(),
        colorChanges: [
          { topZ: 1.2, extruder: 2, color: '#000' },
          { topZ: 0.6, extruder: 3, color: '#fff' },
        ],
      }),
    /top_z/,
  )
  // topo repetido também é inválido: duas trocas na mesma camada
  assert.throws(
    () =>
      writeProject3MF({
        ...base(),
        colorChanges: [
          { topZ: 1.2, extruder: 2, color: '#000' },
          { topZ: 1.2, extruder: 3, color: '#fff' },
        ],
      }),
    /top_z/,
  )
})

test('sem trocas continua gerando um projeto válido', () => {
  const { txt } = abrir({ ...base(), colorChanges: [] })
  const cg = txt('Metadata/custom_gcode_per_layer.xml')
  assert.equal(tags(cg, 'layer').length, 0)
  assert.match(cg, /<custom_gcodes_per_layer>/)
})
