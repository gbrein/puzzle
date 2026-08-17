import type { GenerateOptions, GenerateResult } from '../generate.ts'

/** Etapa grosseira da geração (o núcleo não reporta fases — degraus). */
export interface Progresso {
  etapa: string
  pct: number
}

// Tipos das mensagens da fronteira client ↔ worker. Exportados porque o
// `gerar.worker.ts` importa só o tipo (type-only, some no build).
export interface MensagemGerar {
  tipo: 'gerar'
  id: number
  opts: GenerateOptions
}
export interface MensagemProgresso {
  tipo: 'progresso'
  id: number
  etapa: string
  pct: number
}
export interface MensagemResultado {
  tipo: 'resultado'
  id: number
  resultado: GenerateResult
}
export interface MensagemErro {
  tipo: 'erro'
  id: number
  mensagem: string
}
export type MensagemDoWorker = MensagemProgresso | MensagemResultado | MensagemErro

let workerAtual: Worker | null = null
let rejeitarAtual: ((erro: Error) => void) | null = null
let proximoId = 1

const limpar = () => {
  workerAtual = null
  rejeitarAtual = null
}

/**
 * Roda `generatePuzzle` num Web Worker. `onProgresso` é opcional.
 *
 * Só uma geração por vez: cada chamada ganha um worker novo, e disparar outra
 * enquanto uma roda cancela a anterior. O `terminate()` é o cancelamento mais
 * forte que existe — corta o trabalho no meio do processamento — e libera o
 * RSS da geração (centenas de MB) de volta.
 */
export function gerarNoWorker(
  opts: GenerateOptions,
  onProgresso?: (p: Progresso) => void,
): Promise<GenerateResult> {
  if (workerAtual) cancelar()

  const id = proximoId++
  const worker = new Worker(new URL('./gerar.worker.ts', import.meta.url), { type: 'module' })

  return new Promise<GenerateResult>((resolve, reject) => {
    workerAtual = worker
    rejeitarAtual = reject

    worker.onmessage = (e: MessageEvent<MensagemDoWorker>) => {
      const msg = e.data
      if (msg.id !== id) return
      if (msg.tipo === 'progresso') {
        // progresso é best-effort: um callback da UI que lança não pode travar
        // o handler e pendurar a promise do resultado
        try {
          onProgresso?.({ etapa: msg.etapa, pct: msg.pct })
        } catch {
          /* ignora — o resultado segue valendo */
        }
        return
      }
      limpar()
      worker.terminate()
      if (msg.tipo === 'resultado') resolve(msg.resultado)
      else reject(new Error(msg.mensagem))
    }

    worker.onerror = (e) => {
      limpar()
      worker.terminate()
      // erro de script do worker — o `message` do evento não é confiável em
      // todos os navegadores, então o fallback fica explícito
      reject(new Error(e.message || 'erro desconhecido no worker'))
    }

    worker.postMessage({ tipo: 'gerar', id, opts })
  })
}

/** Cancela a geração em curso, se houver. */
export function cancelar(): void {
  const w = workerAtual
  const rejeitar = rejeitarAtual
  limpar()
  if (w) w.terminate()
  if (rejeitar) rejeitar(new Error('geração cancelada'))
}