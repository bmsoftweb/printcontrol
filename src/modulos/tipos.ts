import type React from 'react';
import type { EmpresaSessao, RegistroCrud, ResourceDef, Usuario } from '../types';

/** O que toda tela de módulo recebe do App */
export interface TelaProps {
  usuario: Usuario;
  empresa: EmpresaSessao;
  /** Metadados de todos os recursos (GET /api/meta/resources) */
  resources: ResourceDef[];
  onToast: (msg: string) => void;
  /** Muda quando o usuário clica em Atualizar no topo */
  refreshToken: number;
  /** Muda quando o usuário clica em "Novo" no topo (só telas com `recurso` mostram o botão) */
  createToken: number;
  /** Vai para outra opção do menu */
  onNavigate: (tela: string) => void;
  onCountChange: (recurso: string, total: number) => void;
}

/** Ganchos da lista genérica (CrudView) para uma tela baseada num recurso */
export interface GanchosCrud {
  acoesLista?: (recarregar: () => void) => React.ReactNode;
  acoesLinha?: (row: RegistroCrud, ctx: { abrir: (row: RegistroCrud) => void; recarregar: () => void }) => React.ReactNode;
  acoesEmMenu?: boolean;
  renderEditor?: (record: RegistroCrud | null, fechar: () => void, aoGravar: () => void) => React.ReactNode | null;
  colunaInicial?: { titulo: string; render: (row: RegistroCrud, ctx: { recarregar: () => void }) => React.ReactNode };
  aoDuploClique?: (row: RegistroCrud) => boolean;
  acoesDetalhe?: (recurso: string, row: RegistroCrud, ctx: { recarregar: () => void }) => React.ReactNode;
}

/**
 * Uma opção do menu (src/utils/menu.ts) e o que ela abre:
 *  - `recurso`: a lista genérica (CrudView) do recurso de server/recursos, com os `ganchos`;
 *  - `componente`: uma tela própria (abas, mestre-detalhe, processos).
 */
export interface Tela {
  recurso?: string;
  ganchos?: (p: TelaProps) => GanchosCrud;
  componente?: React.FC<TelaProps>;
  /** Título e subtítulo no topo (padrão: rótulo e descrição do item do menu) */
  titulo?: [string, string];
}
