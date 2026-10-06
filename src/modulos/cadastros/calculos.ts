/**
 * Regras puras das telas Equipamentos/Produtos/Tabelas/Estoque (usadas pelo servidor e cobertas por tests/cadastros.test.ts).
 */

/**
 * Número da etiqueta VOID a partir do formato (Tabelas › Etiq. VOID do Delphi):
 * `[N]`…`[NNNNNNNNN]` = número com zeros à esquerda no tamanho do token (se passar, ficam os dígitos da direita),
 * `[MM]` = mês atual, `[AAAA]` = ano atual. O resto do texto vai como está.
 */
export function formatarEtiquetaVoid(formato: string, numero: number, data: { mes: number; ano: number }): string {
  return formato
    .replace(/\[(N{1,9})\]/g, (_, ns: string) => String(numero).padStart(ns.length, '0').slice(-ns.length))
    .replace(/\[MM\]/g, String(data.mes).padStart(2, '0'))
    .replace(/\[AAAA\]/g, String(data.ano));
}

export interface MovKardex {
  id: number;
  ES: string;
  qtdade_mov: number;
  valor_total_mov: number;
}

export interface SaldoKardex {
  id: number;
  qtdade_saldo: number;
  valor_unit_mov: number;
  valor_total_mov: number;
  valor_custo_medio_unit: number;
  valor_total_estoque: number;
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const r5 = (v: number) => Math.round(v * 1e5) / 1e5;

/**
 * "RECALCULAR SALDOS" do ufrmEstoque: custo médio móvel dos movimentos de um produto, na ordem recebida.
 * Entrada soma quantidade e valor e refaz o custo médio; saída baixa pelo custo médio do momento.
 */
export function recalcularKardex(movs: MovKardex[]): SaldoKardex[] {
  let saldo = 0;
  let vt = 0;
  let cm = 0;
  return movs.map((m) => {
    const qtd = Number(m.qtdade_mov) || 0;
    let total = Number(m.valor_total_mov) || 0;
    let unit: number;
    if (m.ES === 'S') {
      saldo = r5(saldo - qtd);
      total = r2(cm * qtd);
      vt = r2(vt - total);
      unit = cm; // o Delphi zerava o unitário da saída; aqui fica o custo médio usado na baixa
    } else {
      saldo = r5(saldo + qtd);
      vt = r2(vt + total);
      cm = saldo > 0 ? r2(vt / saldo) : 0; // Delphi: divisão por zero com saldo 0
      unit = qtd > 0 ? r2(total / qtd) : 0;
    }
    return { id: m.id, qtdade_saldo: saldo, valor_unit_mov: unit, valor_total_mov: total, valor_custo_medio_unit: cm, valor_total_estoque: vt };
  });
}
