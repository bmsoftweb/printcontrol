import { Router, Request, Response, NextFunction } from 'express';
import type { PoolConnection } from 'mysql2/promise';
import { pool, comUsuario, gravarLog, type Contexto } from './db.js';
import { contexto, temNivel, friendlyDbError } from './crud.js';
import { registrarRegras, recusar } from './regras.js';
import { gerarPdf } from './pdf.js';
import { enviarEmail, enderecos } from './email.js';
import {
  bancoEmiteBoleto,
  CSS_FICHA,
  dataBr,
  extenso,
  fichaCompensacaoHtml,
  gerarBoleto,
  mascaraDoc,
  moedaBr,
  soDigitos,
  strzero,
} from './boletos.js';
import { BANCOS_CNAB, gerarRemessa, lerRetorno } from './cnab.js';

/*
 * Telas Faturamento (ufrmFatur), Financeiro / Contas a Receber (ufrmReceber) e Geração / Impressão de Boleto
 * de parcelas de venda (ufrmImpressaoBoletoNew). Tudo nível A, como os itens de menu do Delphi.
 */

type Linha = Record<string, any>;
type Executor = Pick<PoolConnection, 'query'>;

const G = (res: Response) => Number(res.locals.grupoId);
const E = (res: Response) => Number(res.locals.empresaId);

/** Data e hora de Brasília (aaaa-mm-dd, hhmmss) — nunca toISOString() */
export function agoraBrasilia() {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  return { data: s.slice(0, 10), hora: s.slice(11, 19).replace(/:/g, '') };
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const num = (v: unknown) => Number(v ?? 0) || 0;
const inteiroBr = (v: unknown) => num(v).toLocaleString('pt-BR');
const SQL_LIMPA_BOLETO = `boleto_codigo_barras = '', boleto_linha_digitavel = '', boleto_nosso_numero = '', boleto_nosso_numero_dig = '', boleto_enviado = 'N'`;

/** Envolve a rota: erro vira JSON { error } com a mensagem para o operador */
const rota = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    if (!res.headersSent) res.status(err.status || 400).json({ error: friendlyDbError(err, 'nota') });
  }
};

function enviarArquivo(res: Response, dados: Buffer, tipo: string, nome: string, inline = false) {
  res.setHeader('Content-Type', tipo);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${nome}"`);
  res.send(dados);
}

// ---------------------------------------------------------------- consultas comuns

/** Juros/multa do contas a receber (config). Corrige o OR do Delphi, que podia pegar a config de outro grupo */
export async function configReceber(grupo: number, empresa: number) {
  const [[c]] = await pool.query<any[]>(
    `SELECT areceber_juros_mes, areceber_multa FROM config
      WHERE id_grupo = ? AND (id_empresa = ? OR id_empresa IS NULL OR id_empresa = 0)
      ORDER BY id_empresa DESC LIMIT 1`,
    [grupo, empresa],
  );
  return { jurosMes: num(c?.areceber_juros_mes), multa: num(c?.areceber_multa) };
}

/** Juros por dia em reais, truncado em centavos como o campo valor_juros_dia do Delphi (que usava 6% fixo) */
export const jurosDia = (valor: unknown, jurosMes: number) => Math.trunc((num(valor) * jurosMes) / 30 + 1e-9) / 100;

async function empresaDados(empresa: number) {
  const [[e]] = await pool.query<any[]>(
    `SELECT E.*, G.nome AS grupo_nome FROM empresas_filiais E LEFT JOIN empresas_grupos G ON G.id = E.id_grupo WHERE E.id = ?`,
    [empresa],
  );
  if (!e) throw recusar('Empresa não encontrada.', 404);
  return e as Linha;
}

const SQL_NOTAS = `
  SELECT N.*, P.nome, P.fantasia, P.endereco, P.endereco_nr, P.endereco_complemento, P.endereco_bairro, P.endereco_uf,
         P.endereco_cep, P.endereco_cidade, P.cpf_cnpj, P.rg, P.email, P.obs_nf,
         B.cod_banco, B.apelido AS banco_apelido, L.descricao AS plano_descricao,
         L.modelo_nf AS modelo_nf_plano, S.modelo_nf AS modelo_nf_serie, F.obs AS fatur_obs, EF.apelido AS empresa_apelido
    FROM fatur_notas N
    LEFT JOIN pessoas P ON P.id = N.id_cliente
    LEFT JOIN fatur_planos L ON L.id = N.id_plano AND L.id_grupo = N.id_grupo
    LEFT JOIN fatur_series S ON S.id = N.serie AND S.id_grupo = N.id_grupo AND S.id_empresa = N.id_empresa
    LEFT JOIN bancos B ON B.id = N.id_banco
    LEFT JOIN fatur F ON F.id = N.id_fatur
    LEFT JOIN empresas_filiais EF ON EF.id = N.id_empresa`;

/** Nota do grupo (e da empresa, quando informada) ou 404 */
async function notaDoGrupo(db: Executor, id: unknown, grupo: number, empresa?: number, travar = false): Promise<Linha> {
  const [[n]] = await db.query<any[]>(
    `${SQL_NOTAS} WHERE N.id = ? AND N.id_grupo = ?${empresa ? ' AND N.id_empresa = ?' : ''}${travar ? ' FOR UPDATE' : ''}`,
    empresa ? [Number(id), grupo, empresa] : [Number(id), grupo],
  );
  if (!n) throw recusar('Nota não encontrada.', 404);
  return n;
}

// ---------------------------------------------------------------- pré-faturamento (TEMP_FATUR em memória)

export interface LeituraPre {
  id: number;
  id_contrato: number;
  id_cliente: number;
  nome: string;
  data_leitura: string;
  data_vencimento: string;
  id_equip: number;
  setor: string;
  equip_marca: string;
  equip_modelo: string;
  equip_descricao: string;
  nr_serie: string;
  obs: string;
  leitura_anterior: number;
  leitura_atual: number;
  nr_copias_mes: number;
  nr_copias_contrato: number;
  nr_copias_excedente: number;
  valor_copia_unit: string;
  valor_copia_unit_excedente: string;
  valor_copia_total: string;
  valor_copia_total_excedente: string;
  valor_total_geral: string;
  juntar_nota: string;
  serie_nf: string;
  id_banco: number;
  id_plano: string;
}

export interface NotaPre {
  chave: string;
  id_cliente: number;
  nome: string;
  equip_descricao: string;
  data_vencimento: string;
  serie_nf: string;
  id_banco: number;
  id_plano: string;
  contagem: number;
  total_geral: number;
  leituras: LeituraPre[];
}

/**
 * Agrupa as leituras em notas como o qrPreFatur_notas: 1 nota = cliente + vencimento + série do contrato,
 * juntando as leituras de contratos com juntar_nota = 'S'; as demais viram nota própria.
 */
