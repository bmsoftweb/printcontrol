import type { Tela } from './tipos';
import { TelaOS } from './os/TelaOS';
import { TelaRequisicoes } from './os/TelaRequisicoes';
import { TelaConsultas } from './os/TelaConsultas';

/** Telas do módulo os (ids das opções do menu em src/utils/menu.ts) */
export const TELAS_OS: Record<string, Tela> = {
  os: { componente: TelaOS },
  requisicoes: { componente: TelaRequisicoes },
  consultas: { componente: TelaConsultas },
};
