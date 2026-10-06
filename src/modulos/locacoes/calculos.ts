/**
 * Cálculos da tela Locações (ufrmContratos.pas do PrintControl Delphi), em funções puras:
 * usados pelo servidor (server/locacoes.ts) e testados em tests/locacoes.test.ts.
 *
 * Dinheiro em inteiros (centavos; preço unitário em 1e-5), sem erro de ponto flutuante.
 */

type Num = number | string | null | undefined;

const n = (v: Num) => Number(v ?? 0) || 0;
/** Valor com 2 casas → centavos */
export const centavos = (v: Num) => Math.round(n(v) * 100);
/** Preço unitário com 5 casas → unidades de 0,00001 */
const e5 = (v: Num) => Math.round(n(v) * 1e5);
const reais = (c: number) => c / 100;

/** Trunca(qtd × unitário, 2) do Delphi: corta (não arredonda) nos centavos. Negativos cortam em direção a zero */
export function trunca(qtd: number, unit: Num): number {
  return reais(Number((BigInt(Math.trunc(qtd)) * BigInt(e5(unit))) / 1000n));
}

/** Arredonda(qtd × unitário, 2) do Delphi (RoundTo -2: meio para o par) */
export function arredonda(qtd: number, unit: Num): number {
  const p = BigInt(Math.trunc(qtd)) * BigInt(e5(unit));
  let q = p / 1000n;
  const r = p % 1000n;
  const sinal = p < 0n ? -1n : 1n;
  const dobro = (r < 0n ? -r : r) * 2n;
  if (dobro > 1000n || (dobro === 1000n && q % 2n !== 0n)) q += sinal;
  return reais(Number(q));
}

const soma = (...v: Num[]) => reais(v.reduce<number>((t, x) => t + centavos(x), 0));

// ---------------------------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------------------------

export interface ContratoValores {
  nr_copias: Num;
  valor_contrato: Num;
  valor_copia: Num;
  valor_excedente: Num;
  dia_leitura: Num;
  dia_vencimento: Num;
  serie_nf: string | null | undefined;
}

/** Validações do qrContratosBeforePost, na mesma ordem e com as mesmas mensagens. null = ok */
export function validarContrato(c: ContratoValores): string | null {
  const copias = n(c.nr_copias);
  const valor = n(c.valor_contrato);
  if (copias < 0) return 'Número de cópias inválido!';
  if (valor < 0) return 'Valor do contrato inválido!';
  if (copias > 0 && valor <= 0) return 'Digite o valor do contrato! (nr. cópias > 0)';
  if (copias <= 0 && valor <= 0 && n(c.valor_copia) <= 0) return 'Escolha um valor de contrato ou valor de cópia!';
  if (n(c.dia_leitura) <= 0 || n(c.dia_leitura) > 31) return 'Digite o dia da leitura!';
  if (n(c.dia_vencimento) <= 0 || n(c.dia_vencimento) > 31) return 'Digite o dia de vencimento!';
  if (!String(c.serie_nf ?? '').trim()) return 'Digite uma série para a nota fiscal!';
  return null;
}

/**
 * Franquia: valor_copia = valor_contrato / nr_copias (5 casas, arredondado como o MySQL grava);
 * excedente sem valor = valor da cópia.
 */
export function derivarValoresContrato(c: ContratoValores): { valor_copia: string; valor_excedente: string } {
  let copia = e5(c.valor_copia);
  if (n(c.valor_contrato) > 0 && n(c.nr_copias) > 0) copia = Math.round((centavos(c.valor_contrato) * 1000) / n(c.nr_copias));
  const exced = e5(c.valor_excedente) <= 0 ? copia : e5(c.valor_excedente);
  return { valor_copia: (copia / 1e5).toFixed(5), valor_excedente: (exced / 1e5).toFixed(5) };
}

// ---------------------------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------------------------

