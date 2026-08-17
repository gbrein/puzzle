/**
 * Tipagem mínima do clipper-lib (não traz .d.ts próprio) — só o que a gente usa.
 * A versão TS oficial (clipper2-js) foi descartada: o offset dela devolve
 * geometria errada para um quadrado simples.
 */
declare module 'clipper-lib' {
  export interface IntPoint {
    X: number
    Y: number
  }
  export type Path = IntPoint[]
  export type Paths = Path[]

  export const JoinType: { jtSquare: number; jtRound: number; jtMiter: number }
  export const EndType: {
    etClosedPolygon: number
    etClosedLine: number
    etOpenbutt: number
    etOpenSquare: number
    etOpenRound: number
  }

  export class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number)
    AddPath(path: Path, joinType: number, endType: number): void
    Execute(solution: Paths, delta: number): void
    Clear(): void
  }

  const _default: {
    JoinType: typeof JoinType
    EndType: typeof EndType
    ClipperOffset: typeof ClipperOffset
    Paths: new () => Paths
  }
  export default _default
}
