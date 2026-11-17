import type { StatusExecucao } from '../execucao/execucao';
import type { MensagemSaida } from '../mensageria/mensagem';

export interface ItemServicoRecord {
  id: string;
  servicoId: string;
  nome: string;
  preco: number;
  tempoReal: number | null;
}

export interface ReservaRecord {
  id: string;
  pecaId: string;
  nome: string;
  quantidade: number;
  precoUnitario: number;
  status: 'RESERVADA' | 'CONSUMIDA' | 'LIBERADA';
}

export interface HistoricoExecucaoRecord {
  id: string;
  statusAnterior: StatusExecucao | null;
  statusNovo: StatusExecucao;
  observacao: string | null;
  criadoEm: Date;
}

export interface ExecucaoRecord {
  id: string;
  ordemId: string;
  sagaId: string;
  numeroOS: number;
  status: StatusExecucao;
  descricao: string | null;
  veiculoPlaca: string | null;
  veiculoMarca: string | null;
  veiculoModelo: string | null;
  veiculoAno: number | null;
  observacaoDiagnostico: string | null;
  motivoEncerramento: string | null;
  tempoRealMin: number | null;
  diagnosticoIniciadoEm: Date | null;
  diagnosticadaEm: Date | null;
  liberadaEm: Date | null;
  reparoIniciadoEm: Date | null;
  finalizadaEm: Date | null;
  encerradaEm: Date | null;
  criadoEm: Date;
  atualizadoEm: Date;
  servicos: ItemServicoRecord[];
  reservas: ReservaRecord[];
  historico: HistoricoExecucaoRecord[];
}

export interface NovaExecucao {
  ordemId: string;
  sagaId: string;
  numeroOS: number;
  status: Extract<StatusExecucao, 'NA_FILA' | 'CANCELADA'>;
  descricao: string | null;
  veiculo: { placa: string; marca: string; modelo: string; ano: number } | null;
  motivoEncerramento: string | null;
  observacao: string;
}

export interface TransicaoExecucao {
  execucaoId: string;
  statusEsperado: StatusExecucao;
  novoStatus: StatusExecucao;
  observacao: string;
  observacaoDiagnostico?: string;
  motivoEncerramento?: string;
  tempoRealMin?: number;
  tempoPorServico?: number | null;
  servicos?: { servicoId: string; nome: string; preco: number }[];
  reservar?: { pecaId: string; nome: string; quantidade: number; precoUnitario: number }[];
  consumirReservas?: boolean;
  liberarReservas?: boolean;
  saidas: MensagemSaida[];
  mensagemProcessada: { id: string; consumidor: string } | null;
}

export interface ListarExecucoesParams {
  page: number;
  limit: number;
  status?: StatusExecucao;
}

export class ExecucaoAlteradaError extends Error {
  constructor(execucaoId: string) {
    super(`A execução ${execucaoId} foi alterada por outro processo; tente de novo`);
    this.name = 'ExecucaoAlteradaError';
  }
}

export class EstoqueInsuficienteError extends Error {
  constructor(public readonly nomePeca: string) {
    super(`Estoque insuficiente para "${nomePeca}"`);
    this.name = 'EstoqueInsuficienteError';
  }
}

export interface IExecucaoRepository {
  buscarPorId(id: string): Promise<ExecucaoRecord | null>;
  buscarPorOrdem(ordemId: string): Promise<ExecucaoRecord | null>;
  listar(params: ListarExecucoesParams): Promise<{ data: ExecucaoRecord[]; total: number }>;
  criar(
    nova: NovaExecucao,
    saidas: (execucao: ExecucaoRecord) => MensagemSaida[],
    mensagemProcessada: { id: string; consumidor: string } | null,
  ): Promise<ExecucaoRecord>;
  transicionar(transicao: TransicaoExecucao): Promise<ExecucaoRecord>;
  jaProcessada(mensagemId: string, consumidor: string): Promise<boolean>;
  registrarProcessada(mensagemId: string, consumidor: string): Promise<void>;
}