export function agruparNotas(leituras: LeituraPre[]): NotaPre[] {
  const mapa = new Map<string, NotaPre>();
  for (const l of leituras) {
    const flagNota = l.juntar_nota === 'S' ? '000000000' : strzero(l.id, 9);
    const chave = [strzero(l.id_cliente, 9), flagNota, String(l.data_vencimento ?? '').slice(0, 10), l.serie_nf ?? ''].join('|');
    let n = mapa.get(chave);
    if (!n) {
      n = {
        chave,
        id_cliente: l.id_cliente,
        nome: l.nome ?? '',
        equip_descricao: l.equip_descricao ?? '',
        data_vencimento: String(l.data_vencimento ?? '').slice(0, 10),
        serie_nf: l.serie_nf ?? '',
        id_banco: l.id_banco,
        id_plano: l.id_plano,
        contagem: 0,
        total_geral: 0,
        leituras: [],
      };
      mapa.set(chave, n);
    }
    n.contagem++;
    n.total_geral = Math.round((n.total_geral + num(l.valor_total_geral)) * 100) / 100;
    n.leituras.push(l);
  }
  const ordem = (n: NotaPre) => [n.nome, n.chave.split('|')[1], n.data_vencimento, n.serie_nf];
  return [...mapa.values()].sort((a, b) => {
    const [x, y] = [ordem(a), ordem(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  });
}

async function leiturasAFaturar(db: Executor, grupo: number, empresa: number, f: { cliente?: number; codigoGrupo?: string; ids?: number[] }, travar = false) {
  const where = [`L.status_fatur = 'N'`, 'C.id_grupo = ?', 'C.id_empresa = ?'];
  const params: any[] = [grupo, empresa];
  if (f.cliente) where.push('L.id_cliente = ?') && params.push(f.cliente);
  if (f.codigoGrupo) where.push('L.codigo_grupo = ?') && params.push(f.codigoGrupo);
  if (f.ids) where.push(f.ids.length ? `L.id IN (${f.ids.map(() => '?').join(',')})` : '1 = 0') && params.push(...f.ids);
  const [rows] = await db.query<any[]>(
    `SELECT L.id, L.id_contrato, L.id_cliente, P.nome, L.data_leitura, L.data_vencimento, C.id_equip, C.setor,
            M.descricao AS equip_marca, EQ.modelo AS equip_modelo, EQ.descricao AS equip_descricao, L.nr_serie, L.obs,
            L.leitura_anterior, L.leitura_atual, L.nr_copias_mes, L.nr_copias_contrato, L.nr_copias_excedente,
            L.valor_copia_unit, L.valor_copia_unit_excedente, L.valor_copia_total, L.valor_copia_total_excedente,
            L.valor_total_geral, C.juntar_nota, COALESCE(C.serie_nf, '') AS serie_nf, P.id_banco, P.id_plano
       FROM locacao_leituras L
       JOIN locacao_contratos C ON C.id = L.id_contrato
       LEFT JOIN equipamentos EQ ON EQ.id = C.id_equip
       LEFT JOIN equipamentos_marcas M ON M.id = EQ.id_marca
       LEFT JOIN pessoas P ON P.id = L.id_cliente
      WHERE ${where.join(' AND ')}
      ORDER BY P.nome, L.id_cliente, L.id${travar ? ' FOR UPDATE' : ''}`,
    params,
  );
  return rows as LeituraPre[];
}

// ---------------------------------------------------------------- boleto da nota

/** Gera o boleto da nota (dentro da transação): incrementa o nosso número do banco e grava código/linha */
async function gerarBoletoNota(conn: Executor, id: unknown, grupo: number): Promise<Linha> {
  const nota = await notaDoGrupo(conn, id, grupo, undefined, true);
  if (nota.boleto_codigo_barras) return nota;
  if (String(nota.id_plano ?? '').trim().toUpperCase() !== 'BO') throw recusar('Plano desta nota não é boleto!');
  if (nota.cancelado === 'S') throw recusar('NF cancelada!');
  const [[b]] = await conn.query<any[]>('SELECT * FROM bancos WHERE id = ? AND id_grupo = ? FOR UPDATE', [nota.id_banco, grupo]);
  if (!b) throw recusar('Informe o banco da nota antes de gerar o boleto.');
  if (!bancoEmiteBoleto(b.cod_banco)) throw recusar(`O banco ${b.apelido} (${b.cod_banco || 'sem código'}) não emite boleto neste sistema (só 001, 033 e 085).`);
  const nosso = num(b.ultimo_nosso_numero) + 1;
  const boleto = gerarBoleto(b, { nossoNumero: nosso, vencimento: nota.data_vencimento, valor: nota.total_liquido });
  await conn.query('UPDATE bancos SET ultimo_nosso_numero = ? WHERE id = ?', [nosso, b.id]);
  await conn.query(
    'UPDATE fatur_notas SET boleto_codigo_barras = ?, boleto_linha_digitavel = ?, boleto_nosso_numero = ?, boleto_nosso_numero_dig = ? WHERE id = ?',
    [boleto.codigoBarras, boleto.linhaDigitavel, boleto.nossoNumero, boleto.nossoNumeroDig, nota.id],
  );
  return { ...nota, boleto_codigo_barras: boleto.codigoBarras, boleto_linha_digitavel: boleto.linhaDigitavel, boleto_nosso_numero: boleto.nossoNumero, boleto_nosso_numero_dig: boleto.nossoNumeroDig };
}

/**
 * Alteração de nota (vencimento, valor, banco, plano) com a regra do boleto: trocar o banco limpa o boleto
 * (BeforePost do Delphi); mudar valor ou vencimento também limpa (o Delphi deixava o código de barras
 * desatualizado) e é recusado se o boleto já foi para o banco na remessa.
 */
export function ajustarAlteracaoNota(atual: Linha, novo: Linha): { limparBoleto: boolean } {
  if (atual.status !== 'A' || atual.cancelado === 'S') throw recusar('Só notas "A RECEBER" podem ser alteradas.');
  const mudou = (c: string, f = (v: unknown) => String(v ?? '')) => c in novo && f(novo[c]) !== f(atual[c]);
  const valorOuVenc = mudou('total_liquido', (v) => num(v).toFixed(2)) || mudou('data_vencimento', (v) => String(v ?? '').slice(0, 10));
  const temBoleto = Boolean(atual.boleto_codigo_barras);
  if (valorOuVenc && temBoleto && atual.boleto_enviado === 'S') {
    throw recusar('O boleto desta nota já foi enviado ao banco na remessa: para mudar valor ou vencimento, use "Limpar dados do boleto" antes (e dê a instrução de alteração no banco).');
  }
  return { limparBoleto: temBoleto && (valorOuVenc || mudou('id_banco', (v) => String(num(v)))) };
}

// CRUD genérico de fatur_notas segue as mesmas regras das telas
registrarRegras('fatur_notas', {
  async antesDeGravar(payload, id, ctx) {
    if (!id) return;
    const atual = await notaDoGrupo(pool, id, ctx.grupoId!, ctx.empresaId!);
    if (ajustarAlteracaoNota(atual, payload).limparBoleto) {
      Object.assign(payload, { boleto_codigo_barras: '', boleto_linha_digitavel: '', boleto_nosso_numero: '', boleto_nosso_numero_dig: '', boleto_enviado: 'N' });
    }
  },
  async antesDeExcluir(id, ctx) {
    const n = await notaDoGrupo(pool, id, ctx.grupoId!, ctx.empresaId!);
    if (n.status !== 'A') throw recusar('Só títulos em aberto podem ser excluídos.');
    if (n.boleto_codigo_barras) throw recusar('A nota tem boleto gerado: exclua pela tela Financeiro, que pede a confirmação.');
    await comUsuario(ctx, (c) => c.query('DELETE FROM fatur_notas_produtos WHERE id_nota = ?', [id]));
  },
});

// ---------------------------------------------------------------- Nota de Débito de Locação (PDF)

const CSS_NF = `
@page{size:A4;margin:9mm}
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;font-size:8.5pt;color:#000;margin:0}
h1{font-size:12pt;margin:0}
.cx{border:0.8pt solid #000;padding:1.5mm 2mm;margin-bottom:2mm}
.lin{display:flex;gap:3mm}
.r{font-size:6.5pt;color:#333;text-transform:uppercase}
.v{font-weight:bold}
table.itens{width:100%;border-collapse:collapse;font-size:7.5pt}
table.itens th{background:#eee;border:0.6pt solid #000;padding:1mm;font-size:6.5pt}
table.itens td{border:0.6pt solid #000;padding:0.8mm 1mm}
.n{text-align:right;white-space:nowrap}
.c{text-align:center}
.total{font-size:12pt;font-weight:bold}
.recibo{border:0.8pt solid #000;padding:3mm;margin-top:4mm;font-size:9pt;line-height:1.5}
${CSS_FICHA}`;

export interface DadosNf {
  nota: Linha;
  produtos: Linha[];
  empresa: Linha;
  banco: Linha | null;
  jurosMes: number;
  multa: number;
  /** Data de hoje (recibo) */
  hoje: string;
}

/** Nota de Débito de Locação de Bens Móveis (nf_modelo*.fr3): com ficha de compensação, sem boleto ou com recibo */
export function htmlNotaDebito(d: DadosNf): string {
  const { nota: n, empresa: e } = d;
  const modelo = String(n.modelo_nf_plano || n.modelo_nf_serie || '').toLowerCase();
  const comFicha = Boolean(n.boleto_codigo_barras) && d.banco && !modelo.includes('sem_boleto');
  const comRecibo = modelo.includes('recibo');
  const enderecoEmit = [e.endereco, e.numero, e.bairro].filter(Boolean).join(', ');
  const cidadeEmit = [e.cidade, e.uf].filter(Boolean).join(' - ');
  const enderecoCli = [n.endereco, n.endereco_nr, n.endereco_complemento, n.endereco_bairro].filter(Boolean).join(' ');
  const juros = jurosDia(n.total_liquido, d.jurosMes);
  const instrucoes = [
    juros > 0 || d.multa > 0
      ? `APÓS O VENCIMENTO COBRAR${juros > 0 ? ` R$ ${moedaBr(juros)} DE JUROS AO DIA` : ''}${juros > 0 && d.multa > 0 ? ' E' : ''}${d.multa > 0 ? ` ${moedaBr(d.multa).replace(/,00$/, '')}% DE MULTA` : ''}`
      : '',
    `Ref. NF ${n.numero} - ${n.fatur_obs ?? ''}`,
  ].filter(Boolean);
  const itens = d.produtos
    .map(
      (p) => `<tr><td class="c">${esc(p.id_equip)}</td><td>${esc(p.descricao)}${p.nr_serie ? ` / ${esc(p.nr_serie)}` : ''}</td><td>${esc(p.setor)}</td>
      <td class="n">${inteiroBr(p.leitura_anterior)}</td><td class="n">${inteiroBr(p.leitura_atual)}</td><td class="n">${inteiroBr(p.nr_copias)}</td>
      <td class="n">${inteiroBr(p.nr_copias_contrato)}</td><td class="n">${inteiroBr(p.nr_copias_exced)}</td><td class="n">${moedaBr(p.valor_unit_copia)}</td>
      <td class="n">${moedaBr(p.valor_total_exced)}</td><td class="n">${moedaBr(p.valor_liquido)}</td></tr>`,
    )
    .join('');
  const recibo = (via: string) => `<div class="recibo">
    <div style="display:flex;justify-content:space-between"><b>RECIBO</b><span>${via}</span></div>
    Recibo de pagamento de locação de bens móveis ref. NF: <b>${esc(n.numero)}</b><br>
    Recebemos de <b>${esc(n.nome)}</b> a importância de <b>R$ ${moedaBr(n.total_liquido)}</b> (${esc(extenso(n.total_liquido))}),
    referente A LOCAÇÃO DE IMPRESSORA(S) COM VENCIMENTO EM ${dataBr(n.data_vencimento)}.<br><br>
    ${esc(e.cidade || '')}, ${dataBr(d.hoje)}<br><br>ASSINATURA EMITENTE: ________________________________________</div>`;
  const ficha =
    comFicha && d.banco
      ? fichaCompensacaoHtml({
          banco: d.banco as any,
          beneficiario: { nome: e.razao_social || e.nome_comercial, documento: e.cnpj },
          pagador: {
            nome: n.nome,
            documento: n.cpf_cnpj,
            endereco: enderecoCli,
            cidadeUf: [n.endereco_cidade, n.endereco_uf].filter(Boolean).join(' - '),
            cep: n.endereco_cep,
          },
          numeroDocumento: String(n.numero),
          dataDocumento: n.data_nota,
          vencimento: n.data_vencimento,
          valor: n.total_liquido,
          nossoNumero: n.boleto_nosso_numero,
          nossoNumeroDig: n.boleto_nosso_numero_dig,
          codigoBarras: n.boleto_codigo_barras,
          linhaDigitavel: n.boleto_linha_digitavel,
          instrucoes,
        })
      : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>NF ${esc(n.numero)}</title><style>${CSS_NF}</style></head><body>
  <div class="cx lin" style="justify-content:space-between;align-items:flex-start">
    <div><h1>Nota de Débito de Locação de Bens Móveis Nr: ${esc(n.numero)}</h1>
      <div style="margin-top:1.5mm"><b>${esc(e.razao_social || e.nome_comercial)}</b><br>${esc(enderecoEmit)}${e.cep ? ` - CEP ${esc(e.cep)}` : ''}<br>${esc(cidadeEmit)}<br>
      CNPJ: ${esc(mascaraDoc(e.cnpj))}${e.ie ? ` &nbsp; IE: ${esc(e.ie)}` : ''}${e.email_financeiro ? `<br>${esc(e.email_financeiro)}` : ''}</div>
      <div style="margin-top:1.5mm">Data de Emissão: <b>${dataBr(n.data_nota)}</b> &nbsp; Série: ${esc(n.serie)}</div></div>
    <div class="cx" style="min-width:52mm;text-align:right;margin:0">
      <div class="r">Total a Pagar</div><div class="total">R$ ${moedaBr(n.total_liquido)}</div>
      <div class="r" style="margin-top:1.5mm">Vencimento</div><div class="total">${dataBr(n.data_vencimento)}</div></div>
  </div>
  <div class="cx">
    <div><span class="r">Cliente </span><span class="v">${esc(n.nome)}</span></div>
    <div><span class="r">Endereço </span>${esc(enderecoCli)}</div>
    <div class="lin"><div><span class="r">Cidade </span>${esc([n.endereco_cidade, n.endereco_uf].filter(Boolean).join(' - '))}${n.endereco_cep ? ` CEP ${esc(n.endereco_cep)}` : ''}</div>
      <div><span class="r">CNPJ/CPF </span>${esc(mascaraDoc(n.cpf_cnpj))}</div></div>
  </div>
  <div class="cx"><span class="r">Observações</span><br>Conforme LC Federal 116/03 a atividade de locação de bens não está sujeita ao ICMS e nem ao imposto municipal do ISQN.
    Parcela referente locação de máquinas fotocopiadoras sem operador. Locação ${esc(n.fatur_obs ?? '')}${n.obs_nf ? `<br>${esc(n.obs_nf)}` : ''}</div>
  <table class="itens"><thead><tr><th>ID</th><th>Equipamento / Série</th><th>Setor</th><th>Leitura Anterior</th><th>Leitura Atual</th><th>Número Cópias</th>
    <th>Cópias Contrato</th><th>Cópias Exced.</th><th>Valor Unit.</th><th>Valor Exced.</th><th>Valor Total R$</th></tr></thead>
    <tbody>${itens}</tbody>
    <tfoot><tr><td colspan="10" class="n"><b>TOTAL</b></td><td class="n"><b>${moedaBr(n.total_liquido)}</b></td></tr></tfoot></table>
  ${comRecibo ? recibo('1ª via') + recibo('2ª via') : ''}
  ${ficha ? `<div style="margin-top:6mm">${ficha}</div>` : ''}
  </body></html>`;
}

/** Monta o PDF da nota (gera o boleto antes, se o plano for boleto e ainda não houver) */
async function pdfDaNota(id: unknown, res: Response): Promise<{ pdf: Buffer; nota: Linha; nome: string }> {
  const grupo = G(res);
  let nota = await notaDoGrupo(pool, id, grupo, E(res));
  if (String(nota.id_plano).trim().toUpperCase() === 'BO' && !nota.boleto_codigo_barras && nota.cancelado !== 'S') {
    nota = await comUsuario(contexto(res), (c) => gerarBoletoNota(c, nota.id, grupo));
  }
  const [produtos] = await pool.query<any[]>(
    `SELECT P.*, EQ.nr_serie FROM fatur_notas_produtos P LEFT JOIN equipamentos EQ ON EQ.id = P.id_equip WHERE P.id_nota = ? ORDER BY P.id_equip`,
    [nota.id],
  );
  const [[banco]] = await pool.query<any[]>('SELECT * FROM bancos WHERE id = ? AND id_grupo = ?', [nota.id_banco, grupo]);
  const cfg = await configReceber(grupo, nota.id_empresa);
  const html = htmlNotaDebito({ nota, produtos, empresa: await empresaDados(nota.id_empresa), banco: banco ?? null, jurosMes: cfg.jurosMes, multa: cfg.multa, hoje: agoraBrasilia().data });
  return { pdf: await gerarPdf(html), nota, nome: `nf_${nota.serie}_${strzero(nota.numero, 6)}.pdf` };
}

// ---------------------------------------------------------------- e-mails (grupos\<id>\cfg\emailNF*.txt)

const MODELO_EMAIL_NF = `<html><body>Bom dia, @contato,<br><br>Segue em anexo NF @nr_nf, ref: @ref.<br>@comentario<br>
<br>Por favor, confirme o recebimento dos anexos.<br><br>Dúvidas, estaremos à disposição.<br><br>Atenciosamente,<br>
<br>________________________________<br>@nome_empresa<br>@nome_usuario</body></html>`;
const MODELO_EMAIL_CANCELADA = `<html><body>Bom dia, @contato,<br><br>Informamos que a NF @nr_nf, ref: @ref foi CANCELADA !<br>@comentario<br>
<br>Dúvidas, estaremos à disposição.<br><br>Atenciosamente,<br>
<br>________________________________<br>@nome_empresa<br>@nome_usuario</body></html>`;

function corpoEmail(modelo: string, n: Linha, grupoNome: string, usuario: string) {
  const v: Record<string, string> = {
    '@nome_empresa': grupoNome,
    '@nome_usuario': usuario,
    '@nr_nf': String(n.numero),
    '@ref': n.fatur_obs ?? '',
    '@comentario': '',
    '@nome_cliente': n.nome ?? '',
    '@contato': 'Depto. Financeiro',
  };
  return modelo.replace(/@\w+/g, (k) => (k in v ? esc(v[k]) : k));
}

async function enviarNfPorEmail(id: unknown, res: Response) {
  const { pdf, nota, nome } = await pdfDaNota(id, res);
  if (nota.cancelado === 'S') throw recusar('NF cancelada!');
  if (!enderecos(nota.email).length) throw recusar(`O cliente ${nota.nome} não tem e-mail válido no cadastro.`);
  const empresa = await empresaDados(nota.id_empresa);
  const grupoNome = empresa.grupo_nome || empresa.nome_comercial || '';
  await enviarEmail({
    para: nota.email,
    assunto: `${grupoNome} - Nota Fiscal de Serviço de Locação de Impressora`,
    html: corpoEmail(MODELO_EMAIL_NF, nota, grupoNome, res.locals.usuario?.nome ?? ''),
    nomeRemetente: grupoNome,
    responderPara: empresa.email_financeiro || undefined,
    anexos: [{ filename: nome, content: pdf, contentType: 'application/pdf' }],
  });
  await comUsuario(contexto(res), (c) => c.query(`UPDATE fatur_notas SET status_email = 'E', datahora_email = NOW() WHERE id = ?`, [nota.id]));
  return nota;
}

// ---------------------------------------------------------------- retorno

async function lerRetornoComTitulos(body: any, grupo: number) {
  const [[banco]] = await pool.query<any[]>('SELECT * FROM bancos WHERE id = ? AND id_grupo = ?', [Number(body?.id_banco), grupo]);
  if (!banco) throw recusar('Escolha um layout');
  const conteudo = String(body?.conteudo ?? '');
  if (!conteudo.trim()) throw recusar('Arquivo de retorno vazio.');
  const registros = lerRetorno(conteudo, banco.codigos_retorno, banco.codigos_retorno_erros);
  const saida = [];
  for (const r of registros) {
    // Pelo id gravado na remessa (uso da empresa); sem ele, pelo nosso número
    const [[t]] = await pool.query<any[]>(
      `SELECT A.id, A.id_cliente, P.cpf_cnpj, P.nome, P.fantasia, A.status, A.total_liquido
         FROM fatur_notas A LEFT JOIN pessoas P ON P.id = A.id_cliente
        WHERE A.id_grupo = ? AND ${r.idNota ? 'A.id = ?' : "A.boleto_nosso_numero = ? AND A.boleto_nosso_numero <> ''"} LIMIT 1`,
      [grupo, r.idNota ?? r.nossoNumero],
    );
    saida.push({
      ...r,
      idNota: t?.id ?? r.idNota,
      encontrado: Boolean(t),
      statusTitulo: t?.status ?? null,
      nomePagador: t ? t.fantasia || t.nome : r.nomePagador,
      cnpj: t ? t.cpf_cnpj : r.cnpj,
      status: 'A' as 'A' | 'P',
      obs: t ? r.obs : 'TITULO NÃO ENCONTRADO NO SISTEMA',
    });
  }
  return { banco, registros: saida };
}

// ---------------------------------------------------------------- boletos de parcelas de venda (areceber)

const SQL_ARECEBER = `
  SELECT A.*, E.razao_social AS cedente_nome, E.nome_comercial AS cedente_nome_fantasia, E.cnpj AS cedente_cnpj,
         B.nome AS sacado_nome, B.fantasia AS sacado_nome_fantasia, B.endereco AS sacado_endereco, B.endereco_nr AS sacado_endereco_nr,
         B.endereco_bairro AS sacado_bairro, B.endereco_cidade AS sacado_cidade, B.endereco_uf AS sacado_uf, B.endereco_cep AS sacado_cep,
         B.fone_fixo AS sacado_telefone, B.cpf_cnpj AS sacado_cnpj,
         ROUND((A.multa_perc / 100) * A.valor_areceber, 2) AS valor_multa,
         ROUND((A.juros_perc_mes / 100 / 30) * A.valor_areceber, 2) AS valor_mora_juros,
         ROUND((A.desconto_perc_mes / 100 / 30) * A.valor_areceber, 2) AS valor_desconto,
         C.emite_boleto, C.cod_banco, C.apelido AS banco_apelido
    FROM areceber A
    LEFT JOIN pessoas B ON B.id = A.id_cliente
    LEFT JOIN empresas_filiais E ON E.id = A.id_empresa
    LEFT JOIN bancos C ON C.id = A.id_banco`;

/** Gera o boleto de uma parcela de venda (frmImpressaoBoletoNew: só Santander no Delphi; aqui os 3 bancos) */
export async function gerarBoletoAreceber(conn: Executor, id: unknown, grupo: number, empresa: number): Promise<Linha> {
  const [[a]] = await conn.query<any[]>(`${SQL_ARECEBER} WHERE A.id = ? AND A.id_grupo = ? AND A.id_empresa = ? FOR UPDATE`, [Number(id), grupo, empresa]);
  if (!a) throw recusar('Parcela não encontrada.', 404);
  if (a.boleto_codigo_barras) return a;
  if (a.emite_boleto !== 'S') throw recusar('Esta parcela não é boleto!');
  const [[b]] = await conn.query<any[]>('SELECT * FROM bancos WHERE id = ? AND id_grupo = ? FOR UPDATE', [a.id_banco, grupo]);
  if (!b || !bancoEmiteBoleto(b.cod_banco)) throw recusar(`O banco da parcela não emite boleto neste sistema (só 001, 033 e 085).`);
  const nosso = num(b.ultimo_nosso_numero) + 1;
  const boleto = gerarBoleto(b, { nossoNumero: nosso, vencimento: a.data_vencimento, valor: a.valor_areceber });
  await conn.query('UPDATE bancos SET ultimo_nosso_numero = ? WHERE id = ?', [nosso, b.id]);
  await conn.query('UPDATE areceber SET boleto_codigo_barras = ?, boleto_linha_digitavel = ?, boleto_nosso_numero = ?, boleto_nosso_numero_dig = ? WHERE id = ?', [
    boleto.codigoBarras,
    boleto.linhaDigitavel,
    boleto.nossoNumero,
    boleto.nossoNumeroDig,
    a.id,
  ]);
  return { ...a, boleto_codigo_barras: boleto.codigoBarras, boleto_linha_digitavel: boleto.linhaDigitavel, boleto_nosso_numero: boleto.nossoNumero, boleto_nosso_numero_dig: boleto.nossoNumeroDig };
}

/** Fichas de compensação das parcelas (boleto_santander.fr3, com os dados da empresa no lugar dos fixos) */
export async function htmlBoletosAreceber(parcelas: Linha[], grupo: number): Promise<string> {
  const fichas: string[] = [];
  for (const a of parcelas) {
    if (!a.boleto_codigo_barras) continue;
    const [[b]] = await pool.query<any[]>('SELECT * FROM bancos WHERE id = ? AND id_grupo = ?', [a.id_banco, grupo]);
    if (!b) continue;
    const instrucoes = [
      num(a.valor_mora_juros) > 0 ? `APÓS O VENCIMENTO COBRAR R$ ${moedaBr(a.valor_mora_juros)} DE JUROS AO DIA` : '',
      num(a.valor_multa) > 0 ? `MULTA DE R$ ${moedaBr(a.valor_multa)} APÓS O VENCIMENTO` : '',
      num(a.valor_desconto) > 0 ? `DESCONTO DE R$ ${moedaBr(a.valor_desconto)} AO DIA DE ANTECIPAÇÃO` : '',
      a.obs1, a.obs2, a.obs3, a.obs4, a.obs5,
    ].filter(Boolean);
    fichas.push(
      fichaCompensacaoHtml({
        banco: b,
        beneficiario: { nome: a.cedente_nome || a.cedente_nome_fantasia || '', documento: a.cedente_cnpj },
        pagador: {
          nome: a.sacado_nome,
          documento: a.sacado_cnpj,
          endereco: [a.sacado_endereco, a.sacado_endereco_nr, a.sacado_bairro].filter(Boolean).join(' '),
          cidadeUf: [a.sacado_cidade, a.sacado_uf].filter(Boolean).join(' - '),
          cep: a.sacado_cep,
        },
        numeroDocumento: `${a.documento ?? ''}/${strzero(a.parcelas_nr, 3)}`,
        dataDocumento: a.data_venda,
        vencimento: a.data_vencimento,
        valor: a.valor_areceber,
        nossoNumero: a.boleto_nosso_numero,
        nossoNumeroDig: a.boleto_nosso_numero_dig,
        codigoBarras: a.boleto_codigo_barras,
        linhaDigitavel: a.boleto_linha_digitavel,
        instrucoes,
      }),
    );
  }
  if (!fichas.length) throw recusar('Nenhuma parcela com boleto gerado para imprimir.');
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:10mm}body{margin:0}.pg{page-break-inside:avoid;margin-bottom:10mm}${CSS_FICHA}</style></head><body>${fichas
    .map((f) => `<div class="pg">${f}</div>`)
    .join('')}</body></html>`;
}

// ================================================================ rotas

export function createFaturamentoRouter() {
  const router = Router();
  const soAdmin = (_req: Request, res: Response, next: NextFunction) =>
    temNivel(res, 'A') ? next() : res.status(403).json({ error: 'Somente administradores acessam esta opção.' });
  router.use(['/faturamento', '/financeiro', '/boletos-areceber'], soAdmin);

  // ------------------------------------------------ apoio: combos do grupo
  router.get(
    '/faturamento/opcoes',
    rota(async (_req, res) => {
      const [bancos] = await pool.query<any[]>('SELECT id, apelido, cod_banco, emite_boleto FROM bancos WHERE id_grupo = ? ORDER BY apelido', [G(res)]);
      const [planos] = await pool.query<any[]>('SELECT id, descricao FROM fatur_planos WHERE id_grupo = ? ORDER BY descricao', [G(res)]);
      const [clientes] = await pool.query<any[]>("SELECT id, nome FROM pessoas WHERE id_grupo = ? AND COALESCE(cliente_flag, 'S') <> 'N' ORDER BY nome", [G(res)]);
      res.json({ bancos, planos, clientes });
    }),
  );

  // ------------------------------------------------ faturamentos e notas
  router.get(
    '/faturamento/fatur',
    rota(async (_req, res) => {
      const [rows] = await pool.query<any[]>(
        `SELECT F.id, F.data_fatur, F.obs, (SELECT COUNT(*) FROM fatur_notas N WHERE N.id_fatur = F.id) AS notas
           FROM fatur F WHERE F.id_grupo = ? AND F.id_empresa = ? ORDER BY F.data_fatur DESC, F.id DESC LIMIT 2000`,
        [G(res), E(res)],
      );
      res.json(rows);
    }),
  );

  router.put(
    '/faturamento/fatur/:id',
    rota(async (req, res) => {
      const obs = String(req.body?.obs ?? '').slice(0, 255);
      const [r] = await comUsuario(contexto(res), (c) => c.query<any>('UPDATE fatur SET obs = ? WHERE id = ? AND id_grupo = ? AND id_empresa = ?', [obs, Number(req.params.id), G(res), E(res)]));
      if (!r.affectedRows) throw recusar('Faturamento não encontrado.', 404);
      res.json({ success: true });
    }),
  );

  /** Notas do faturamento (?fatur=id) ou todas da empresa (?tudo=1 — "Listar Tudo", agora só do grupo/empresa) */
  router.get(
    '/faturamento/notas',
    rota(async (req, res) => {
      const tudo = req.query.tudo === '1';
      const [rows] = await pool.query<any[]>(
        `${SQL_NOTAS} WHERE N.id_grupo = ? AND N.id_empresa = ?${tudo ? '' : ' AND N.id_fatur = ?'} ORDER BY N.data_nota, N.id LIMIT 5000`,
        tudo ? [G(res), E(res)] : [G(res), E(res), Number(req.query.fatur)],
      );
      const cfg = await configReceber(G(res), E(res));
      res.json(rows.map((n) => ({ ...n, valor_juros_dia: jurosDia(n.total_liquido, cfg.jurosMes) })));
    }),
  );

  router.get(
    '/faturamento/notas/:id/produtos',
    rota(async (req, res) => {
      const nota = await notaDoGrupo(pool, req.params.id, G(res));
      const [rows] = await pool.query<any[]>(
        `SELECT P.*, EQ.nr_serie FROM fatur_notas_produtos P LEFT JOIN equipamentos EQ ON EQ.id = P.id_equip WHERE P.id_nota = ? ORDER BY P.id_equip`,
        [nota.id],
      );
      res.json(rows);
    }),
  );

  /** Edição da nota (vencimento, total, banco, plano) — Faturamento e vencimento do Contas a Receber */
  router.put(
    '/faturamento/notas/:id',
    rota(async (req, res) => {
      const b = req.body ?? {};
      const campos: Linha = {};
      if ('data_vencimento' in b) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.data_vencimento))) throw recusar('Informe a data de vencimento.');
        campos.data_vencimento = String(b.data_vencimento);
      }
      if ('total_liquido' in b) {
        if (!(num(b.total_liquido) > 0)) throw recusar('Informe o total da nota.');
        campos.total_liquido = num(b.total_liquido).toFixed(2);
      }
      if ('id_banco' in b) {
        const [[ok]] = await pool.query<any[]>('SELECT id FROM bancos WHERE id = ? AND id_grupo = ?', [Number(b.id_banco), G(res)]);
        if (!ok && Number(b.id_banco)) throw recusar('Banco não encontrado.');
        campos.id_banco = Number(b.id_banco) || 0;
      }
      if ('id_plano' in b) campos.id_plano = String(b.id_plano ?? '').slice(0, 3);
      if (!Object.keys(campos).length) throw recusar('Nenhuma alteração foi informada.');
      await comUsuario(contexto(res), async (c) => {
        const atual = await notaDoGrupo(c, req.params.id, G(res), undefined, true);
        const { limparBoleto } = ajustarAlteracaoNota(atual, campos);
        const cols = Object.keys(campos);
        await c.query(`UPDATE fatur_notas SET ${cols.map((k) => `${k} = ?`).join(', ')}${limparBoleto ? `, ${SQL_LIMPA_BOLETO}` : ''} WHERE id = ?`, [
          ...cols.map((k) => campos[k]),
          atual.id,
        ]);
      });
      res.json({ success: true });
    }),
  );

  /** Duplo clique na coluna Remessa: volta para "não enviado" (sai na próxima remessa) */
  router.post(
    '/faturamento/notas/:id/reenviar-remessa',
    rota(async (req, res) => {
      const n = await notaDoGrupo(pool, req.params.id, G(res));
      if (n.boleto_enviado !== 'S') throw recusar('A remessa desta nota não foi enviada.');
      await comUsuario(contexto(res), (c) => c.query(`UPDATE fatur_notas SET boleto_enviado = 'N' WHERE id = ?`, [n.id]));
      res.json({ success: true });
    }),
  );

  router.post(
    '/faturamento/notas/:id/boleto',
    rota(async (req, res) => {
      const n = await comUsuario(contexto(res), (c) => gerarBoletoNota(c, req.params.id, G(res)));
      res.json({ success: true, linha: n.boleto_linha_digitavel });
    }),
  );

  router.post(
    '/faturamento/notas/:id/limpar-boleto',
    rota(async (req, res) => {
      const n = await notaDoGrupo(pool, req.params.id, G(res));
      await comUsuario(contexto(res), (c) => c.query(`UPDATE fatur_notas SET ${SQL_LIMPA_BOLETO} WHERE id = ?`, [n.id]));
      res.json({ success: true });
    }),
  );

  /** Navegador Excluir do Faturamento = cancelar a NF (o registro fica, status C) e avisar o cliente se já recebeu e-mail */
  router.post(
    '/faturamento/notas/:id/cancelar',
    rota(async (req, res) => {
      const n = await notaDoGrupo(pool, req.params.id, G(res), E(res));
      if (n.status === 'R') throw recusar('Nota já recebida. Não pode ser cancelada!');
      if (n.cancelado === 'S') throw recusar('A nota já está cancelada.');
      if (n.boleto_enviado === 'S' && !req.body?.ciente) throw recusar('O boleto desta nota já foi enviado ao banco na remessa: confirme ciente de que é preciso pedir a baixa no banco.', 428);
      const ctx = contexto(res);
      await comUsuario(ctx, async (c) => {
        await c.query(`UPDATE fatur_notas_produtos SET cancelado = 'S' WHERE id_nota = ?`, [n.id]);
        await c.query(`UPDATE fatur_notas SET cancelado = 'S', status = 'C' WHERE id = ?`, [n.id]);
      });
      await gravarLog(ctx, `Cancelou a NF ${n.serie}/${n.numero} (nota ${n.id})`, { nome: 'fatur_notas', id: n.id, op: 'A' });
      let aviso = '';
      if (n.status_email === 'E') {
        try {
          const empresa = await empresaDados(n.id_empresa);
          const grupoNome = empresa.grupo_nome || empresa.nome_comercial || '';
          await enviarEmail({
            para: n.email,
            assunto: `${grupoNome} - CANCELAMENTO - Nota Fiscal de Serviço de Locação de Impressora`,
            html: corpoEmail(MODELO_EMAIL_CANCELADA, n, grupoNome, res.locals.usuario?.nome ?? ''),
            nomeRemetente: grupoNome,
            responderPara: empresa.email_financeiro || undefined,
          });
          await comUsuario(ctx, (c) => c.query(`UPDATE fatur_notas SET status_email = 'E', datahora_email = NOW() WHERE id = ?`, [n.id]));
          aviso = 'O cliente foi avisado do cancelamento por e-mail.';
        } catch (e: any) {
          aviso = `NF cancelada, mas o e-mail de cancelamento não foi enviado: ${e.message}`;
        }
      }
      res.json({ success: true, aviso });
    }),
  );

  /** Imprimir NF: PDF da Nota de Débito de Locação (com ficha de compensação ou recibo, conforme o modelo) */
  router.get(
    '/faturamento/notas/:id/nf.pdf',
    rota(async (req, res) => {
      const { pdf, nome } = await pdfDaNota(req.params.id, res);
      enviarArquivo(res, pdf, 'application/pdf', nome, true);
    }),
  );

  router.post(
    '/faturamento/notas/:id/email',
    rota(async (req, res) => {
      const n = await enviarNfPorEmail(req.params.id, res);
      res.json({ success: true, para: n.email });
    }),
  );

  // ------------------------------------------------ pré-faturamento e gravação
  router.get(
    '/faturamento/pre',
    rota(async (req, res) => {
      const leituras = await leiturasAFaturar(pool, G(res), E(res), { cliente: Number(req.query.cliente) || 0, codigoGrupo: String(req.query.grupo ?? '').trim().slice(0, 30) });
      res.json(agruparNotas(leituras));
    }),
  );

  /** Gravar Faturamento: fatur + notas + produtos, numeração pela série com trava e leituras marcadas como faturadas */
  router.post(
    '/faturamento/gravar',
    rota(async (req, res) => {
      const ids: number[] = (Array.isArray(req.body?.leituras) ? req.body.leituras : []).map(Number).filter((n: number) => n > 0);
      if (!ids.length) return res.json({ success: true, notas: 0 });
      const obs: Record<string, string> = req.body?.obs && typeof req.body.obs === 'object' ? req.body.obs : {};
      const ref = String(req.body?.ref ?? '').slice(0, 30);
      const ctx: Contexto = contexto(res);
      const r = await comUsuario(ctx, async (c) => {
        const leituras = await leiturasAFaturar(c, G(res), E(res), { ids }, true);
        if (leituras.length !== ids.length) throw recusar('Algumas leituras já foram faturadas por outro usuário. Gere o pré-faturamento de novo.');
        const notas = agruparNotas(leituras);
        const [f] = await c.query<any>('INSERT INTO fatur (id_grupo, id_empresa, data_fatur, obs, id_usuario_inclusao) VALUES (?, ?, CURDATE(), ?, ?)', [G(res), E(res), ref, ctx.usuarioId]);
        const idFatur = f.insertId;
        for (const n of notas) {
          // Numeração nota a nota com o registro da série travado até o fim da transação
          const [u] = await c.query<any>('UPDATE fatur_series SET ultima_nota = LAST_INSERT_ID(COALESCE(ultima_nota, 0) + 1) WHERE id_grupo = ? AND id_empresa = ? AND id = ?', [
            G(res),
            E(res),
            n.serie_nf,
          ]);
          if (!u.affectedRows) throw recusar(`Série "${n.serie_nf}" não encontrada`);
          const [[{ numero }]] = await c.query<any[]>('SELECT LAST_INSERT_ID() AS numero');
          const [ins] = await c.query<any>(
            `INSERT INTO fatur_notas (id_grupo, id_empresa, id_fatur, id_cliente, id_banco, id_plano, serie, numero, produto_descricao, data_nota,
                total_bruto, total_acrescimo, total_desconto, total_liquido, data_vencimento, status, boleto_enviado)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, 0, 0, ?, ?, 'A', 'N')`,
            [G(res), E(res), idFatur, n.id_cliente, n.id_banco || 0, n.id_plano ?? '', n.serie_nf, numero, `REF. CONTRATO LOCACAO DE ${n.contagem} ${n.equip_descricao}`.slice(0, 255), n.total_geral, n.total_geral, n.data_vencimento],
          );
          for (const l of n.leituras) {
            await c.query(
              `INSERT INTO fatur_notas_produtos (id_nota, id_contrato, id_equip, descricao, setor, leitura_anterior, leitura_atual, nr_copias, nr_copias_contrato,
                  nr_copias_exced, valor_unit_copia, valor_unit_exced, valor_total_contrato, valor_total_exced, valor_bruto, valor_acrescimo, valor_desconto, valor_liquido, obs)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
              [
                ins.insertId, l.id_contrato, l.id_equip, `${l.equip_marca ?? ''} ${l.equip_modelo ?? ''}`.trim(), l.setor, l.leitura_anterior, l.leitura_atual,
                l.nr_copias_mes, l.nr_copias_contrato, l.nr_copias_excedente, l.valor_copia_unit, l.valor_copia_unit_excedente, l.valor_copia_total,
                l.valor_copia_total_excedente, l.valor_total_geral, l.valor_total_geral, String(obs[l.id] ?? l.obs ?? '').slice(0, 255),
              ],
            );
            await c.query(`UPDATE locacao_leituras SET status_fatur = 'S', id_fatur = ? WHERE id = ?`, [idFatur, l.id]);
          }
        }
        return { idFatur, notas: notas.length };
      });
      await gravarLog(ctx, `Gravou o faturamento ${r.idFatur} com ${r.notas} nota(s)`, { nome: 'fatur', id: r.idFatur, op: 'I' });
      res.json({ success: true, id: r.idFatur, notas: r.notas });
    }),
  );

  // ------------------------------------------------ remessa CNAB 240
  /** Gerar Remessa: notas da lista (faturamento ou "Listar Tudo") do mesmo banco da nota corrente */
  router.post(
    '/faturamento/remessa',
    rota(async (req, res) => {
      const atual = await notaDoGrupo(pool, req.body?.nota, G(res), E(res));
      const ctx = contexto(res);
      const r = await comUsuario(ctx, async (c) => {
        const [[b]] = await c.query<any[]>('SELECT * FROM bancos WHERE id = ? AND id_grupo = ? FOR UPDATE', [atual.id_banco, G(res)]);
        if (!b) throw recusar('A nota corrente não tem banco.');
        const cod = strzero(b.cod_banco, 3);
        if (!BANCOS_CNAB.includes(cod)) throw recusar(`Não há layout de remessa para o banco ${b.apelido} (${b.cod_banco || 'sem código'}).`);
        const tudo = req.body?.tudo === true;
        const [notas] = await c.query<any[]>(
          `${SQL_NOTAS} WHERE N.id_grupo = ? AND N.id_empresa = ?${tudo ? '' : ' AND N.id_fatur = ?'} AND N.id_banco = ?
              AND COALESCE(N.boleto_enviado, 'N') <> 'S' AND COALESCE(N.cancelado, 'N') <> 'S' AND N.id_plano = 'BO'
            ORDER BY N.data_nota, N.id FOR UPDATE`,
          tudo ? [G(res), E(res), b.id] : [G(res), E(res), atual.id_fatur, b.id],
        );
        const comBoleto = notas.filter((n) => n.boleto_nosso_numero);
        if (!comBoleto.length) throw recusar(notas.length ? 'As notas desta lista ainda não têm boleto gerado.' : 'Nenhuma nota a enviar para este banco (todas já foram na remessa, canceladas ou não são boleto).');
        const empresa = await empresaDados(E(res));
        const cfg = await configReceber(G(res), E(res));
        const seq = num(b.ultima_remessa) + 1;
        await c.query('UPDATE bancos SET ultima_remessa = ? WHERE id = ?', [seq, b.id]);
        const agora = agoraBrasilia();
        const texto = gerarRemessa(
          { ...b, cnpj: empresa.cnpj, razao_social: empresa.razao_social || empresa.nome_comercial || '' },
          comBoleto.map((n) => ({
            id: n.id,
            serie: n.serie,
            numero: n.numero,
            nossoNumero: n.boleto_nosso_numero,
            nossoNumeroDig: n.boleto_nosso_numero_dig,
            vencimento: n.data_vencimento,
            emissao: n.data_nota,
            valor: n.total_liquido,
            cpfCnpj: n.cpf_cnpj,
            nome: n.nome,
            endereco: [n.endereco, n.endereco_nr].filter(Boolean).join(' '),
            bairro: n.endereco_bairro,
            cep: n.endereco_cep,
            cidade: n.endereco_cidade,
            uf: n.endereco_uf,
          })),
          { sequencial: seq, data: agora.data, hora: agora.hora, jurosMes: cfg.jurosMes, multaPerc: cfg.multa },
        );
        await c.query(`UPDATE fatur_notas SET boleto_enviado = 'S' WHERE id IN (${comBoleto.map(() => '?').join(',')})`, comBoleto.map((n) => n.id));
        const prefixo = cod === '001' ? 'BB' : cod === '033' ? 'SANTANDER' : 'VIACRED';
        const d = agora.data;
        return { texto, nome: `${prefixo}_REMESSA_${d.slice(8, 10)}${d.slice(5, 7)}${d.slice(0, 4)}${agora.hora}.txt`, qtd: comBoleto.length, semBoleto: notas.length - comBoleto.length, seq };
      });
      await gravarLog(ctx, `Gerou a remessa ${r.nome} (${r.qtd} título(s), sequencial ${r.seq})`);
      res.setHeader('X-Titulos', String(r.qtd));
      res.setHeader('X-Sem-Boleto', String(r.semBoleto));
      enviarArquivo(res, Buffer.from(r.texto, 'latin1'), 'text/plain; charset=iso-8859-1', r.nome);
    }),
  );

  // ================================================ Financeiro / Contas a Receber
  /** Lista (filtros status, nome, período de vencimento e ordem). Escopo: o grupo, todas as empresas (coluna Empresa), como no Delphi */
  async function titulos(req: Request, res: Response) {
    const q = req.query;
    const status = q.status === 'R' ? ['R'] : q.status === 'T' ? ['A', 'R', 'C'] : ['A'];
    const ordem = q.ordem === 'N' ? 'P.nome, N.id' : q.ordem === 'R' ? 'N.data_baixa, N.id' : 'N.data_vencimento, N.id';
    const nome = `${String(q.nome ?? '').trim()}%`;
    const d1 = /^\d{4}-\d{2}-\d{2}$/.test(String(q.d1)) ? String(q.d1) : '1902-01-01';
    const d2 = /^\d{4}-\d{2}-\d{2}$/.test(String(q.d2)) ? String(q.d2) : '2099-12-31';
    const [rows] = await pool.query<any[]>(
      `${SQL_NOTAS}
        WHERE N.id_grupo = ? AND N.cancelado = 'N' AND (P.nome LIKE ? OR P.fantasia LIKE ?)
          AND N.data_vencimento BETWEEN ? AND ? AND N.status IN (${status.map(() => '?').join(',')})
        ORDER BY ${ordem} LIMIT 5000`, // ponytail: sem paginação, como a grade do Delphi
      [G(res), nome, nome, d1, d2, ...status],
    );
    return rows;
  }

  router.get(
    '/financeiro/titulos',
    rota(async (req, res) => {
      const [[{ hoje }]] = await pool.query<any[]>('SELECT CURDATE() AS hoje');
      res.json((await titulos(req, res)).map((t) => ({ ...t, atraso: Math.max(0, Math.round((Date.parse(hoje) - Date.parse(String(t.data_vencimento))) / 86_400_000) || 0) })));
    }),
  );

  router.post(
    '/financeiro/titulos/:id/baixar',
    rota(async (req, res) => {
      const b = req.body ?? {};
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.data_baixa))) throw recusar('Informe a data do recebimento.');
      await comUsuario(contexto(res), async (c) => {
        const n = await notaDoGrupo(c, req.params.id, G(res), undefined, true);
        if (n.status !== 'A') throw recusar('Este título não está em aberto.');
        const juros = num(b.juros);
        const desc = num(b.descontos);
        const recebido = 'recebido' in b ? num(b.recebido) : num(n.total_liquido) + juros - desc;
        await c.query(
          `UPDATE fatur_notas SET total_recebido_principal = total_liquido, total_recebido_juros = ?, total_recebido_descontos = ?, total_recebido = ?,
                  data_baixa = ?, obs_baixa = ?, datahora_baixa = NOW(), status = 'R', tipo_baixa = 'M' WHERE id = ?`,
          [juros.toFixed(2), desc.toFixed(2), recebido.toFixed(2), b.data_baixa, String(b.obs ?? '').slice(0, 255), n.id],
        );
      });
      res.json({ success: true });
    }),
  );

  router.post(
    '/financeiro/titulos/:id/estornar',
    rota(async (req, res) => {
      await comUsuario(contexto(res), async (c) => {
        const n = await notaDoGrupo(c, req.params.id, G(res), undefined, true);
        if (n.status !== 'R') throw recusar('Este título não está recebido.');
        await c.query(
          `UPDATE fatur_notas SET datahora_baixa = NULL, total_recebido_principal = 0, total_recebido_juros = 0, total_recebido_descontos = 0,
                  total_recebido = 0, obs_baixa = '', data_baixa = NULL, status = 'A' WHERE id = ?`,
          [n.id],
        );
      });
      res.json({ success: true });
    }),
  );

  /** Excluir título (DELETE físico do navegador do Delphi): só em aberto; com boleto exige ciência */
  router.delete(
    '/financeiro/titulos/:id',
    rota(async (req, res) => {
      const ctx = contexto(res);
      const n = await notaDoGrupo(pool, req.params.id, G(res));
      if (n.status !== 'A') throw recusar('Só títulos em aberto podem ser excluídos.');
      if (n.boleto_codigo_barras && req.query.ciente !== '1') throw recusar('A nota tem boleto gerado: confirme a exclusão ciente do boleto.', 428);
      await comUsuario(ctx, async (c) => {
        await c.query('DELETE FROM fatur_notas_produtos WHERE id_nota = ?', [n.id]);
        await c.query('DELETE FROM fatur_notas WHERE id = ? AND id_grupo = ?', [n.id, G(res)]);
      });
      await gravarLog(ctx, `Excluiu a nota ${n.serie}/${n.numero} (id ${n.id}, R$ ${moedaBr(n.total_liquido)}${n.boleto_enviado === 'S' ? ', boleto enviado na remessa' : ''})`, {
        nome: 'fatur_notas',
        id: n.id,
        op: 'E',
      });
      res.json({ success: true });
    }),
  );

  /** Reenviar Boleto (stub no Delphi): manda de novo a NF com o boleto por e-mail */
  router.post(
    '/financeiro/titulos/:id/reenviar-boleto',
    rota(async (req, res) => {
      const n = await notaDoGrupo(pool, req.params.id, G(res));
      if (!n.boleto_codigo_barras) throw recusar('Boleto ainda não emitido!');
      if (n.id_empresa !== E(res)) throw recusar(`Esta nota é da empresa ${n.empresa_apelido}: entre nela para reenviar.`);
      const r = await enviarNfPorEmail(n.id, res);
      res.json({ success: true, para: r.email });
    }),
  );

  /** Exportar: arquivo .txt separado por "|" com os títulos da lista (campos vazios preservados) */
  router.get(
    '/financeiro/exportar',
    rota(async (req, res) => {
      const rows = await titulos(req, res);
      const campos = ['id', 'id_grupo', 'id_empresa', 'empresa_apelido', 'id_cliente', 'nome', 'cpf_cnpj', 'id_banco', 'serie', 'numero', 'data_nota', 'total_bruto', 'data_vencimento', 'status', 'cancelado', 'boleto_nosso_numero', 'boleto_nosso_numero_dig', 'boleto_codigo_barras', 'boleto_linha_digitavel', 'boleto_enviado', 'data_baixa', 'total_recebido'];
      const valor = (k: string, v: unknown) => {
        if (v === null || v === undefined) return '';
        if (/^data_/.test(k)) return dataBr(v);
        if (/^total_/.test(k)) return moedaBr(v);
        return String(v).replace(/[|\r\n]+/g, ' ');
      };
      const texto = [campos.join('|'), ...rows.map((r) => campos.map((k) => valor(k, r[k])).join('|'))].join('\r\n') + '\r\n';
      const empresa = await empresaDados(E(res));
      const a = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', '-').replace(/:/g, '-');
      enviarArquivo(res, Buffer.from(texto, 'latin1'), 'text/plain; charset=iso-8859-1', `${soDigitos(empresa.cnpj) || empresa.id}_contas_a_receber_${a}.txt`);
    }),
  );

  router.get(
    '/financeiro/bancos',
    rota(async (_req, res) => {
      const [rows] = await pool.query<any[]>('SELECT id, apelido, cod_banco FROM bancos WHERE id_grupo = ? ORDER BY apelido', [G(res)]);
      res.json(rows);
    }),
  );

  /** Baixar Retorno: lê o arquivo enviado e confere os títulos */
  router.post(
    '/financeiro/retorno/ler',
    rota(async (req, res) => {
      res.json((await lerRetornoComTitulos(req.body, G(res))).registros);
    }),
  );

  /** Processar Retorno: baixa os títulos liquidados e grava a última ocorrência nos demais */
  router.post(
    '/financeiro/retorno/processar',
    rota(async (req, res) => {
      const { registros } = await lerRetornoComTitulos(req.body, G(res));
      const arquivo = String(req.body?.nome ?? '').slice(0, 40);
      const ctx = contexto(res);
      await comUsuario(ctx, async (c) => {
        for (const r of registros) {
          r.status = 'P';
          if (!r.encontrado) {
            r.obs = 'TITULO NÃO ENCONTRADO NO SISTEMA';
            continue;
          }
          const [[t]] = await c.query<any[]>('SELECT id, status FROM fatur_notas WHERE id = ? AND id_grupo = ? FOR UPDATE', [r.idNota, G(res)]);
          if (!t) {
            r.obs = 'TITULO NÃO ENCONTRADO NO SISTEMA';
            continue;
          }
          if (r.baixar === 'S') {
            if (t.status === 'R') {
              r.obs = 'TITULO JA RECEBIDO NO SISTEMA';
              continue;
            }
            await c.query(
              `UPDATE fatur_notas SET data_baixa = ?, datahora_baixa = NOW(), total_recebido_principal = ?, total_recebido_juros = ?, total_recebido_descontos = ?,
                      total_recebido = ?, ultima_ocorr_retorno = ?, ultima_obs_retorno = ?, status = 'R', tipo_baixa = 'A', arquivo_retorno = ? WHERE id = ?`,
              [r.dataOcorrencia, r.valorNominal, r.valorJuros, r.valorDescontos, r.valorPago, r.ocorrencia, r.ocorrenciaDescricao.slice(0, 255), arquivo, t.id],
            );
            r.obs = 'BAIXADO!';
          } else {
            await c.query('UPDATE fatur_notas SET ultima_ocorr_retorno = ?, ultima_obs_retorno = ?, arquivo_retorno = ? WHERE id = ?', [
              r.ocorrencia,
              r.ocorrenciaDescricao.slice(0, 255),
              arquivo,
              t.id,
            ]);
            r.obs = 'TITULO ATUALIZADO';
          }
        }
      });
      await gravarLog(ctx, `Processou o retorno ${arquivo} (${registros.filter((r) => r.obs === 'BAIXADO!').length} baixa(s))`);
      res.json(registros);
    }),
  );

  // ================================================ Geração / Impressão Boleto (parcelas de venda)
  router.get(
    '/boletos-areceber',
    rota(async (req, res) => {
      const idAreceber = Number(req.query.id_areceber) || 0;
      const idVenda = Number(req.query.id_venda) || 0;
      const [rows] = await pool.query<any[]>(
        `${SQL_ARECEBER} WHERE A.id_grupo = ? AND A.id_empresa = ? AND (? = 0 OR A.id = ?) AND (? = 0 OR A.id_venda = ?) AND C.emite_boleto = 'S'
          ORDER BY A.data_vencimento, B.nome LIMIT 2000`,
        [G(res), E(res), idAreceber, idAreceber, idVenda, idVenda],
      );
      res.json(rows);
    }),
  );

  router.post(
    '/boletos-areceber/:id/gerar',
    rota(async (req, res) => {
      const a = await comUsuario(contexto(res), (c) => gerarBoletoAreceber(c, req.params.id, G(res), E(res)));
      res.json({ success: true, linha: a.boleto_linha_digitavel });
    }),
  );

  /** PDF dos boletos (?ids=1,2,3); gera antes os que faltarem (Imprimir Atual / Imprimir Todos / Imprimir) */
  router.get(
    '/boletos-areceber/pdf',
    rota(async (req, res) => {
      const ids = String(req.query.ids ?? '')
        .split(',')
        .map(Number)
        .filter((n) => n > 0)
        .slice(0, 500);
      if (!ids.length) throw recusar('Nenhuma parcela escolhida.');
      const parcelas: Linha[] = [];
      for (const id of ids) parcelas.push(await comUsuario(contexto(res), (c) => gerarBoletoAreceber(c, id, G(res), E(res))));
      const pdf = await gerarPdf(await htmlBoletosAreceber(parcelas, G(res)));
      const doc = String(parcelas[0].documento ?? parcelas[0].id).replace(/[\\/]/g, '_');
      enviarArquivo(res, pdf, 'application/pdf', ids.length === 1 ? `boleto_${doc}_${strzero(parcelas[0].parcelas_nr, 2)}.pdf` : `boleto_${doc}.pdf`, true);
    }),
  );

  return router;
}
