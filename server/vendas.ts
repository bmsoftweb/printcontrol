import { Router, Request, Response } from 'express';
import type { PoolConnection } from 'mysql2/promise';
import crypto from 'crypto';
import { pool, comUsuario, gravarLog, type Contexto } from './db.js';
import { contexto } from './crud.js';
import { gerarPdf } from './pdf.js';
import { recusar } from './regras.js';
import { arred, colunasImposto, escolherFormula, executarScript, variaveisIniciais, variaveisParaTexto, variavelTexto, type FormulaImposto } from './formulas.js';
import { crtDaEmpresa } from './nfe/contexto.js';
import { rotasNFe } from './nfe/rotas.js';

/**
 * Tela Vendas (ufrmVendas e satélites: Devol, CapPedido, EditObs) — regras de negócio no servidor.
 * Todo movimento é da empresa ativa (o Delphi listava as vendas de todas as empresas do grupo e abria
 * os cadastros sem filtro de grupo: corrigido). Gravações sempre em transação (comUsuario).
 */

// ============================================================================ utilitários puros

export const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const txt = (v: unknown) => String(v ?? '').trim();
export const r2 = (v: number) => arred(v, 2);

/** DividirMoeda do Delphi: total/n arredondado em `casas` (0 quando n = 0) */
export const dividirMoeda = (total: number, partes: number, casas = 2) => (partes > 0 ? arred(total / partes, casas) : 0);

/** Hoje em Brasília (aaaa-mm-dd) */
export const hojeISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/** getHash do Delphi: 9 dígitos aleatórios */
export const getHash = () => String(crypto.randomInt(0, 1_000_000_000)).padStart(9, '0');

/**
 * getNumeroVale: 9 dígitos aleatórios + DV de 3 dígitos. x = int(dígitos 3, 6 e 9); enquanto x < 103, x *= 4;
 * DV = x − 103. Com x = 0 o Delphi entrava em laço infinito: aqui x = 0 vira 1.
 */
export function getNumeroVale(h = String(crypto.randomInt(0, 1_000_000_000)).padStart(9, '0')): string {
  let x = Number(h[2] + h[5] + h[8]) || 1;
  while (x < 103) x *= 4;
  return h + String(x - 103).padStart(3, '0').slice(-3);
}

/** Soma dias/semanas/mês ao vencimento conforme o intervalo da condição (7, 15, 21 = semanas; 30 = mês) */
export function avancarIntervalo(iso: string, intervalo: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (intervalo === 30) {
    const dia = dt.getUTCDate();
    dt.setUTCDate(1);
    dt.setUTCMonth(dt.getUTCMonth() + 1);
    // IncMonth: dia 31 em mês de 30 vira o último dia
    const ultimo = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    dt.setUTCDate(Math.min(dia, ultimo));
  } else {
    const dias = intervalo === 7 ? 7 : intervalo === 15 ? 14 : intervalo === 21 ? 21 : intervalo;
    dt.setUTCDate(dt.getUTCDate() + dias);
  }
  return dt.toISOString().slice(0, 10);
}

export interface Condicao {
  id: number;
  apelido: string;
  nr_parcelas: number;
  entrada: string;
  intervalo: number;
  juros_mes: number;
  id_banco: number;
}

export interface Parcela {
  nr: number;
  vencimento: string;
  valor: number;
  id_banco: number;
  banco: string;
  /** A = automática, D = digitada pelo usuário */
  status: 'A' | 'D';
}

/** Casas das parcelas: inteiras quando há entrada e mais de uma parcela (como o Delphi) */
const casasParcela = (c: Condicao) => (n(c.nr_parcelas) > 1 && c.entrada === 'S' ? 0 : 2);

/** §7.1 — parcelas ao Finalizar: 1º vencimento hoje (ou hoje + intervalo sem entrada); a 1ª acerta a diferença */
export function gerarParcelas(total: number, c: Condicao, hoje: string, banco: string): Parcela[] {
  const qtd = n(c.nr_parcelas);
  const valor = dividirMoeda(total, qtd, casasParcela(c));
  let venc = c.entrada === 'N' ? avancarIntervalo(hoje, n(c.intervalo)) : hoje;
  const parcelas: Parcela[] = [];
  for (let i = 1; i <= qtd; i++) {
    parcelas.push({ nr: i, vencimento: venc, valor, id_banco: n(c.id_banco), banco, status: 'A' });
    venc = avancarIntervalo(venc, n(c.intervalo));
  }
  if (qtd > 1) parcelas[0].valor = r2(total - parcelas.slice(1).reduce((s, p) => s + p.valor, 0));
  return parcelas;
}

/**
 * §7.2 — "Gerar Parcelas": as digitadas (D) ficam; as automáticas dividem o resto. Sem digitadas, a 1ª
 * acerta a diferença; com digitadas, a última (o Delphi somava a parcela errada no acerto da 1ª).
 */
export function refazerParcelas(parcelas: Parcela[], total: number, c: Condicao, banco: string): Parcela[] {
  const digitadas = parcelas.filter((p) => p.status === 'D');
  const t = r2(digitadas.reduce((s, p) => s + n(p.valor), 0));
  const livres = parcelas.length - digitadas.length;
  const v = t === 0 ? dividirMoeda(total, livres, casasParcela(c)) : dividirMoeda(total - t, livres);
  const r = parcelas.map((p) => (p.status === 'A' ? { ...p, valor: v, id_banco: n(c.id_banco), banco } : { ...p, valor: n(p.valor) }));
  if (r.length > 1) {
    const alvo = t === 0 ? 0 : r.length - 1;
    const outros = r.reduce((s, p, i) => (i === alvo ? s : s + p.valor), 0);
    r[alvo] = { ...r[alvo], valor: r2(total - outros) };
  } else if (r.length === 1) r[0] = { ...r[0], valor: r2(total) };
  return r;
}

export interface ItemTotais {
  id: number;
  valor_total_bruto: number;
  valor_desconto: number;
  valor_acrescimo: number;
  valor_total_liquido: number;
}

/**
 * §4 Totalizar: soma dos itens, plano (juros/desconto da condição), digitados (% recalculados sobre a base)
 * e rateio por item. Cada rateio é arredondado em 2 casas e a diferença de centavos vai para o último
 * item, para Σ itens = total da venda (exigência da NF-e; no Delphi o acerto estava comentado).
 */
export function totalizarVenda(venda: { valor_desconto_digitado: number; valor_acrescimo_digitado: number; valor_total_liquido_servicos?: number }, itens: ItemTotais[], juros: number) {
  const bruto = r2(itens.reduce((s, i) => s + n(i.valor_total_bruto), 0));
  const descItens = r2(itens.reduce((s, i) => s + n(i.valor_desconto), 0));
  const acrItens = r2(itens.reduce((s, i) => s + n(i.valor_acrescimo), 0));
  const base = r2(itens.reduce((s, i) => s + n(i.valor_total_liquido), 0));
  const j = n(juros);
  const percAcrPlano = j > 0 ? j : 0;
  const percDescPlano = j < 0 ? Math.abs(j) : 0;
  const valorAcrPlano = r2((percAcrPlano / 100) * base);
  const valorDescPlano = r2((percDescPlano / 100) * base);
  const descDig = r2(n(venda.valor_desconto_digitado));
  const acrDig = r2(n(venda.valor_acrescimo_digitado));
  const pct = (v: number) => (base ? r2((v * 100) / base) : 0);
  const descTotal = r2(descItens + valorDescPlano + descDig);
  const acrTotal = r2(acrItens + valorAcrPlano + acrDig);
  const liqProdutos = r2(bruto + acrTotal - descTotal);
  const servicos = n(venda.valor_total_liquido_servicos);

  const ratear = (valor: number) => {
    const partes = itens.map((i) => (base ? r2((n(i.valor_total_liquido) * valor) / base) : 0));
    if (partes.length) partes[partes.length - 1] = r2(partes[partes.length - 1] + valor - partes.reduce((s, x) => s + x, 0));
    return partes;
  };
  const rDescPlano = ratear(valorDescPlano);
  const rDescDig = ratear(descDig);
  const rAcrPlano = ratear(valorAcrPlano);
  const rAcrDig = ratear(acrDig);

  return {
    venda: {
      valor_total_bruto: bruto,
      valor_total_bruto_produtos: bruto,
      valor_desconto_itens: descItens,
      valor_acrescimo_itens: acrItens,
      valor_total_liquido_antes_desconto_nf: base,
      perc_acrescimo_plano: percAcrPlano,
      valor_acrescimo_plano: valorAcrPlano,
      perc_desconto_plano: percDescPlano,
      valor_desconto_plano: valorDescPlano,
      perc_desconto_digitado: pct(descDig),
      perc_acrescimo_digitado: pct(acrDig),
      valor_desconto_total: descTotal,
      valor_acrescimo_total: acrTotal,
      valor_total_liquido_produtos: liqProdutos,
      valor_total_liquido: r2(liqProdutos + servicos),
    },
    itens: itens.map((i, k) => {
      const desc = r2(n(i.valor_desconto) + rDescPlano[k] + rDescDig[k]);
      const acr = r2(n(i.valor_acrescimo) + rAcrPlano[k] + rAcrDig[k]);
      return {
        id: i.id,
        item: k + 1,
        valor_desconto_rateio_plano: rDescPlano[k],
        valor_desconto_rateio_digitado: rDescDig[k],
        valor_desconto_total: desc,
        valor_acrescimo_rateio_plano: rAcrPlano[k],
        valor_acrescimo_rateio_digitado: rAcrDig[k],
        valor_acrescimo_total: acr,
        valor_total_liquido_final: r2(n(i.valor_total_bruto) + acr - desc),
      };
    }),
  };
}

