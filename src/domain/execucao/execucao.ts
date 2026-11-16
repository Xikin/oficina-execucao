export type StatusExecucao =
  | 'NA_FILA'
  | 'EM_DIAGNOSTICO'
  | 'DIAGNOSTICADA'
  | 'AGUARDANDO_REPARO'
  | 'EM_REPARO'
  | 'FINALIZADA'
  | 'FALHOU'
  | 'CANCELADA';

export const STATUS_EXECUCAO: readonly StatusExecucao[] = [
  'NA_FILA',
  'EM_DIAGNOSTICO',
  'DIAGNOSTICADA',
  'AGUARDANDO_REPARO',
  'EM_REPARO',
  'FINALIZADA',
  'FALHOU',
  'CANCELADA',
];

export const STATUS_ENCERRADOS: readonly StatusExecucao[] = ['FINALIZADA', 'FALHOU', 'CANCELADA'];

export type AcaoExecucao =
  | 'iniciarDiagnostico'
  | 'concluirDiagnostico'
  | 'liberar'
  | 'iniciarReparo'
  | 'finalizar'
  | 'falhar'
  | 'cancelar';

const TRANSICOES: Record<AcaoExecucao, { de: readonly StatusExecucao[]; para: StatusExecucao }> = {
  iniciarDiagnostico: { de: ['NA_FILA'], para: 'EM_DIAGNOSTICO' },
  concluirDiagnostico: { de: ['EM_DIAGNOSTICO'], para: 'DIAGNOSTICADA' },
  liberar: { de: ['DIAGNOSTICADA'], para: 'AGUARDANDO_REPARO' },
  iniciarReparo: { de: ['AGUARDANDO_REPARO'], para: 'EM_REPARO' },
  finalizar: { de: ['EM_REPARO'], para: 'FINALIZADA' },
  falhar: { de: ['AGUARDANDO_REPARO', 'EM_REPARO'], para: 'FALHOU' },
  cancelar: {
    de: ['NA_FILA', 'EM_DIAGNOSTICO', 'DIAGNOSTICADA', 'AGUARDANDO_REPARO', 'EM_REPARO'],
    para: 'CANCELADA',
  },
};

export const STATUS_LABEL: Record<StatusExecucao, string> = {
  NA_FILA: 'Na fila',
  EM_DIAGNOSTICO: 'Em diagnóstico',
  DIAGNOSTICADA: 'Diagnosticada, aguardando aprovação e pagamento',
  AGUARDANDO_REPARO: 'Aguardando reparo',
  EM_REPARO: 'Em reparo',
  FINALIZADA: 'Finalizada',
  FALHOU: 'Falhou',
  CANCELADA: 'Cancelada',
};

export class TransicaoInvalidaError extends Error {
  constructor(
    public readonly acao: AcaoExecucao,
    public readonly statusAtual: StatusExecucao,
  ) {
    super(
      `Não é possível ${DESCRICAO_DA_ACAO[acao]} com a execução "${STATUS_LABEL[statusAtual]}"`,
    );
    this.name = 'TransicaoInvalidaError';
  }
}

const DESCRICAO_DA_ACAO: Record<AcaoExecucao, string> = {
  iniciarDiagnostico: 'iniciar o diagnóstico',
  concluirDiagnostico: 'concluir o diagnóstico',
  liberar: 'liberar para reparo',
  iniciarReparo: 'iniciar o reparo',
  finalizar: 'finalizar o reparo',
  falhar: 'registrar falha',
  cancelar: 'cancelar',
};

export function proximoStatus(acao: AcaoExecucao, atual: StatusExecucao): StatusExecucao {
  const regra = TRANSICOES[acao];
  if (!regra.de.includes(atual)) throw new TransicaoInvalidaError(acao, atual);
  return regra.para;
}

export function permite(acao: AcaoExecucao, atual: StatusExecucao): boolean {
  return TRANSICOES[acao].de.includes(atual);
}

export function marcosDoStatus(status: StatusExecucao, agora = new Date()): Record<string, Date> {
  switch (status) {
    case 'EM_DIAGNOSTICO':
      return { diagnosticoIniciadoEm: agora };
    case 'DIAGNOSTICADA':
      return { diagnosticadaEm: agora };
    case 'AGUARDANDO_REPARO':
      return { liberadaEm: agora };
    case 'EM_REPARO':
      return { reparoIniciadoEm: agora };
    case 'FINALIZADA':
      return { finalizadaEm: agora };
    case 'FALHOU':
    case 'CANCELADA':
      return { encerradaEm: agora };
    default:
      return {};
  }
}

export function dividirTempo(totalMin: number, quantidadeDeServicos: number): number | null {
  if (quantidadeDeServicos <= 0) return null;
  return Math.max(1, Math.round(totalMin / quantidadeDeServicos));
}
