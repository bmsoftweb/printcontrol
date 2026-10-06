import type { Tela } from './tipos';
import { TelaFaturamento } from './faturamento/Faturamento';
import { TelaReceber } from './faturamento/Receber';

export { BoletosAreceber } from './faturamento/BoletosAreceber';

/** Telas do módulo faturamento (ids das opções do menu em src/utils/menu.ts) */
export const TELAS_FATURAMENTO: Record<string, Tela> = {
  faturamento: { componente: TelaFaturamento, titulo: ['Faturamentos', 'Pré-faturamento das leituras, notas de débito, boletos e remessa'] },
  financeiro: { componente: TelaReceber, titulo: ['Contas a Receber', 'Títulos das notas de débito: baixas, exportação e retorno bancário'] },
};
