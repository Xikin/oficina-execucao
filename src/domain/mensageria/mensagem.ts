export const SERVICO_EXECUCAO = 'oficina-execucao';

export const COMANDOS = {
  ABRIR_DIAGNOSTICO: 'execucao.comando.abrir-diagnostico',
  LIBERAR_EXECUCAO: 'execucao.comando.liberar-execucao',
  CANCELAR: 'execucao.comando.cancelar',
} as const;

export const EVENTOS = {
  DIAGNOSTICO_INICIADO: 'execucao.evento.diagnostico-iniciado',
  DIAGNOSTICO_CONCLUIDO: 'execucao.evento.diagnostico-concluido',
  EXECUCAO_INICIADA: 'execucao.evento.execucao-iniciada',
  EXECUCAO_FINALIZADA: 'execucao.evento.execucao-finalizada',
  EXECUCAO_FALHOU: 'execucao.evento.execucao-falhou',
  CANCELADA: 'execucao.evento.cancelada',
} as const;

export type TipoComando = (typeof COMANDOS)[keyof typeof COMANDOS];
export type TipoEvento = (typeof EVENTOS)[keyof typeof EVENTOS];

export interface Mensagem<T = Record<string, unknown>> {
  id: string;
  tipo: string;
  versao: 1;
  sagaId: string;
  ordemId: string;
  causadaPor: string | null;
  origem: string;
  ocorridaEm: string;
  dados: T;
}

export interface MensagemSaida {
  mensagem: Mensagem;
  cabecalhos: Record<string, string>;
}

export class MensagemInvalidaError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'MensagemInvalidaError';
  }
}
