/** Linha da lista de clientes (GET /api/clientes/lista) ou registro de pessoas */
export type Cliente = Record<string, any>;

/** Combos e dados da empresa ativa (GET /api/clientes/opcoes) */
export interface OpcoesClientes {
  bancos: { id: number; apelido: string; nome: string }[];
  planos: { id: string; descricao: string }[];
  regioes: { id: string; descricao: string }[];
  empresa: { latitude: number | null; longitude: number | null } | null;
}

/** Filtros da lista (linha de filtro da grade do Delphi) */
export interface FiltroClientes {
  id: string;
  nome: string;
  cpf: string;
  regiao: string;
}

export const consultaFiltro = (f: FiltroClientes) => new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
