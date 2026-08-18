import test from 'node:test'
import assert from 'node:assert/strict'
import { fromLinear, labToLinear, parseHex, rgbToLab, toHex } from './space.ts'

test('labToLinear é a inversa exata de rgbToLab — o tone map depende disso pra voltar pra RGB', () => {
  const cores = ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#7F1D1D', '#0F62FE', '#808080']
  for (const hex of cores) {
    const rgb = parseHex(hex)
    const volta = toHex(fromLinear(labToLinear(rgbToLab(rgb))))
    assert.equal(volta, hex, `${hex} não voltou intacto (${volta})`)
  }
})
