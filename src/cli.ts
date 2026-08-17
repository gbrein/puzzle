import { writeFileSync } from 'node:fs'
import { toBinarySTL } from './export/stl.ts'
import { triangleCount } from './mesh/mesh.ts'
import { buildPuzzle } from './puzzle.ts'

/**
 * CLI de desenvolvimento. O produto é o app no browser — isto existe pra
 * inspecionar a geometria sem abrir o navegador.
 *
 *   node src/cli.ts --size 180 --aspect 1.5 --pieces 16 --out puzzle.stl
 */
function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = Number(process.argv[i + 1])
  if (!Number.isFinite(v)) throw new Error(`--${name} precisa de um número`)
  return v
}

const outIdx = process.argv.indexOf('--out')
const out = outIdx === -1 ? 'puzzle.stl' : process.argv[outIdx + 1]

const result = buildPuzzle({
  size: arg('size', 180),
  aspect: arg('aspect', 1),
  pieceCount: arg('pieces', 16),
  thickness: arg('thickness', 3),
  kerf: arg('kerf', 0.15),
  seed: arg('seed', 1),
})

writeFileSync(out, toBinarySTL(result.mesh))
console.log(
  `${result.cols}×${result.rows} = ${result.cols * result.rows} peças · ` +
    `${result.width.toFixed(1)}×${result.height.toFixed(1)}mm · ` +
    `${triangleCount(result.mesh)} triângulos → ${out}`,
)