/** Data local aaaa-mm-dd com o dia limitado ao último do mês (o Delphi dava erro com dia 31 em mês de 30) */
function dataNoMes(ano: number, mes: number, dia: number): string {
  const d = new Date(Date.UTC(ano, mes - 1, 1));
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(Math.max(dia, 1), ultimo)).padStart(2, '0')}`;
}

/** Vencimento da leitura nova: dia_vencimento deste mês se hoje ainda não passou dele, senão do mês seguinte */
export function vencimentoLeitura(hoje: string, diaVencimento: number): string {
  const [a, m, d] = hoje.split('-').map(Number);
  return d > diaVencimento ? dataNoMes(a, m + 1, diaVencimento) : dataNoMes(a, m, diaVencimento);
}

/** Conferência: vencimento esperado do contrato no mês (mês seguinte quando a leitura é depois do vencimento) */
export function vencimentoEsperado(ano: number, mes: number, diaLeitura: number, diaVencimento: number): string | null {
  if (!(diaVencimento > 0)) return null;
  return dataNoMes(ano, mes + (diaLeitura > diaVencimento ? 1 : 0), diaVencimento);
}

export interface LeituraCalc {
  leitura_anterior: Num;
  leitura_atual: Num;
  nr_copiar_total_anterior: Num;
  nr_copias_total: Num;
  nr_copias_contrato: Num;
  nr_copias_excedente: Num;
  valor_copia_unit: Num;
  valor_copia_unit_excedente: Num;
  valor_total_geral: Num;
}

export interface LeituraCalculada {
  nr_copias_mes: number;
  nr_copias_total: number;
  nr_copias_excedente: number;
  valor_copia_total: number;
  valor_copia_total_excedente: number;
  valor_total_geral: number;
}

/**
 * Regra central ao gravar a leitura (qrLeiturasBeforePost).
 * `valorContrato` = valor_contrato do contrato (atual, não o da leitura); `alterouAtual` = leitura_atual mudou (inclusão conta).
 * Sem estouro da franquia o excedente fica como está: permite a correção manual de cópias excedentes.
 */
export function calcularLeitura(l: LeituraCalc, valorContrato: Num, alterouAtual: boolean): LeituraCalculada {
  const mes = n(l.leitura_atual) - n(l.leitura_anterior);
  const total = n(l.nr_copias_total) === 0 || alterouAtual ? n(l.nr_copiar_total_anterior) + mes : n(l.nr_copias_total);
  const franquia = n(l.nr_copias_contrato);
  let excedente = n(l.nr_copias_excedente);
  let valorCopias: number;
  if (franquia > 0) {
    valorCopias = reais(centavos(valorContrato));
    if (mes > franquia) excedente = mes - franquia;
  } else {
    valorCopias = trunca(mes, l.valor_copia_unit);
  }
  const valorExcedente = trunca(excedente, l.valor_copia_unit_excedente);
  const geral = n(l.valor_total_geral) <= 0 || alterouAtual ? soma(valorCopias, valorExcedente) : n(l.valor_total_geral);
  return {
    nr_copias_mes: mes,
    nr_copias_total: total,
    nr_copias_excedente: excedente,
    valor_copia_total: valorCopias,
    valor_copia_total_excedente: valorExcedente,
    valor_total_geral: geral,
  };
}

export interface ContratoSnapshot {
  id_cliente: Num;
  nr_serie: string | null;
  nr_copias: Num;
  valor_contrato: Num;
  valor_copia: Num;
  valor_excedente: Num;
  codigo_grupo: string | null;
}

/** "Recalcular": recopia os preços do contrato e refaz tudo do zero, desfazendo o acerto de grupo */
export function recalcularLeitura(l: Pick<LeituraCalc, 'leitura_anterior' | 'leitura_atual' | 'nr_copiar_total_anterior'>, c: ContratoSnapshot) {
  const calc = calcularLeitura(
    {
      ...l,
      nr_copias_total: 0,
      nr_copias_contrato: c.nr_copias,
      nr_copias_excedente: 0,
      valor_copia_unit: c.valor_copia,
      valor_copia_unit_excedente: c.valor_excedente,
      valor_total_geral: 0,
    },
    c.valor_contrato,
    true,
  );
  return {
    id_cliente: c.id_cliente,
    nr_serie: c.nr_serie,
    nr_copias_contrato: n(c.nr_copias),
    valor_contrato: c.valor_contrato,
    valor_copia_unit: c.valor_copia,
    valor_copia_unit_excedente: c.valor_excedente,
    codigo_grupo: c.codigo_grupo,
    nr_copias_excedente_original: 0,
    valor_copia_total_excedente_original: 0,
    grupo_acertado: 'N',
    ...calc,
  };
}

// ---------------------------------------------------------------------------------------------
// Agrupamento: "Acertar Valores"
// ---------------------------------------------------------------------------------------------

export interface LeituraGrupo {
  id: number;
  grupo_acertado: string | null;
  nr_copias_mes: Num;
  nr_copias_contrato: Num;
  nr_copias_excedente: Num;
  valor_copia_total: Num;
  valor_copia_total_excedente: Num;
  valor_copia_unit_excedente: Num;
  valor_total_geral: Num;
  valor_contrato: Num;
}

export type AlteracaoGrupo = { id: number } & Record<string, string | number>;

/** Totalização do grupo (linha de baixo do diálogo) */
export function totalizarGrupo(ls: LeituraGrupo[]) {
  return {
    nr_copias_mes: ls.reduce((t, l) => t + n(l.nr_copias_mes), 0),
    nr_copias_contrato: ls.reduce((t, l) => t + n(l.nr_copias_contrato), 0),
    valor_total_geral: soma(...ls.map((l) => l.valor_total_geral)),
    valor_contrato: soma(...ls.map((l) => l.valor_contrato)),
  };
}

/**
 * Franquia compartilhada (soma das franquias > 0): zera o excedente individual (guardando o original) e, se o grupo
 * estourou, lança o excedente do grupo na leitura que mais passou da própria franquia (arredondado, como no Delphi).
 * Sem franquia: valor mínimo — se a soma dos valores de contrato cobre o total, cada leitura passa a valer o seu valor de contrato.
 */
export function acertarGrupo(ls: LeituraGrupo[]): { erro?: string; alteracoes: AlteracaoGrupo[] } {
  const t = totalizarGrupo(ls);
  if (t.nr_copias_contrato > 0) {
    if (ls.some((l) => l.grupo_acertado === 'S')) return { erro: 'Já existe uma leitura acertada!', alteracoes: [] };
    const alteracoes: AlteracaoGrupo[] = ls.map((l) => ({
      id: l.id,
      valor_total_geral: n(l.valor_copia_total),
      valor_copia_total_excedente_original: n(l.valor_copia_total_excedente),
      nr_copias_excedente_original: n(l.nr_copias_excedente),
      valor_copia_total_excedente: 0,
      nr_copias_excedente: 0,
      grupo_acertado: 'S',
    }));
    const excedeu = t.nr_copias_mes - t.nr_copias_contrato;
    if (excedeu > 0 && ls.length) {
      // A de maior diferença (a primeira no empate), mesmo que nenhuma tenha passado da própria franquia
      let escolhida = 0;
      ls.forEach((l, i) => {
        const dif = (x: LeituraGrupo) => n(x.nr_copias_mes) - n(x.nr_copias_contrato);
        if (dif(l) > dif(ls[escolhida])) escolhida = i;
      });
      const l = ls[escolhida];
      const valor = arredonda(excedeu, l.valor_copia_unit_excedente);
      Object.assign(alteracoes[escolhida], {
        nr_copias_excedente: excedeu,
        valor_copia_total_excedente: valor,
        valor_total_geral: soma(l.valor_copia_total, valor),
      });
    }
    return { alteracoes };
  }
  if (t.valor_contrato >= t.valor_total_geral) {
    return { alteracoes: ls.map((l) => ({ id: l.id, valor_total_geral: n(l.valor_contrato), grupo_acertado: 'S' })) };
  }
  return { alteracoes: [] };
}

// ---------------------------------------------------------------------------------------------
// Pré-leituras → leituras
// ---------------------------------------------------------------------------------------------

/**
 * Contadores a lançar de uma linha de pré-leitura: um por contrato existente do equipamento
 * (o Delphi lançava só o colorido quando havia os dois contratos).
 */
export function contadoresALancar(
  item: { leitura_pb: Num; leitura_pb_anterior: Num; leitura_color: Num; leitura_color_anterior: Num },
  cores: string[],
): { color: 'N' | 'S'; anterior: number; atual: number }[] {
  const r: { color: 'N' | 'S'; anterior: number; atual: number }[] = [];
  if (cores.includes('N')) r.push({ color: 'N', anterior: n(item.leitura_pb_anterior), atual: n(item.leitura_pb) });
  if (cores.includes('S') && n(item.leitura_color) > 0) r.push({ color: 'S', anterior: n(item.leitura_color_anterior), atual: n(item.leitura_color) });
  return r;
}