/** Painel de condições (§2.5): valor da parcela de cada condição sobre o bruto da venda */
export function simularCondicoes(bruto: number, condicoes: Condicao[]) {
  return condicoes.map((c) => {
    const vlr = n(bruto) * (1 + n(c.juros_mes) / 100);
    const qtd = n(c.nr_parcelas);
    return {
      id: c.id,
      apelido: c.apelido,
      perc_juros: n(c.juros_mes),
      nr_vezes: c.entrada === 'S' ? `1+${qtd - 1}` : `${qtd}x`,
      parcela: qtd ? r2(vlr / qtd) : 0,
    };
  });
}

/** Lista "01;02" → ['01','02'] (o Delphi testava substring) */
export const seriesAceitas = (lista: unknown) =>
  txt(lista)
    .split(/[;,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

// ============================================================================ acesso a dados

type Conn = PoolConnection | typeof pool;

const grupoDe = (res: Response) => Number(res.locals.grupoId);
const empresaDe = (res: Response) => Number(res.locals.empresaId);

async function um<T = any>(c: Conn, sql: string, p: unknown[] = []): Promise<T | undefined> {
  const [r] = await c.query<any[]>(sql, p);
  return r[0];
}
async function varios<T = any>(c: Conn, sql: string, p: unknown[] = []): Promise<T[]> {
  const [r] = await c.query<any[]>(sql, p);
  return r;
}

/** Venda da empresa ativa (lança 404). `travar` = SELECT … FOR UPDATE dentro da transação */
async function lerVenda(c: Conn, res: Response, id: number, travar = false) {
  const v = await um(
    c,
    `SELECT A.*, O.codigo operacao_codigo, O.tipo operacao_tipo, O.apelido apelido_operacao, O.descricao operacao_descricao,
            O.cor operacao_cor, O.es operacao_es, O.mov_estoque, O.series_aceitas, E.apelido apelido_plano, E.nr_parcelas,
            S.modelo serie_modelo, S.tipo serie_tipo
       FROM vendas A
       LEFT JOIN vendas_operacoes O ON O.id = A.id_operacao
       LEFT JOIN vendas_condicoes E ON E.id = A.id_condicao
       LEFT JOIN vendas_series S ON S.id = A.id_serie
      WHERE A.id = ? AND A.id_grupo = ? AND A.id_empresa = ?${travar ? ' FOR UPDATE' : ''}`,
    [id, grupoDe(res), empresaDe(res)],
  );
  if (!v) throw recusar('Venda não encontrada.', 404);
  return v;
}

const FINALIZADA = 'A edição já foi finalizada!';
const exigirAberta = (v: any) => {
  if (v.status === 'F') throw recusar(FINALIZADA);
};

async function lerCondicao(c: Conn, res: Response, id: number): Promise<Condicao | undefined> {
  return um<Condicao>(c, 'SELECT * FROM vendas_condicoes WHERE id = ? AND id_grupo = ?', [id, grupoDe(res)]);
}

const SQL_ITENS = `
  SELECT A.*, A.referencia referencia_vendas_produtos, B.referencia, B.cod_barra, B.un_venda, B.tipo_imposto produto_tipo_imposto,
         B.ncm, B.imposto_origem, N.cest, B.descricao descricao_produto
    FROM vendas_produtos A
    LEFT JOIN produtos B ON B.id = A.id_produto
    LEFT JOIN (SELECT ncm, MAX(cest) cest FROM produtos_ncm GROUP BY ncm) N ON N.ncm = B.ncm
   WHERE A.id_venda = ?
   ORDER BY A.item, A.id`;

/** §4 no banco: recalcula a venda e os rateios dos itens (não mexe em venda finalizada) */
export async function totalizar(c: Conn, res: Response, idVenda: number) {
  const v = await lerVenda(c, res, idVenda);
  if (v.status === 'F') return;
  const itens = await varios<ItemTotais>(c, 'SELECT id, valor_total_bruto, valor_desconto, valor_acrescimo, valor_total_liquido FROM vendas_produtos WHERE id_venda = ? ORDER BY item, id', [idVenda]);
  const cond = v.id_condicao ? await lerCondicao(c, res, v.id_condicao) : undefined;
  const t = totalizarVenda(v, itens, n(cond?.juros_mes));
  const cols = Object.keys(t.venda);
  await c.query(`UPDATE vendas SET ${cols.map((k) => `${k} = ?`).join(', ')}, id_usuario_alteracao = ? WHERE id = ?`, [
    ...cols.map((k) => (t.venda as any)[k]),
    res.locals.usuarioId ?? 0,
    idVenda,
  ]);
  for (const i of t.itens) {
    await c.query(
      `UPDATE vendas_produtos SET item = ?, valor_desconto_rateio_plano = ?, valor_desconto_rateio_digitado = ?, valor_desconto_total = ?,
              valor_acrescimo_rateio_plano = ?, valor_acrescimo_rateio_digitado = ?, valor_acrescimo_total = ?, valor_total_liquido_final = ?
        WHERE id = ?`,
      [i.item, i.valor_desconto_rateio_plano, i.valor_desconto_rateio_digitado, i.valor_desconto_total, i.valor_acrescimo_rateio_plano, i.valor_acrescimo_rateio_digitado, i.valor_acrescimo_total, i.valor_total_liquido_final, i.id],
    );
  }
}

/** Estorno na origem (devolução/pedido) ao excluir ou substituir um item: qtdade_devol −= qtd; zerada → faturado N */
async function estornarOrigem(c: Conn, idOrigem: number | null, qtd: number) {
  if (!idOrigem) return;
  await c.query(
    `UPDATE vendas_produtos SET qtdade_devol = GREATEST(COALESCE(qtdade_devol,0) - ?, 0),
            faturado = IF(GREATEST(COALESCE(qtdade_devol,0) - ?, 0) = 0, 'N', faturado)
      WHERE id = ?`,
    [qtd, qtd, idOrigem],
  );
}

// ============================================================================ impostos (§6)

/**
 * §6.3: zera nfe_impostos da venda e calcula cada item pela fórmula escolhida (§6.1), gravando cfop,
 * variáveis e script no item e os campos em nfe_impostos_produtos. `exigir`: item sem fórmula aborta
 * (botão Calcular Impostos e NF-e); fora disso o item fica sem cálculo. Erros de script voltam como aviso.
 */
export async function calcularImpostos(c: Conn, res: Response, idVenda: number, exigir: boolean): Promise<{ avisos: string[]; calculados: number }> {
  const v = await lerVenda(c, res, idVenda);
  const cli = (await um(c, 'SELECT endereco_uf, tipo_imposto FROM pessoas WHERE id = ? AND id_grupo = ?', [v.id_cliente, grupoDe(res)])) || {};
  const emp = (await um(c, 'SELECT cnpj, simples_normal, uf FROM empresas_filiais WHERE id = ?', [empresaDe(res)])) || {};
  const itens = await varios(c, SQL_ITENS, [idVenda]);
  const formulas = await varios<FormulaImposto>(c, 'SELECT * FROM nfe_impostos_formulas ORDER BY id');
  const regime = String(crtDaEmpresa(emp.simples_normal));

  let tot = await um(c, 'SELECT id FROM nfe_impostos WHERE id_venda = ? ORDER BY id LIMIT 1', [idVenda]);
  if (!tot) {
    const [ins] = await c.query<any>('INSERT INTO nfe_impostos (id_venda) VALUES (?)', [idVenda]);
    tot = { id: ins.insertId };
  }
  const soma: Record<string, number> = {
    icms_vBC: 0, icms_vICMS: 0, icms_vBCST: 0, icms_vST: 0, icms_vProd: 0, icms_vFrete: 0, icms_vSeg: 0, icms_vDesc: 0, icms_vII: 0,
    icms_vIPI: 0, icms_vPIS: 0, icms_vCOFINS: 0, icms_vOutro: 0, icms_vNF: 0, icms_vTotTrib: 0, icms_vFCPUFDest: 0, icms_vICMSUFDest: 0, icms_vICMSUFRemet: 0,
  };
  const avisos: string[] = [];
  let calculados = 0;

  for (const it of itens) {
    const f = escolherFormula(formulas, {
      uf: txt(cli.endereco_uf),
      operacao: txt(v.operacao_codigo),
      ncm: txt(it.ncm),
      idProduto: it.id_produto,
      idCliente: v.id_cliente,
      tipoProduto: txt(it.produto_tipo_imposto),
      tipoCliente: txt(cli.tipo_imposto),
    });
    if (!f) {
      if (exigir) throw recusar(`Fórmula para cálculo ICMS do produto não encontrada! (produto ${it.id_produto} - ${txt(it.descricao_produto)})`);
      continue;
    }
    const ini = variaveisIniciais({
      empresa: { cnpj: txt(emp.cnpj).replace(/\D/g, ''), regime, uf: txt(emp.uf) },
      operacao: { id: n(v.id_operacao), es: txt(v.es), codigo: txt(v.operacao_codigo), tipo: txt(v.operacao_tipo), apelido: txt(v.apelido_operacao) },
      // O Delphi passava 'SC' fixo aqui
      cliente: { uf: txt(cli.endereco_uf), tipo: txt(cli.tipo_imposto) },
      produto: {
        id: n(it.id_produto),
        ean: txt(it.cod_barra),
        un: txt(it.un_venda),
        tipo: txt(it.produto_tipo_imposto),
        ncm: txt(it.ncm),
        cest: txt(it.cest),
        origem: txt(it.imposto_origem),
        quantidade: n(it.qtdade),
        valorBruto: n(it.valor_total_bruto),
        acrescimo: n(it.valor_acrescimo),
        desconto: n(it.valor_desconto),
        valorLiquido: n(it.valor_total_liquido),
      },
    });
    const r = executarScript(f.script_calculo ?? '', ini);
    if (r.erro) avisos.push(`Item ${it.item || it.id} (fórmula ${f.id}): ${r.erro}`);
    const cfop = variavelTexto(r.variaveis, 'produto.cfop').slice(0, 4);
    await c.query('UPDATE vendas_produtos SET cfop = ?, calculo_imposto_variaveis = ?, calculo_imposto_formula = ? WHERE id = ?', [
      cfop || null,
      variaveisParaTexto(r.variaveis),
      r.script,
      it.id,
    ]);
    const cols: Record<string, unknown> = { empresa_CRT: regime, cfop: cfop || null, icms_orig: txt(it.imposto_origem).slice(0, 1) || null, ...colunasImposto(r.variaveis) };
    const existe = await um(c, 'SELECT id FROM nfe_impostos_produtos WHERE id_vendas_produtos = ? ORDER BY id LIMIT 1', [it.id]);
    const nomes = Object.keys(cols);
    if (existe) await c.query(`UPDATE nfe_impostos_produtos SET ${nomes.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...nomes.map((k) => cols[k]), existe.id]);
    else await c.query(`INSERT INTO nfe_impostos_produtos (id_vendas_produtos, ${nomes.join(', ')}) VALUES (?, ${nomes.map(() => '?').join(', ')})`, [it.id, ...nomes.map((k) => cols[k])]);

    const x = (k: string) => n(cols[k]);
    soma.icms_vBC += x('icms_vBC');
    soma.icms_vICMS += x('icms_vICMS');
    soma.icms_vBCST += x('icms_vBCST');
    soma.icms_vST += x('icms_vICMSST');
    soma.icms_vProd += n(it.valor_total_bruto);
    soma.icms_vDesc += n(it.valor_desconto_total);
    soma.icms_vII += x('ii_vII');
    soma.icms_vIPI += x('ipi_vIPI');
    soma.icms_vPIS += x('pis_vPIS');
    soma.icms_vCOFINS += x('cofins_vCOFINS');
    soma.icms_vOutro += n(it.valor_acrescimo_total);
    soma.icms_vNF += n(it.valor_total_liquido_final);
    // A partilha somava a si mesma no Delphi (ficava 0)
    soma.icms_vFCPUFDest += x('icms_vFCPUFDest');
    soma.icms_vICMSUFDest += x('icms_vICMSUFDest');
    soma.icms_vICMSUFRemet += x('icms_vICMSUFRemet');
    calculados++;
  }
  const ks = Object.keys(soma);
  await c.query(`UPDATE nfe_impostos SET ${ks.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...ks.map((k) => r2(soma[k])), tot.id]);
  return { avisos, calculados };
}

// ============================================================================ duplicar (§3.8)

const CAMPOS_COPIA_VENDA = [
  'id_cliente', 'id_condicao', 'id_vendedor1', 'id_vendedor2', 'valor_total_bruto_produtos', 'valor_total_bruto_servicos', 'valor_total_bruto',
  'valor_acrescimo_itens', 'valor_desconto_itens', 'valor_total_liquido_antes_desconto_nf', 'perc_desconto_plano', 'valor_desconto_plano',
  'perc_desconto_digitado', 'valor_desconto_digitado', 'valor_desconto_total', 'perc_acrescimo_plano', 'valor_acrescimo_plano',
  'perc_acrescimo_digitado', 'valor_acrescimo_digitado', 'valor_acrescimo_total', 'valor_total_liquido_produtos', 'valor_total_liquido_servicos',
  'valor_frete', 'valor_seguro', 'valor_outros', 'valor_total_liquido', 'obs',
];
const CAMPOS_COPIA_ITEM = [
  'item', 'id_produto', 'id_vendedor1', 'id_vendedor2', 'referencia', 'qtdade', 'preco_lista', 'preco_venda', 'valor_total_bruto', 'perc_acrescimo',
  'valor_acrescimo', 'perc_desconto', 'valor_desconto', 'valor_total_liquido', 'valor_desconto_rateio_plano', 'valor_desconto_rateio_digitado',
  'valor_desconto_total', 'valor_acrescimo_rateio_plano', 'valor_acrescimo_rateio_digitado', 'valor_acrescimo_total', 'valor_total_liquido_final',
];

/** Operação de destino e a 1ª série aceita por ela (o Delphi gravava id_operacao = 1 fixo e série vazia) */
async function operacaoESerie(c: Conn, res: Response, idOperacao: number) {
  const op = await um(c, 'SELECT * FROM vendas_operacoes WHERE id = ? AND id_grupo = ?', [idOperacao, grupoDe(res)]);
  if (!op) throw recusar('Operação inválida!');
  const primeira = seriesAceitas(op.series_aceitas)[0];
  const serie = primeira ? await um(c, 'SELECT id, serie FROM vendas_series WHERE serie = ? AND id_grupo = ?', [primeira, grupoDe(res)]) : undefined;
  return { op, serie };
}

async function duplicarVenda(c: Conn, res: Response, origem: any, idOperacao: number): Promise<number> {
  const { op, serie } = await operacaoESerie(c, res, idOperacao);
  const [ins] = await c.query<any>(
    `INSERT INTO vendas (id_grupo, id_empresa, id_operacao, es, tipo, id_serie, serie, numero, data_venda, status, cancelado, pedido_status,
                         datahora_inclusao, id_usuario_inclusao, id_usuario_alteracao, hash, ${CAMPOS_COPIA_VENDA.join(', ')})
     VALUES (?, ?, ?, ?, ?, ?, ?, '0', CURDATE(), 'A', 'N', 'N', NOW(), ?, ?, ?, ${CAMPOS_COPIA_VENDA.map(() => '?').join(', ')})`,
    [
      grupoDe(res),
      empresaDe(res),
      op.id,
      op.es || 'S',
      op.tipo || 'V',
      serie?.id ?? 0,
      serie?.serie ?? '',
      res.locals.usuarioId ?? 0,
      res.locals.usuarioId ?? 0,
      getHash(),
      ...CAMPOS_COPIA_VENDA.map((k) => origem[k]),
    ],
  );
  const novo = ins.insertId as number;
  await c.query(
    `INSERT INTO vendas_produtos (id_venda, qtdade_devol, faturado, ${CAMPOS_COPIA_ITEM.join(', ')})
     SELECT ?, 0, 'N', ${CAMPOS_COPIA_ITEM.join(', ')} FROM vendas_produtos WHERE id_venda = ? ORDER BY item, id`,
    [novo, origem.id],
  );
  return novo;
}

// ============================================================================ DAV (formato_PE.fr3)

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const moedaBR = (v: unknown) => n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtdBR = (v: unknown) => n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const dataBR = (v: unknown) => (/^\d{4}-\d{2}-\d{2}/.test(txt(v)) ? txt(v).slice(0, 10).split('-').reverse().join('/') : txt(v));

export function htmlDav(v: any, itens: any[], parcelas: any[], empresa: any): string {
  const linhas = itens
    .map(
      (i) => `<tr><td>${esc(i.id_produto)}</td><td>${esc(i.descricao_produto)}</td><td class="d">${qtdBR(i.qtdade)}</td><td class="d">${moedaBR(i.preco_venda)}</td>
        <td class="d">${moedaBR(i.valor_total_liquido)}</td><td class="d">${moedaBR(i.valor_acrescimo_total)}</td><td class="d">${moedaBR(i.valor_desconto_total)}</td></tr>`,
    )
    .join('');
  const soma = itens.reduce((s, i) => s + n(i.valor_total_liquido), 0);
  const parc = parcelas
    .map((p) => `<tr><td class="c">${esc(p.parcelas_nr)} / ${esc(p.parcelas_tot)}</td><td class="c">${dataBR(p.data_vencimento)}</td><td class="d">${moedaBR(p.valor_areceber)}</td></tr>`)
    .join('');
  const numero = txt(v.numero) && txt(v.numero) !== '0' ? txt(v.numero).padStart(9, '0') : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>DAV ${esc(v.serie)}/${numero}</title><style>
    @page { size: A4; margin: 10mm; } body { font-family: Arial, sans-serif; font-size: 11px; color: #000; }
    h1 { font-size: 15px; margin: 0; text-align: center; } .aviso { text-align: center; font-size: 9px; font-weight: bold; margin: 4px 0 10px; }
    table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #999; padding: 3px 5px; } th { background: #eee; font-size: 10px; }
    .d { text-align: right; } .c { text-align: center; } .t { font-weight: bold; margin: 12px 0 4px; } .cab td { border: none; padding: 2px 0; }
  </style></head><body>
  <div style="text-align:center;font-weight:bold">${esc(empresa?.razao_social || empresa?.nome_comercial || '')}</div>
  <h1>DAV - DOCUMENTO AUXILIAR DE VENDA</h1>
  <div class="aviso">NÃO É DOCUMENTO FISCAL - NÃO É VÁLIDO COMO RECIBO E COMO GARANTIA DE MERCADORIA / NÃO COMPROVA PAGAMENTO</div>
  <table class="cab"><tr><td><b>NR. DO DOCUMENTO:</b> ${esc(v.serie)} / ${numero}</td><td><b>DATA:</b> ${dataBR(v.data_venda)}</td><td><b>OPERAÇÃO:</b> ${esc(v.apelido_operacao)}</td></tr>
    <tr><td colspan="3"><b>CLIENTE:</b> ${esc(v.nome)}</td></tr>
    <tr><td colspan="3"><b>ENDEREÇO:</b> ${esc(v.endereco)}, ${esc(v.endereco_nr)} - ${esc(v.endereco_complemento)} - ${esc(v.endereco_bairro)} - CEP: ${esc(v.endereco_cep)}</td></tr></table>
  <div class="t">PRODUTOS</div>
  <table><tr><th>CODIGO</th><th>DESCRIÇÃO</th><th>QTD.</th><th>PREÇO UNIT</th><th>VALOR TOTAL</th><th>ACRESC</th><th>DESCONTO</th></tr>${linhas}
    <tr><td colspan="4" class="d"><b>TOTAL</b></td><td class="d"><b>${moedaBR(soma)}</b></td><td colspan="2"></td></tr></table>
  <div class="t">PARCELAS</div>
  <table style="width:50%"><tr><th>PARCELA</th><th>VENCIMENTO</th><th>VALOR</th></tr>${parc}</table>
  <div class="t">OBSERVAÇÕES</div><div style="white-space:pre-wrap;border:1px solid #999;padding:5px;min-height:40px">${esc(v.obs)}</div>
  </body></html>`;
}

// ============================================================================ rotas

type Handler = (req: Request, res: Response) => Promise<unknown>;
const rota = (fn: Handler) => async (req: Request, res: Response) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json(r ?? { success: true });
  } catch (err: any) {
    if (!err.status) console.error('Vendas:', err);
    res.status(err.status || 400).json({ error: err.message || 'Falha na operação.' });
  }
};
const id = (req: Request, nome = 'id') => Number(req.params[nome]) || 0;
const em = (res: Response, fn: (c: PoolConnection) => Promise<any>) => comUsuario(contexto(res), fn);

const SQL_LISTA = `
  SELECT A.id, A.data_venda, A.data_saida, A.hora_saida, A.datahora_inclusao, A.id_operacao, O.codigo operacao_codigo, O.tipo operacao_tipo,
         O.apelido apelido_operacao, O.cor operacao_cor, A.es, A.id_serie, A.serie, A.tipo, A.numero, A.id_cliente, B.nome, B.endereco_uf,
         A.id_condicao, E.apelido apelido_plano, E.nr_parcelas, E.juros_mes, A.id_vendedor1, C.nome nome_1, A.id_vendedor2, D.nome nome_2,
         A.valor_total_bruto, A.valor_total_liquido_antes_desconto_nf, A.valor_acrescimo_plano + A.valor_acrescimo_digitado valor_acrescimo_nf,
         A.valor_desconto_plano + A.valor_desconto_digitado valor_desconto_nf, A.valor_total_liquido, A.status, A.cancelado, A.pedido_status,
         A.nfe_protocolo, A.nfe_status, A.hash, S.modelo serie_modelo, (A.obs IS NOT NULL AND A.obs <> '') tem_obs
    FROM vendas A
    LEFT JOIN pessoas B ON B.id = A.id_cliente
    LEFT JOIN vendedores C ON C.id = A.id_vendedor1
    LEFT JOIN vendedores D ON D.id = A.id_vendedor2
    LEFT JOIN vendas_condicoes E ON E.id = A.id_condicao
    LEFT JOIN vendas_operacoes O ON O.id = A.id_operacao
    LEFT JOIN vendas_series S ON S.id = A.id_serie`;

export function createVendasRouter() {
  const router = Router();

  /** Combos da tela: operações, séries, condições, vendedores, bancos (do grupo) */
  router.get(
    '/vendas/apoio',
    rota(async (_req, res) => {
      const g = grupoDe(res);
      const [operacoes, series, condicoes, vendedores, bancos] = await Promise.all([
        varios(pool, 'SELECT id, codigo, apelido, descricao, tipo, es, cor, series_aceitas, mov_estoque FROM vendas_operacoes WHERE id_grupo = ? ORDER BY id', [g]),
        varios(pool, "SELECT id, serie, modelo, descricao, tipo FROM vendas_series WHERE id_grupo = ? AND COALESCE(ativo,'S') = 'S' ORDER BY serie", [g]),
        varios(pool, "SELECT * FROM vendas_condicoes WHERE id_grupo = ? AND COALESCE(ativo,'S') = 'S' ORDER BY `index`, id", [g]),
        varios(pool, "SELECT id, nome FROM vendedores WHERE id_grupo = ? AND COALESCE(ativo,'S') = 'S' ORDER BY nome", [g]),
        varios(pool, 'SELECT id, apelido FROM bancos WHERE id_grupo = ? ORDER BY apelido', [g]),
      ]);
      return { operacoes, series, condicoes, vendedores, bancos };
    }),
  );

  /** Pesquisa de clientes e produtos (F2 do Delphi): texto no nome/referência ou o id */
  router.get(
    '/vendas/pesquisa/:tipo',
    rota(async (req, res) => {
      const q = txt(req.query.q);
      const g = grupoDe(res);
      const like = `%${q}%`;
      if (req.params.tipo === 'clientes')
        return varios(
          pool,
          `SELECT id, nome, fantasia, cpf_cnpj, endereco_cidade, endereco_uf FROM pessoas
            WHERE id_grupo = ? AND COALESCE(ativo,'S') = 'S' AND (? = '' OR nome LIKE ? OR fantasia LIKE ? OR cpf_cnpj LIKE ? OR id = ?)
            ORDER BY nome LIMIT 50`,
          [g, q, like, like, like, Number(q) || 0],
        );
      if (req.params.tipo === 'produtos')
        return varios(
          pool,
          `SELECT A.id, A.referencia, A.descricao, A.preco_venda, A.un_venda, COALESCE(E.qtd_estoque, 0) qtd_estoque FROM produtos A
             LEFT JOIN produtos_estoque_simples E ON E.id_produto = A.id AND E.id_empresa = ?
            WHERE A.id_grupo = ? AND COALESCE(A.ativo,'S') = 'S' AND (? = '' OR A.descricao LIKE ? OR A.referencia LIKE ? OR A.cod_barra = ? OR A.id = ?)
            ORDER BY A.descricao LIMIT 50`,
          [empresaDe(res), g, q, like, like, q, Number(q) || 0],
        );
      throw recusar('Pesquisa desconhecida.', 404);
    }),
  );

  /** Produto + estoque da empresa ativa (Id Produto do item) */
  router.get(
    '/vendas/produto/:id',
    rota(async (req, res) => {
      const p = await um(
        pool,
        `SELECT A.id, A.referencia, A.descricao, A.preco_venda, A.un_venda, COALESCE(E.qtd_estoque, 0) qtd_estoque FROM produtos A
           LEFT JOIN produtos_estoque_simples E ON E.id_produto = A.id AND E.id_empresa = ?
          WHERE A.id = ? AND A.id_grupo = ?`,
        [empresaDe(res), id(req), grupoDe(res)],
      );
      if (!p) throw recusar(`Produto com ID ${id(req)} não encontrado!`, 404);
      return p;
    }),
  );

  /** Lista (§2.2) com os filtros do cabeçalho: data, operação (código), cliente (prefixo) e status */
  router.get(
    '/vendas',
    rota(async (req, res) => {
      const w = ['A.id_grupo = ?', 'A.id_empresa = ?'];
      const p: unknown[] = [grupoDe(res), empresaDe(res)];
      const d1 = txt(req.query.d1);
      const d2 = txt(req.query.d2);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d1) && /^\d{4}-\d{2}-\d{2}$/.test(d2)) {
        w.push('A.data_venda BETWEEN ? AND ?');
        p.push(d1, d2);
      }
      if (txt(req.query.operacao)) {
        w.push('O.codigo = ?');
        p.push(txt(req.query.operacao));
      }
      if (txt(req.query.cliente)) {
        w.push('B.nome LIKE ?');
        p.push(`${txt(req.query.cliente)}%`);
      }
      if (txt(req.query.status)) {
        w.push('A.status = ?');
        p.push(txt(req.query.status).charAt(0));
      }
      const limite = Math.min(Number(req.query.limite) || 500, 2000);
      const linhas = await varios(pool, `${SQL_LISTA} WHERE ${w.join(' AND ')} ORDER BY A.id DESC LIMIT ${limite}`, p);
      return linhas.reverse();
    }),
  );

  /** Venda com itens, parcelas (areceber) e painel de condições */
  router.get(
    '/vendas/:id(\\d+)',
    rota(async (req, res) => {
      const v = await um(pool, `${SQL_LISTA} WHERE A.id = ? AND A.id_grupo = ? AND A.id_empresa = ?`, [id(req), grupoDe(res), empresaDe(res)]);
      if (!v) throw recusar('Venda não encontrada.', 404);
      const completo = await lerVenda(pool, res, id(req));
      const cli = await um(pool, 'SELECT nome, endereco, endereco_nr, endereco_complemento, endereco_bairro, endereco_uf, endereco_cep, cpf_cnpj, fone_celular1, email FROM pessoas WHERE id = ? AND id_grupo = ?', [v.id_cliente, grupoDe(res)]);
      const [itens, parcelas, condicoes, impostos] = await Promise.all([
        varios(pool, SQL_ITENS, [v.id]),
        varios(pool, 'SELECT id, parcelas_nr, parcelas_tot, data_vencimento, valor_areceber, id_banco, documento, status FROM areceber WHERE id_venda = ? AND id_grupo = ? ORDER BY parcelas_nr', [v.id, grupoDe(res)]),
        varios<Condicao>(pool, "SELECT * FROM vendas_condicoes WHERE id_grupo = ? AND COALESCE(ativo,'S') = 'S' ORDER BY `index`, id", [grupoDe(res)]),
        um(pool, 'SELECT * FROM nfe_impostos WHERE id_venda = ? ORDER BY id LIMIT 1', [v.id]),
      ]);
      return { ...completo, ...v, cliente: cli ?? null, itens, parcelas, impostos: impostos ?? null, condicoes: itens.length ? simularCondicoes(n(completo.valor_total_bruto), condicoes) : [] };
    }),
  );

  /** §3.5 Gravar cabeçalho (inclusão e alteração) */
  const gravarCabecalho = async (req: Request, res: Response, idVenda: number | null) => {
    const b = req.body ?? {};
    const g = grupoDe(res);
    return em(res, async (c) => {
      const atual = idVenda ? await lerVenda(c, res, idVenda, true) : null;
      if (atual) exigirAberta(atual);
      const erros: string[] = [];
      const op = n(b.id_operacao) ? await um(c, 'SELECT * FROM vendas_operacoes WHERE id = ? AND id_grupo = ?', [n(b.id_operacao), g]) : null;
      if (!op) erros.push('Operação inválida!');
      const serie = n(b.id_serie) ? await um(c, 'SELECT * FROM vendas_series WHERE id = ? AND id_grupo = ?', [n(b.id_serie), g]) : null;
      if (!serie) erros.push('Série inválida!');
      else if (op && !seriesAceitas(op.series_aceitas).includes(txt(serie.serie))) erros.push('Série não aceita para esta operação');
      if (!(n(b.id_cliente) && (await um(c, 'SELECT id FROM pessoas WHERE id = ? AND id_grupo = ?', [n(b.id_cliente), g])))) erros.push('Cliente inválido!');
      if (!(n(b.id_vendedor1) && (await um(c, 'SELECT id FROM vendedores WHERE id = ? AND id_grupo = ?', [n(b.id_vendedor1), g])))) erros.push('Vendedor inválido!');
      if (n(b.id_vendedor2) && !(await um(c, 'SELECT id FROM vendedores WHERE id = ? AND id_grupo = ?', [n(b.id_vendedor2), g]))) erros.push('Vendedor 2 inválido!');
      let idCondicao = n(b.id_condicao);
      if (op?.tipo === 'D') {
        const vale = await um(c, "SELECT id FROM vendas_condicoes WHERE id_grupo = ? AND UPPER(apelido) = 'VALE' LIMIT 1", [g]);
        if (!vale) erros.push('Você deve ter uma condição "VALE" cadastrada!');
        else idCondicao = vale.id;
      } else if (!(idCondicao && (await lerCondicao(c, res, idCondicao)))) erros.push('Condição de pagamento inválida!');
      if (erros.length) throw recusar(erros.join('\n'));

      const dados = {
        id_operacao: op.id,
        id_serie: serie.id,
        serie: txt(serie.serie),
        tipo: op.tipo,
        es: op.es,
        id_cliente: n(b.id_cliente),
        id_condicao: idCondicao,
        id_vendedor1: n(b.id_vendedor1),
        id_vendedor2: n(b.id_vendedor2),
        valor_acrescimo_digitado: r2(Math.max(n(b.valor_acrescimo_digitado), 0)),
        valor_desconto_digitado: r2(Math.max(n(b.valor_desconto_digitado), 0)),
        id_usuario_alteracao: res.locals.usuarioId ?? 0,
      };
      const cols = Object.keys(dados);
      let novoId = idVenda;
      if (atual) {
        await c.query(`UPDATE vendas SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...cols.map((k) => (dados as any)[k]), atual.id]);
      } else {
        const [ins] = await c.query<any>(
          `INSERT INTO vendas (id_grupo, id_empresa, data_venda, status, cancelado, pedido_status, numero, hash, datahora_inclusao, id_usuario_inclusao, ${cols.join(', ')})
           VALUES (?, ?, CURDATE(), 'A', 'N', 'N', '0', ?, NOW(), ?, ${cols.map(() => '?').join(', ')})`,
          [g, empresaDe(res), getHash(), res.locals.usuarioId ?? 0, ...cols.map((k) => (dados as any)[k])],
        );
        novoId = ins.insertId;
      }
      await totalizar(c, res, novoId!);
      return { id: novoId };
    });
  };
  router.post('/vendas', rota((req, res) => gravarCabecalho(req, res, null)));
  router.put('/vendas/:id(\\d+)', rota((req, res) => gravarCabecalho(req, res, id(req))));

  /** §3.3 Excluir: itens, impostos e estorno na origem, tudo em transação (o Delphi deixava órfãos) */
  router.delete(
    '/vendas/:id(\\d+)',
    rota(async (req, res) =>
      em(res, async (c) => {
        const v = await lerVenda(c, res, id(req), true);
        exigirAberta(v);
        const itens = await varios(c, 'SELECT id, qtdade, id_vendas_produtos_devol FROM vendas_produtos WHERE id_venda = ?', [v.id]);
        for (const i of itens) await estornarOrigem(c, i.id_vendas_produtos_devol, n(i.qtdade));
        await c.query('DELETE FROM nfe_impostos_produtos WHERE id_vendas_produtos IN (SELECT id FROM vendas_produtos WHERE id_venda = ?)', [v.id]);
        await c.query('DELETE FROM vendas_produtos WHERE id_venda = ?', [v.id]);
        await c.query('DELETE FROM nfe_impostos WHERE id_venda = ?', [v.id]);
        await c.query('DELETE FROM vendas WHERE id = ?', [v.id]);
        await gravarLog(contexto(res), `Venda ${v.id} excluída`, { nome: 'vendas', id: v.id, op: 'E' });
      }),
    ),
  );

  router.post(
    '/vendas/:id(\\d+)/totalizar',
    rota(async (req, res) => em(res, (c) => totalizar(c, res, id(req)))),
  );

  /** Duplo clique numa condição do painel (§2.5) */
  router.put(
    '/vendas/:id(\\d+)/condicao',
    rota(async (req, res) =>
      em(res, async (c) => {
        const v = await lerVenda(c, res, id(req), true);
        exigirAberta(v);
        const cond = await lerCondicao(c, res, n(req.body?.id_condicao));
        if (!cond) throw recusar('Condição de pagamento inválida!');
        if (n(v.id_cliente) === 1 && !txt(cond.apelido).toUpperCase().includes('VISTA')) throw recusar('Venda consumidor somente a vista!');
        await c.query('UPDATE vendas SET id_condicao = ? WHERE id = ?', [cond.id, v.id]);
        await totalizar(c, res, v.id);
      }),
    ),
  );

  /** §3.10 Observação (o modal do Delphi não gravava; aqui grava ao confirmar) */
  router.put(
    '/vendas/:id(\\d+)/obs',
    rota(async (req, res) =>
      em(res, async (c) => {
        const v = await lerVenda(c, res, id(req), true);
        exigirAberta(v);
        await c.query('UPDATE vendas SET obs = ? WHERE id = ?', [String(req.body?.obs ?? ''), v.id]);
      }),
    ),
  );

  /** Data/hora de saída (colunas editáveis da lista) */
  router.put(
    '/vendas/:id(\\d+)/saida',
    rota(async (req, res) =>
      em(res, async (c) => {
        const v = await lerVenda(c, res, id(req), true);
        if (v.nfe_status === '100') throw recusar('NF-e já autorizada: a data de saída não pode mais mudar.');
        const data = txt(req.body?.data_saida);
        const hora = txt(req.body?.hora_saida);
        if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw recusar('Data de saída inválida.');
        if (hora && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) throw recusar('Hora de saída inválida (hh:mm).');
        await c.query('UPDATE vendas SET data_saida = ?, hora_saida = ? WHERE id = ?', [data || null, hora || null, v.id]);
      }),
    ),
  );

  // ---------------------------------------------------------------- itens (§5)

  const gravarItem = async (req: Request, res: Response, idItem: number | null) => {
    const b = req.body ?? {};
    return em(res, async (c) => {
      const v = await lerVenda(c, res, id(req), true);
      exigirAberta(v);
      const atual = idItem ? await um(c, 'SELECT * FROM vendas_produtos WHERE id = ? AND id_venda = ?', [idItem, v.id]) : null;
      if (idItem && !atual) throw recusar('Item não encontrado.', 404);
      if (atual?.id_vendas_produtos_devol > 0) throw recusar('Produto capturado para devolução não pode ser editado!');
      const prod = await um(c, 'SELECT id, referencia, preco_venda FROM produtos WHERE id = ? AND id_grupo = ?', [n(b.id_produto), grupoDe(res)]);
      if (!prod) throw recusar(`Produto com ID ${n(b.id_produto)} não encontrado!`);
      const qtd = arred(n(b.qtdade), 3);
      if (qtd <= 0) throw recusar('Quantidade inválida!');
      // Preço vem do cadastro (no Delphi o campo era só leitura); mantém o do item enquanto o produto não muda
      const preco = atual && n(atual.id_produto) === prod.id ? n(atual.preco_venda) : r2(n(prod.preco_venda));
      const bruto = r2(qtd * preco);
      const acr = r2(Math.max(n(b.valor_acrescimo), 0));
      const desc = r2(Math.max(n(b.valor_desconto), 0));
      const liq = r2(bruto + acr - desc);
      if (liq <= 0) throw recusar('Preço/Valor inválido!');
      const percDesc = bruto ? r2((desc / bruto) * 100) : 0;
      if (percDesc > 90) throw recusar('Desconto inválido! (máximo 90%)');
      const dados = {
        id_produto: prod.id,
        referencia: txt(prod.referencia).slice(0, 25),
        id_vendedor1: v.id_vendedor1,
        id_vendedor2: v.id_vendedor2,
        qtdade: qtd,
        preco_lista: atual && n(atual.id_produto) === prod.id ? n(atual.preco_lista) : r2(n(prod.preco_venda)),
        preco_venda: preco,
        valor_total_bruto: bruto,
        perc_acrescimo: bruto ? r2((acr / bruto) * 100) : 0,
        valor_acrescimo: acr,
        perc_desconto: percDesc,
        valor_desconto: desc,
        valor_total_liquido: liq,
        valor_total_liquido_final: liq,
      };
      const cols = Object.keys(dados);
      let novo = idItem;
      if (atual) await c.query(`UPDATE vendas_produtos SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...cols.map((k) => (dados as any)[k]), atual.id]);
      else {
        const [ins] = await c.query<any>(`INSERT INTO vendas_produtos (id_venda, item, faturado, ${cols.join(', ')}) VALUES (?, 9999, 'N', ${cols.map(() => '?').join(', ')})`, [
          v.id,
          ...cols.map((k) => (dados as any)[k]),
        ]);
        novo = ins.insertId;
      }
      await totalizar(c, res, v.id);
      return { id: novo };
    });
  };
  router.post('/vendas/:id(\\d+)/itens', rota((req, res) => gravarItem(req, res, null)));
  router.put('/vendas/:id(\\d+)/itens/:item(\\d+)', rota((req, res) => gravarItem(req, res, id(req, 'item'))));
  router.delete(
    '/vendas/:id(\\d+)/itens/:item(\\d+)',
    rota(async (req, res) =>
      em(res, async (c) => {
        const v = await lerVenda(c, res, id(req), true);
        exigirAberta(v);
        const it = await um(c, 'SELECT * FROM vendas_produtos WHERE id = ? AND id_venda = ?', [id(req, 'item'), v.id]);
        if (!it) throw recusar('Item não encontrado.', 404);
        await estornarOrigem(c, it.id_vendas_produtos_devol, n(it.qtdade));
        await c.query('DELETE FROM nfe_impostos_produtos WHERE id_vendas_produtos = ?', [it.id]);
        await c.query('DELETE FROM vendas_produtos WHERE id = ?', [it.id]);
        await totalizar(c, res, v.id);
      }),
    ),
  );

  /** §6.3 Calcular Impostos (todos os itens) */
  router.post(
    '/vendas/:id(\\d+)/impostos',
    rota(async (req, res) =>
      em(res, async (c) => {
        await totalizar(c, res, id(req));
        return calcularImpostos(c, res, id(req), true);
      }),
    ),
  );

  // ---------------------------------------------------------------- finalizar (§3.6 / §7)

  const bancoApelido = async (c: Conn, res: Response, idBanco: number) =>
    txt((await um(c, 'SELECT apelido FROM bancos WHERE id = ? AND id_grupo = ?', [idBanco, grupoDe(res)]))?.apelido);

  router.post(
    '/vendas/:id(\\d+)/finalizar/preparar',
    rota(async (req, res) =>
      em(res, async (c) => {
        let v = await lerVenda(c, res, id(req), true);
        if (v.status !== 'A') throw recusar(FINALIZADA);
        await totalizar(c, res, v.id);
        v = await lerVenda(c, res, v.id);
        if (n(v.valor_total_liquido) <= 0) throw recusar('Valor da venda zerado!');
        if (!txt(v.serie)) throw recusar('Série não definida!');
        // Fórmula só é exigida quando a série emite NF-e (no Delphi: sempre, e só do item corrente)
        const imp = await calcularImpostos(c, res, v.id, txt(v.serie_modelo) === '55');
        const cond = await lerCondicao(c, res, v.id_condicao);
        if (!cond) throw recusar('Condição de pagamento inválida!');
        const cli = await um(c, 'SELECT nome FROM pessoas WHERE id = ?', [v.id_cliente]);
        return {
          cliente: txt(cli?.nome),
          total: n(v.valor_total_liquido),
          tipoVenda: `${txt(v.apelido_operacao)} / ${txt(v.apelido_plano)}`,
          parcelas: gerarParcelas(n(v.valor_total_liquido), cond, hojeISO(), await bancoApelido(c, res, cond.id_banco)),
          avisos: imp.avisos,
        };
      }),
    ),
  );

  router.post(
    '/vendas/:id(\\d+)/parcelas/refazer',
    rota(async (req, res) => {
      const v = await lerVenda(pool, res, id(req));
      const cond = await lerCondicao(pool, res, v.id_condicao);
      if (!cond) throw recusar('Condição de pagamento inválida!');
      const parcelas = (Array.isArray(req.body?.parcelas) ? req.body.parcelas : []) as Parcela[];
      return refazerParcelas(parcelas, n(v.valor_total_liquido), cond, await bancoApelido(pool, res, cond.id_banco));
    }),
  );

  /** §7.3 Gravar a finalização: numeração com lock, status F, títulos, vales e cardex — numa transação */
  router.post(
    '/vendas/:id(\\d+)/finalizar',
    rota(async (req, res) =>
      em(res, async (c) => {
        const v = await lerVenda(c, res, id(req), true);
        if (v.status !== 'A') throw recusar(FINALIZADA);
        const parcelas = (Array.isArray(req.body?.parcelas) ? req.body.parcelas : []) as Parcela[];
        if (!parcelas.length) throw recusar('Gere as parcelas antes de gravar.');
        for (const p of parcelas) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(txt(p.vencimento))) throw recusar(`Vencimento inválido na parcela ${p.nr}.`);
          if (n(p.valor) <= 0) throw recusar(`Valor inválido na parcela ${p.nr}.`);
        }
        const soma = r2(parcelas.reduce((s, p) => s + n(p.valor), 0));
        if (Math.abs(soma - n(v.valor_total_liquido)) >= 0.005) throw recusar('Valor das parcelas não fecha com o total!');

        let numero = txt(v.numero);
        if (!n(numero)) {
          const [up] = await c.query<any>('UPDATE vendas_series SET ultimo = LAST_INSERT_ID(COALESCE(ultimo,0) + 1) WHERE id = ? AND id_grupo = ?', [v.id_serie, grupoDe(res)]);
          if (!up.affectedRows) throw recusar('Série não definida!');
          numero = String((await um(c, 'SELECT LAST_INSERT_ID() n'))!.n);
        }
        await c.query("UPDATE vendas SET numero = ?, status = 'F', id_usuario_alteracao = ? WHERE id = ?", [numero, res.locals.usuarioId ?? 0, v.id]);

        const codigo = txt(v.operacao_codigo);
        const documento = `${txt(v.serie)}/${numero.padStart(6, '0')}`;
        // Título só para venda (o Delphi gerava para qualquer operação: orçamento, pedido e devolução também)
        const geraTitulo = txt(v.operacao_tipo) !== 'D' && !['ORC', 'PED'].includes(codigo);
        for (const p of parcelas) {
          const valor = r2(n(p.valor));
          if (geraTitulo)
            await c.query(
              `INSERT INTO areceber (id_grupo, id_empresa, id_venda, id_banco, tipo_operacao, documento, parcelas_nr, parcelas_tot, id_cliente, data_venda,
                                     data_vencimento, valor_original, valor_areceber, valor_ja_recebido, multa_perc, juros_perc_mes, juros_valor_dia, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 2, 2, ?, 'A')`,
              [grupoDe(res), empresaDe(res), v.id, n(p.id_banco), codigo, documento, p.nr, parcelas.length, v.id_cliente, v.data_venda, p.vencimento, valor, valor, arred((2 / 30 / 100) * valor, 3)],
            );
          if (txt(v.operacao_tipo) === 'D')
            await c.query(
              `INSERT INTO areceber_vales (id_grupo, id_empresa, id_venda, id_cliente, numero, data_geracao, data_vencimento, valor, valor_usado, status, obs,
                                           datahora_inclusao, id_usuario_inclusao)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'A', '', NOW(), ?)`,
              [grupoDe(res), empresaDe(res), v.id, v.id_cliente, getNumeroVale(), v.data_venda, p.vencimento, valor, res.locals.usuarioId ?? 0],
            );
        }

        // Kardex só quando a operação movimenta estoque (o Delphi ignorava mov_estoque)
        if (txt(v.mov_estoque || 'S') === 'S') {
          const itens = await varios(c, 'SELECT id_produto, qtdade, valor_total_liquido FROM vendas_produtos WHERE id_venda = ? ORDER BY item, id', [v.id]);
          const produtos = new Set<number>();
          for (const i of itens) {
            const unit = dividirMoeda(n(i.valor_total_liquido), n(i.qtdade));
            await c.query(
              `INSERT INTO produtos_cardex (id_grupo, id_empresa, produto_id, documento, data_mov, hora_mov, datahora_mov, ES, qtdade_mov, valor_unit_mov,
                                            valor_total_mov, datahora_inclusao, usuario_inclusao, venda_id)
               VALUES (?, ?, ?, ?, CURDATE(), CURTIME(), NOW(), ?, ?, ?, ?, NOW(), ?, ?)`,
              [grupoDe(res), empresaDe(res), i.id_produto, `${txt(v.serie)}/${numero}`.slice(0, 15), codigo === 'DEV' ? 'E' : 'S', n(i.qtdade), unit, arred(unit * n(i.qtdade), 3), res.locals.usuarioId ?? 0, v.id],
            );
            produtos.add(n(i.id_produto));
          }
          for (const p of produtos) await c.query('CALL calcular_custo_medio(?)', [p]);
        }
        await gravarLog(contexto(res), `Venda ${v.id} finalizada: ${documento}`, { nome: 'vendas', id: v.id, op: 'A' });
        return { id: v.id, numero };
      }),
    ),
  );

  // ---------------------------------------------------------------- impressão (§3.7)

  router.get(
    '/vendas/:id(\\d+)/imprimir',
    rota(async (req, res) => {
      const v = await um(
        pool,
        `SELECT A.*, O.apelido apelido_operacao, B.nome, B.endereco, B.endereco_nr, B.endereco_complemento, B.endereco_bairro, B.endereco_cep
           FROM vendas A LEFT JOIN pessoas B ON B.id = A.id_cliente LEFT JOIN vendas_operacoes O ON O.id = A.id_operacao
          WHERE A.id = ? AND A.id_grupo = ? AND A.id_empresa = ?`,
        [id(req), grupoDe(res), empresaDe(res)],
      );
      if (!v) throw recusar('Venda não encontrada.', 404);
      if (v.status === 'A') throw recusar('Esta venda ainda está aberta (imprimir somente fechados)!');
      const [itens, parcelas, empresa] = await Promise.all([
        varios(pool, SQL_ITENS, [v.id]),
        varios(pool, 'SELECT parcelas_nr, parcelas_tot, data_vencimento, valor_areceber FROM areceber WHERE id_venda = ? AND id_grupo = ? ORDER BY parcelas_nr', [v.id, grupoDe(res)]),
        um(pool, 'SELECT razao_social, nome_comercial FROM empresas_filiais WHERE id = ?', [empresaDe(res)]),
      ]);
      const pdf = await gerarPdf(htmlDav(v, itens, parcelas, empresa));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="dav_${txt(v.serie)}_${txt(v.numero).padStart(6, '0')}.pdf"`);
      res.send(pdf);
    }),
  );

  // ---------------------------------------------------------------- duplicar / orçamento (§3.8, §3.9)

  router.post(
    '/vendas/:id(\\d+)/duplicar',
    rota(async (req, res) =>
      em(res, async (c) => {
        const v = await lerVenda(c, res, id(req));
        const novo = await duplicarVenda(c, res, v, n(req.body?.id_operacao));
        await totalizar(c, res, novo);
        return { id: novo };
      }),
    ),
  );

  router.post(
    '/vendas/:id(\\d+)/orcamento/confirmar',
    rota(async (req, res) =>
      em(res, async (c) => {
        const v = await lerVenda(c, res, id(req), true);
        if (v.operacao_codigo !== 'ORC') throw recusar('Este registro não é um orçamento!');
        if (v.status === 'C') throw recusar('Este orçamento já está confirmado!');
        await c.query("UPDATE vendas SET status = 'C' WHERE id = ?", [v.id]);
        const novo = await duplicarVenda(c, res, v, n(req.body?.id_operacao));
        await totalizar(c, res, novo);
        return { id: novo };
      }),
    ),
  );

  router.post(
    '/vendas/:id(\\d+)/orcamento/descartar',
    rota(async (req, res) =>
      em(res, async (c) => {
        const v = await lerVenda(c, res, id(req), true);
        if (v.operacao_codigo !== 'ORC') throw recusar('Este registro não é um orçamento!');
        await c.query("UPDATE vendas SET status = 'R' WHERE id = ?", [v.id]);
      }),
    ),
  );

  // ---------------------------------------------------------------- devolução (§5.3)

  router.get(
    '/vendas/:id(\\d+)/devolucao',
    rota(async (req, res) => {
      const v = await lerVenda(pool, res, id(req));
      exigirAberta(v);
      if (v.operacao_codigo !== 'DEV') throw recusar('Esta venda não é uma devolução!');
      const linhas = await varios(
        pool,
        `SELECT CONCAT(A.serie,'/',A.numero,' DE ',DATE_FORMAT(A.data_venda,'%d/%m/%Y')) grupo, A.id id_venda_origem, A.data_venda,
                CONCAT(RIGHT(CONCAT('000',A.id_vendedor1),3),'-',COALESCE(V1.nome,'')) vendedor1_idnome, A.serie, A.numero,
                B.id id_vendas_produtos, B.id_produto, P.referencia, P.descricao, B.qtdade, COALESCE(B.qtdade_devol,0) qtdade_devol,
                B.preco_lista, B.valor_total_liquido_final / B.qtdade preco_unit_venda, B.valor_total_liquido_final,
                COALESCE((SELECT SUM(X.qtdade) FROM vendas_produtos X WHERE X.id_venda = ? AND X.id_vendas_produtos_devol = B.id), 0) qtdade_nesta
           FROM vendas A
           JOIN vendas_produtos B ON B.id_venda = A.id
           LEFT JOIN produtos P ON P.id = B.id_produto
           LEFT JOIN vendas_series S ON S.id = A.id_serie
           LEFT JOIN vendas_operacoes O ON O.id = A.id_operacao
           LEFT JOIN vendedores V1 ON V1.id = A.id_vendedor1
          WHERE A.id_grupo = ? AND A.id_empresa = ? AND A.id_cliente = ? AND S.tipo = 'V' AND O.codigo = 'VEN' AND A.status = 'F'
          ORDER BY A.data_venda, A.serie, A.numero, B.item`,
        [v.id, grupoDe(res), empresaDe(res), v.id_cliente],
      );
      return { cliente: { id: v.id_cliente, nome: txt((await um(pool, 'SELECT nome FROM pessoas WHERE id = ?', [v.id_cliente]))?.nome) }, linhas };
    }),
  );

  /** Itens capturados de outra venda (devolução e pedido): substitui o que já existia da mesma origem */
  async function capturarItem(c: Conn, idVenda: number, origem: any, qtd: number, preco: number) {
    const ja = await um(c, 'SELECT id, qtdade FROM vendas_produtos WHERE id_venda = ? AND id_vendas_produtos_devol = ?', [idVenda, origem.id]);
    if (ja) {
      await estornarOrigem(c, origem.id, n(ja.qtdade));
      await c.query('DELETE FROM nfe_impostos_produtos WHERE id_vendas_produtos = ?', [ja.id]);
      await c.query('DELETE FROM vendas_produtos WHERE id = ?', [ja.id]);
    }
    const valor = r2(preco * qtd);
    await c.query(
      `INSERT INTO vendas_produtos (id_venda, item, id_produto, id_vendedor1, id_vendedor2, referencia, qtdade, qtdade_devol, preco_lista, preco_venda,
                                   valor_total_bruto, perc_acrescimo, valor_acrescimo, perc_desconto, valor_desconto, valor_total_liquido,
                                   valor_total_liquido_final, faturado, id_vendas_produtos_devol)
       VALUES (?, 9999, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 0, 0, 0, ?, ?, 'N', ?)`,
      [idVenda, origem.id_produto, origem.id_vendedor1, origem.id_vendedor2, txt(origem.referencia_produto).slice(0, 25), qtd, n(origem.preco_lista), r2(preco), valor, valor, valor, origem.id],
    );
  }

  router.post(
    '/vendas/:id(\\d+)/devolucao',
    rota(async (req, res) =>
      em(res, async (c) => {
        const v = await lerVenda(c, res, id(req), true);
        exigirAberta(v);
        if (v.operacao_codigo !== 'DEV') throw recusar('Esta venda não é uma devolução!');
        const linhas = (Array.isArray(req.body?.linhas) ? req.body.linhas : []).filter((l: any) => n(l.qtd) > 0);
        if (!linhas.length) throw recusar('Informe a quantidade devolvida de ao menos um produto.');
        for (const l of linhas) {
          const o = await um(
            c,
            `SELECT B.*, P.referencia referencia_produto, A.id_vendedor1, A.id_vendedor2
               FROM vendas_produtos B JOIN vendas A ON A.id = B.id_venda LEFT JOIN produtos P ON P.id = B.id_produto
               LEFT JOIN vendas_operacoes O ON O.id = A.id_operacao
              WHERE B.id = ? AND A.id_grupo = ? AND A.id_empresa = ? AND A.id_cliente = ? AND A.status = 'F' AND O.codigo = 'VEN' FOR UPDATE`,
            [n(l.id_vendas_produtos), grupoDe(res), empresaDe(res), v.id_cliente],
          );
          if (!o) throw recusar('Produto de origem não encontrado nas vendas do cliente.');
          const nesta = n((await um(c, 'SELECT SUM(qtdade) q FROM vendas_produtos WHERE id_venda = ? AND id_vendas_produtos_devol = ?', [v.id, o.id]))?.q);
          const qtd = arred(n(l.qtd), 3);
          if (qtd > arred(n(o.qtdade) - n(o.qtdade_devol) + nesta, 3)) throw recusar('Qtdade. devolvida maior que quantidade da nota (+já devolvida)!');
          await capturarItem(c, v.id, { ...o, id_vendedor1: o.id_vendedor1, id_vendedor2: o.id_vendedor2 }, qtd, n(o.qtdade) ? n(o.valor_total_liquido_final) / n(o.qtdade) : 0);
          await c.query('UPDATE vendas_produtos SET qtdade_devol = COALESCE(qtdade_devol,0) + ? WHERE id = ?', [qtd, o.id]);
        }
        await totalizar(c, res, v.id);
      }),
    ),
  );

  // ---------------------------------------------------------------- captura de pedidos (§5.4)

  router.get(
    '/vendas/:id(\\d+)/pedidos',
    rota(async (req, res) => {
      const v = await lerVenda(pool, res, id(req));
      exigirAberta(v);
      if (v.operacao_codigo !== 'VEN') throw recusar('Este registro não é uma Venda!');
      const d1 = /^\d{4}-\d{2}-\d{2}$/.test(txt(req.query.d1)) ? txt(req.query.d1) : '2001-01-01';
      const d2 = /^\d{4}-\d{2}-\d{2}$/.test(txt(req.query.d2)) ? txt(req.query.d2) : '2099-12-31';
      const linhas = await varios(
        pool,
        `SELECT CONCAT(A.serie,'/',A.numero,' DE ',DATE_FORMAT(A.data_venda,'%d/%m/%Y')) grupo, A.id id_vendas_master, A.data_venda,
                CONCAT(RIGHT(CONCAT('000',A.id_vendedor1),3),'-',COALESCE(V1.nome,'')) vendedor1_idnome, A.serie, A.numero,
                B.id id_vendas_produtos, B.id_produto, P.referencia, P.descricao, B.qtdade, COALESCE(B.qtdade_devol,0) qtdade_devol,
                B.preco_lista, B.valor_total_liquido / B.qtdade preco_unit_venda, B.valor_total_liquido
           FROM vendas A
           JOIN vendas_produtos B ON B.id_venda = A.id
           LEFT JOIN vendas_operacoes O ON O.id = A.id_operacao
           LEFT JOIN produtos P ON P.id = B.id_produto
           LEFT JOIN vendedores V1 ON V1.id = A.id_vendedor1
          WHERE A.id_grupo = ? AND A.id_empresa = ? AND A.id_cliente = ? AND O.codigo = 'PED' AND COALESCE(B.faturado,'N') = 'N'
            AND A.status IN ('F','P') AND A.data_venda BETWEEN ? AND ?
          ORDER BY A.data_venda, A.serie, A.numero, B.item`,
        [grupoDe(res), empresaDe(res), v.id_cliente, d1, d2],
      );
      return { cliente: { id: v.id_cliente, nome: txt((await um(pool, 'SELECT nome FROM pessoas WHERE id = ?', [v.id_cliente]))?.nome) }, linhas };
    }),
  );

  router.post(
    '/vendas/:id(\\d+)/pedidos',
    rota(async (req, res) =>
      em(res, async (c) => {
        const v = await lerVenda(c, res, id(req), true);
        exigirAberta(v);
        if (v.operacao_codigo !== 'VEN') throw recusar('Este registro não é uma Venda!');
        const linhas = Array.isArray(req.body?.linhas) ? req.body.linhas : [];
        if (!linhas.length) throw recusar('Marque ao menos um produto para capturar.');
        const pedidos = new Set<number>();
        for (const l of linhas) {
          const o = await um(
            c,
            `SELECT B.*, P.referencia referencia_produto, A.id id_pedido, A.id_vendedor1, A.id_vendedor2
               FROM vendas_produtos B JOIN vendas A ON A.id = B.id_venda LEFT JOIN produtos P ON P.id = B.id_produto
               LEFT JOIN vendas_operacoes O ON O.id = A.id_operacao
              WHERE B.id = ? AND A.id_grupo = ? AND A.id_empresa = ? AND A.id_cliente = ? AND O.codigo = 'PED' AND A.status IN ('F','P') FOR UPDATE`,
            [n(l.id_vendas_produtos), grupoDe(res), empresaDe(res), v.id_cliente],
          );
          if (!o) throw recusar('Produto do pedido não encontrado.');
          const naoFaturar = arred(n(l.qtd_nao_faturar), 3);
          if (naoFaturar > n(o.qtdade)) throw recusar('Qtdade. devolvida maior que quantidade do pedido!');
          const qtd = arred(n(o.qtdade) - naoFaturar, 3);
          if (qtd <= 0) continue;
          await capturarItem(c, v.id, o, qtd, n(o.qtdade) ? n(o.valor_total_liquido) / n(o.qtdade) : 0);
          await c.query("UPDATE vendas_produtos SET qtdade_devol = COALESCE(qtdade_devol,0) + ?, faturado = 'S' WHERE id = ?", [qtd, o.id]);
          pedidos.add(o.id_pedido);
        }
        // Pedido marcado se ao menos um item foi capturado (no Delphi dependia da última linha)
        for (const p of pedidos) await c.query("UPDATE vendas SET pedido_status = 'C', status = 'P' WHERE id = ?", [p]);
        await totalizar(c, res, v.id);
        return { pedidos: [...pedidos] };
      }),
    ),
  );

  rotasNFe(router);
  return router;
}

export type { Contexto };
