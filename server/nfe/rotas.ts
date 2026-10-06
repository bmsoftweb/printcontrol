/**
 * Gerenciamento de NF-e (ufrmVendasNFe) sobre o núcleo trazido do nfeWeb: gerar/assinar/validar o XML,
 * autorizar, consultar, DANFE, cancelar, carta de correção, inutilizar, e-mail e log.
 *
 * Gravação dupla como no Delphi: a situação vai para vendas.nfe_* e para a tabela nfe (1 linha por venda).
 */
import type { Router, Request, Response } from 'express';
import { pool, comUsuario } from '../db.js';
import { contexto } from '../crud.js';
import { recusar } from '../regras.js';
import { gerarPdf } from '../pdf.js';
import { enviarEmail, enderecos } from '../email.js';
import { gravar, ler } from '../armazenamento.js';
import { gerarBoletoAreceber, htmlBoletosAreceber } from '../faturamento.js';
import { configDaEmpresa, carregarEmpresa, carregarCertificado, logNFe, montarContexto, type Contexto } from './contexto.js';
import { gerarNFe } from './gerarNFe.js';
import { assinar } from './assinatura.js';
import { autorizar, consultarChave, consultarRecibo, enviarEvento, inutilizar, montarProcNFe } from './operacoes.js';
import { FalhaSchema, descreverErros, validarNFe } from './validacao.js';
import { montarDocumento, type DadosVendaNFe } from './documento.js';
import { htmlDanfe, htmlEvento } from './danfe.js';
import { recortarElemento, valorTag } from './xml.js';
import { calcularImpostos } from '../vendas.js';

type Linha = Record<string, any>;
const txt = (v: unknown) => String(v ?? '').trim();
const G = (res: Response) => Number(res.locals.grupoId);
const E = (res: Response) => Number(res.locals.empresaId);
const ID = (req: Request) => Number(req.params.id) || 0;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

const rota = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json(r ?? { success: true });
  } catch (err: any) {
    if (!err.status && !(err instanceof FalhaSchema)) console.error('NF-e:', err);
    res.status(err.status || 400).json({ error: err.message || 'Falha na operação.', erros: err instanceof FalhaSchema ? err.erros : undefined });
  }
};

async function vendaNFe(res: Response, id: number): Promise<Linha> {
  const [[v]] = await pool.query<any[]>(
    `SELECT A.*, O.codigo operacao_codigo, O.apelido apelido_operacao, O.descricao operacao_descricao, S.modelo,
            N.id nfe_id, N.nfe_PDF IS NOT NULL tem_pdf, B.nome cliente_nome, B.email cliente_email
       FROM vendas A
       LEFT JOIN vendas_operacoes O ON O.id = A.id_operacao
       LEFT JOIN vendas_series S ON S.id = A.id_serie
       LEFT JOIN nfe N ON N.id = (SELECT MAX(X.id) FROM nfe X WHERE X.id_venda = A.id)
       LEFT JOIN pessoas B ON B.id = A.id_cliente
      WHERE A.id = ? AND A.id_grupo = ? AND A.id_empresa = ?`,
    [id, G(res), E(res)],
  );
  if (!v) throw recusar('Venda não encontrada.', 404);
  return v;
}

/** XML guardado: no banco (TEXT) ou, quando não coube, no armazenamento ("arquivo:<endereço>") */
async function xmlDaVenda(v: Linha): Promise<string> {
  const x = txt(v.nfe_XML);
  if (x.startsWith('arquivo:')) return (await ler(x.slice(8))).toString('utf8');
  return x;
}

/** Grava a situação em vendas e em nfe (cria a linha de nfe se não houver) */
async function gravarSituacao(res: Response, idVenda: number, campos: Linha) {
  const cols = Object.keys(campos);
  if (!cols.length) return;
  // nfe_XML é TEXT (64 KB): XML maior vai para o armazenamento (ver relatório: sugestão de MEDIUMTEXT)
  if (typeof campos.nfe_XML === 'string' && Buffer.byteLength(campos.nfe_XML, 'utf8') > 65000) {
    const url = await gravar(`grupos/${String(G(res)).padStart(6, '0')}/nfe/${campos.nfe_chave || idVenda}-nfe.xml`, campos.nfe_XML, 'application/xml', true);
    campos = { ...campos, nfe_XML: `arquivo:${url}` };
  }
  await comUsuario(contexto(res), async (c) => {
    const vals = cols.map((k) => campos[k]);
    await c.query(`UPDATE vendas SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND id_grupo = ? AND id_empresa = ?`, [...vals, idVenda, G(res), E(res)]);
    const [[n]] = await c.query<any[]>('SELECT id FROM nfe WHERE id_venda = ? ORDER BY id DESC LIMIT 1', [idVenda]);
    if (n) await c.query(`UPDATE nfe SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...vals, n.id]);
    else await c.query(`INSERT INTO nfe (id_venda, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`, [idVenda, ...vals]);
  });
}

const msg255 = (s: string) => s.slice(0, 255);
const dataHoraRet = (dh: string) => {
  const m = dh.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  return m ? { nfe_data_aut: m[1], nfe_hora_aut: m[2] } : {};
};

/** Dados da venda para o DocumentoNFe (itens, impostos, parcelas e chaves de origem da devolução) */
async function dadosVenda(res: Response, v: Linha): Promise<DadosVendaNFe> {
  const g = G(res);
  const [[operacao]] = await pool.query<any[]>('SELECT * FROM vendas_operacoes WHERE id = ? AND id_grupo = ?', [v.id_operacao, g]);
  const [[cliente]] = await pool.query<any[]>('SELECT * FROM pessoas WHERE id = ? AND id_grupo = ?', [v.id_cliente, g]);
  if (!operacao) throw recusar('Operação da venda não encontrada.');
  if (!cliente) throw recusar('Cliente da venda não encontrado.');
  const [itens] = await pool.query<any[]>(
    `SELECT A.*, B.descricao, B.cod_barra, B.un_venda, B.ncm, N.cest
       FROM vendas_produtos A LEFT JOIN produtos B ON B.id = A.id_produto
       LEFT JOIN (SELECT ncm, MAX(cest) cest FROM produtos_ncm GROUP BY ncm) N ON N.ncm = B.ncm
      WHERE A.id_venda = ? ORDER BY A.item, A.id`,
    [v.id],
  );
  const [imps] = await pool.query<any[]>(
    'SELECT I.* FROM nfe_impostos_produtos I JOIN vendas_produtos P ON P.id = I.id_vendas_produtos WHERE P.id_venda = ? ORDER BY I.id',
    [v.id],
  );
  const [parcelas] = await pool.query<any[]>('SELECT * FROM areceber WHERE id_venda = ? AND id_grupo = ? ORDER BY parcelas_nr', [v.id, g]);
  const [refs] = await pool.query<any[]>(
    `SELECT DISTINCT V.nfe_chave FROM vendas_produtos P JOIN vendas_produtos O ON O.id = P.id_vendas_produtos_devol JOIN vendas V ON V.id = O.id_venda
      WHERE P.id_venda = ? AND V.nfe_chave IS NOT NULL AND V.nfe_chave <> ''`,
    [v.id],
  );
  const [[plano]] = await pool.query<any[]>('SELECT apelido FROM vendas_condicoes WHERE id = ?', [v.id_condicao]);
  return {
    venda: v,
    operacao,
    cliente,
    itens,
    impostos: Object.fromEntries(imps.map((i) => [i.id_vendas_produtos, i])),
    parcelas,
    referencias: refs.map((r) => r.nfe_chave),
    apelidoPlano: plano?.apelido,
  };
}

function exigirNFe(v: Linha) {
  if (txt(v.status) !== 'F') throw recusar('A venda precisa estar finalizada.');
  if (txt(v.modelo) !== '55') throw recusar('A série desta venda não é de NF-e (modelo 55).');
}

/** Pré-checagens de cancelamento/CC-e do Delphi (exigiam o -procNfe.xml) */
function exigirAutorizada(v: Linha) {
  if (txt(v.nfe_cancelada) === 'S') throw recusar('NFe já cancelada!');
  if (txt(v.nfe_status) !== '100' || !txt(v.nfe_protocolo)) throw recusar('NF-e ainda não autorizada (sem protocolo).');
}

export function rotasNFe(router: Router) {
  /** Listagem das notas (§9.2): finalizadas, modelo 55, da empresa ativa */
  router.get(
    '/vendas-nfe',
    rota(async (req, res) => {
      const ano = Number(new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 4));
      const d1 = /^\d{4}-\d{2}-\d{2}$/.test(txt(req.query.d1)) ? txt(req.query.d1) : `${new Date(Date.now() - 1000 * 86_400_000).getFullYear()}-01-01`;
      const d2 = /^\d{4}-\d{2}-\d{2}$/.test(txt(req.query.d2)) ? txt(req.query.d2) : `${ano}-12-31`;
      const [rows] = await pool.query<any[]>(
        `SELECT A.id, A.status venda_status, A.es, A.data_venda, A.id_operacao, O.apelido apelido_operacao, A.serie, A.numero, A.id_cliente,
                B.nome cliente_nome, A.valor_total_liquido, A.valor_total_bruto, A.valor_acrescimo_total, A.valor_desconto_total,
                A.nfe_chave, A.nfe_status, A.nfe_protocolo, A.nfe_recibo, A.nfe_cancelada, A.nfe_protocolo_cancelamento, A.nfe_ultima_msg
           FROM vendas A
           LEFT JOIN pessoas B ON B.id = A.id_cliente
           LEFT JOIN vendas_operacoes O ON O.id = A.id_operacao
           LEFT JOIN vendas_series S ON S.id = A.id_serie
          WHERE A.id_grupo = ? AND A.id_empresa = ? AND A.data_venda BETWEEN ? AND ? AND A.status = 'F' AND S.modelo = '55'
          ORDER BY A.id`,
        [G(res), E(res), d1, d2],
      );
      return rows;
    }),
  );

  /** Detalhes: eventos, log, itens, parcelas e totais de impostos */
  router.get(
    '/vendas-nfe/:id(\\d+)',
    rota(async (req, res) => {
      const v = await vendaNFe(res, ID(req));
      const [eventos] = await pool.query<any[]>('SELECT id, data, hora, protocolo, seq, descricao, texto, nome_interno, evento_PDF IS NOT NULL tem_pdf FROM nfe_eventos WHERE id_venda = ? ORDER BY id', [v.id]);
      const [log] = await pool.query<any[]>('SELECT id, data_hora, log FROM nfe_log WHERE id_venda = ? AND id_grupo = ? ORDER BY id DESC LIMIT 200', [v.id, G(res)]);
      const [impostos] = await pool.query<any[]>('SELECT * FROM nfe_impostos WHERE id_venda = ? ORDER BY id LIMIT 1', [v.id]);
      return { eventos, log, impostos: impostos[0] ?? null, cliente_email: v.cliente_email, tem_xml: Boolean(txt(v.nfe_XML)) };
    }),
  );

  /** Log geral da empresa (inutilizações não têm venda) */
  router.get(
    '/vendas-nfe/log',
    rota(async (_req, res) => {
      const [log] = await pool.query<any[]>(
        `SELECT L.id, L.data_hora, L.log, L.id_venda, CONCAT(V.serie,'/',V.numero) serie_numero FROM nfe_log L LEFT JOIN vendas V ON V.id = L.id_venda
          WHERE L.id_grupo = ? AND L.id_empresa = ? ORDER BY L.id DESC LIMIT 300`,
        [G(res), E(res)],
      );
      return log;
    }),
  );

  /**
   * Gera (e assina, se houver certificado) o XML sem transmitir, e confere no XSD: conferência antes do envio.
   * Não grava nada.
   */
  router.post(
    '/vendas-nfe/:id(\\d+)/gerar-xml',
    rota(async (req, res) => {
      const v = await vendaNFe(res, ID(req));
      exigirNFe(v);
      const doc = montarDocumento(await dadosVenda(res, v));
      const empresa = await carregarEmpresa(E(res), G(res));
      const ger = gerarNFe(configDaEmpresa(empresa), doc);
      let xml = ger.xml;
      let assinado = false;
      let aviso = '';
      try {
        xml = assinar(ger.xml, 'infNFe', `NFe${ger.chave}`, await carregarCertificado(empresa));
        assinado = true;
      } catch (e: any) {
        aviso = `XML não assinado: ${e.message}`;
      }
      const validacao = await validarNFe(xml);
      return { chave: ger.chave, totais: ger.totais, xml, assinado, aviso, validacao };
    }),
  );

  /** Registrar NFe (§9.4): gera, assina, valida, autoriza e grava o procNFe */
  router.post(
    '/vendas-nfe/:id(\\d+)/registrar',
    rota(async (req, res) => {
      let v = await vendaNFe(res, ID(req));
      exigirNFe(v);
      if (txt(v.nfe_status) === '100') throw recusar('Nota já autorizada!');
      // Como o Delphi ao abrir a tela: impostos recalculados antes do envio
      await comUsuario(contexto(res), (c) => calcularImpostos(c, res, v.id, true));
      v = await vendaNFe(res, v.id);
      const doc = montarDocumento(await dadosVenda(res, v));
      const ctx: Contexto = await montarContexto(E(res), G(res), v.id);
      const ger = gerarNFe(ctx, doc);
      const assinado = assinar(ger.xml, 'infNFe', `NFe${ger.chave}`, ctx.certificado);
      await gravarSituacao(res, v.id, { nfe_chave: ger.chave, nfe_XML: assinado, nfe_ultima_msg: 'XML gerado e assinado' });

      let ret;
      try {
        ret = await autorizar(ctx, assinado);
      } catch (e: any) {
        if (e instanceof FalhaSchema) {
          await gravarSituacao(res, v.id, { nfe_ultima_msg: msg255(`Erros nas regras de negócios: ${descreverErros(e.erros)}`) });
          throw Object.assign(new FalhaSchema('Erros nas regras de negócios! Verifique a mensagem!', e.erros, e.schema, true), { status: 409 });
        }
        throw e;
      }
      let protNFe = ret.dados?.protNFe as string | null;
      let cStat = Number(ret.dados?.cStatNota || 0);
      let motivo = String(ret.dados?.motivoNota || ret.xMotivo);
      const recibo = String(ret.dados?.recibo || '');
      // Lote assíncrono (103): consulta o recibo até 3 vezes, a cada 3 s (como o ACBr configurado no Delphi)
      for (let i = 0; !protNFe && recibo && i < 3; i++) {
        await espera(3000);
        const r = await consultarRecibo(ctx, recibo);
        if (r.dados?.emProcessamento) continue;
        protNFe = r.dados?.protNFe;
        cStat = Number(r.dados?.cStatNota || r.cStat);
        motivo = String(r.dados?.motivoNota || r.xMotivo);
        break;
      }
      const amb = ctx.config.webservice.ambiente === 1 ? 'Produção' : 'Homologação';
      await logNFe(G(res), E(res), v.id, `NFe Enviada / Amb: ${amb} / Status: ${cStat || ret.cStat} / UF: ${ctx.emitente.uf} / Motivo: ${motivo} / Recibo: ${recibo} / Protocolo: ${protNFe ? valorTag(protNFe, 'nProt') : ''}`);

      if (protNFe && (cStat === 100 || cStat === 150)) {
        const proc = montarProcNFe(assinado, protNFe);
        await gravarSituacao(res, v.id, {
          nfe_status: '100',
          nfe_ultima_msg: msg255(motivo),
          nfe_recibo: recibo.slice(0, 15) || null,
          nfe_protocolo: valorTag(protNFe, 'nProt').slice(0, 15),
          ...dataHoraRet(valorTag(protNFe, 'dhRecbto')),
          nfe_XML: proc,
          nfe_chave: ger.chave,
        });
        return { autorizada: true, chave: ger.chave, protocolo: valorTag(protNFe, 'nProt'), motivo };
      }
      const status = String(cStat || ret.cStat).slice(0, 5);
      await gravarSituacao(res, v.id, { nfe_status: status, nfe_recibo: recibo.slice(0, 15) || null, nfe_ultima_msg: msg255(`TENTATIVA DE ENVIO DE NFE / ${status} - ${motivo}`) });
      throw recusar(`NF-e não autorizada: ${status} - ${motivo}`);
    }),
  );

  /** Consultar situação na SEFAZ; completa o protocolo e a situação de cancelamento */
  router.post(
    '/vendas-nfe/:id(\\d+)/consultar',
    rota(async (req, res) => {
      const v = await vendaNFe(res, ID(req));
      if (!txt(v.nfe_chave)) throw recusar('NF-e ainda não gerada (sem chave).');
      const ctx = await montarContexto(E(res), G(res), v.id);
      const r = await consultarChave(ctx, v.nfe_chave);
      await logNFe(G(res), E(res), v.id, `CONSULTA: ${r.cStat} - ${r.xMotivo}`);
      if (/rejei/i.test(r.xMotivo)) throw recusar(`${r.cStat} - ${r.xMotivo}`);
      const campos: Linha = { nfe_ultima_msg: msg255(`${r.cStat} - ${r.xMotivo}`) };
      const prot = r.dados?.protNFe as string | null;
      if (prot && Number(valorTag(prot, 'cStat')) === 100 && !txt(v.nfe_protocolo)) {
        const xml = await xmlDaVenda(v);
        Object.assign(campos, { nfe_status: '100', nfe_protocolo: valorTag(prot, 'nProt'), ...dataHoraRet(valorTag(prot, 'dhRecbto')) });
        if (xml && !/<nfeProc/.test(xml)) campos.nfe_XML = montarProcNFe(xml, prot);
      }
      const eventos = [...r.xml.matchAll(/<retEvento[\s\S]*?<\/retEvento>/g)].map((m) => ({
        tipo: valorTag(m[0], 'tpEvento'),
        seq: valorTag(m[0], 'nSeqEvento'),
        descricao: valorTag(m[0], 'xEvento'),
        status: `${valorTag(m[0], 'cStat')} - ${valorTag(m[0], 'xMotivo')}`,
        protocolo: valorTag(m[0], 'nProt'),
        data: valorTag(m[0], 'dhRegEvento'),
      }));
      if (r.cStat === 101 || eventos.some((e) => e.tipo === '110111' && e.status.startsWith('135'))) campos.nfe_cancelada = 'S';
      await gravarSituacao(res, v.id, campos);
      return { cStat: r.cStat, xMotivo: r.xMotivo, protocolo: r.dados?.protocolo, eventos };
    }),
  );

  /** DANFE em PDF (grava o PDF na primeira impressão da nota autorizada) */
  router.get(
    '/vendas-nfe/:id(\\d+)/danfe',
    rota(async (req, res) => {
      const v = await vendaNFe(res, ID(req));
      const xml = await xmlDaVenda(v);
      if (!xml) throw recusar('XML da NFe não encontrado!');
      const pdf = await gerarPdf(htmlDanfe(xml, txt(v.nfe_cancelada) === 'S' ? 'CANCELADA' : ''));
      await logNFe(G(res), E(res), v.id, 'DANFE gerado');
      if (txt(v.nfe_status) === '100' && !Number(v.tem_pdf) && txt(v.nfe_cancelada) !== 'S') await gravarSituacao(res, v.id, { nfe_PDF: pdf });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="danfe_${txt(v.serie)}_${txt(v.numero).padStart(6, '0')}.pdf"`);
      res.send(pdf);
    }),
  );

  /** XML (procNFe) para download */
  router.get(
    '/vendas-nfe/:id(\\d+)/xml',
    rota(async (req, res) => {
      const v = await vendaNFe(res, ID(req));
      const xml = await xmlDaVenda(v);
      if (!xml) throw recusar('XML da NFe não encontrado!');
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${txt(v.nfe_chave) || v.id}-${/<nfeProc/.test(xml) ? 'procNfe' : 'nfe'}.xml"`);
      res.send(xml);
    }),
  );

  /** Cancelar NFe (evento 110111). Não estorna venda/estoque/financeiro: a resposta avisa */
  router.post(
    '/vendas-nfe/:id(\\d+)/cancelar',
    rota(async (req, res) => {
      const v = await vendaNFe(res, ID(req));
      exigirAutorizada(v);
      const just = txt(req.body?.justificativa);
      if (just.length < 15) throw recusar('Justificativa deve ter pelo menos 15 caracteres !');
      const ctx = await montarContexto(E(res), G(res), v.id);
      const r = await enviarEvento(ctx, { chave: v.nfe_chave, tipoEvento: '110111', protocolo: v.nfe_protocolo, justificativa: just });
      await logNFe(G(res), E(res), v.id, `CANCELAMENTO: ${r.cStat} - ${r.xMotivo}`);
      if (!r.sucesso) {
        await gravarSituacao(res, v.id, { nfe_ultima_msg: msg255(`TENTATIVA DE CANCELAMENTO / ${r.cStat} - ${r.xMotivo}`) });
        throw recusar(`${r.cStat} - ${r.xMotivo}`);
      }
      const prot = String(r.dados?.protocolo || '');
      await gravarSituacao(res, v.id, { nfe_cancelada: 'S', nfe_protocolo_cancelamento: prot.slice(0, 15), nfe_ultima_msg: 'NFe Cancelada' });
      const reg = valorTag(String(r.dados?.procEventoNFe || r.xml), 'dhRegEvento');
      await comUsuario(contexto(res), (c) =>
        c.query(
          `INSERT INTO nfe_eventos (id_venda, data, hora, protocolo, seq, descricao, texto, nome_interno, evento_XML_PED, evento_XML_RET)
           VALUES (?, ?, ?, ?, '01', 'Cancelamento', ?, ?, ?, ?)`,
          [v.id, reg.slice(0, 10) || null, reg.slice(11, 19) || null, prot.slice(0, 15), just.slice(0, 255), `CANC-${prot}`.slice(0, 50), r.dados?.xmlEnvio ?? null, r.dados?.procEventoNFe ?? r.xml],
        ),
      );
      return { protocolo: prot, aviso: 'NF-e cancelada. A venda, o estoque e o financeiro NÃO foram estornados: ajuste-os manualmente se for o caso.' };
    }),
  );

  /** Carta de correção (evento 110110), sequência = CC-e registradas + 1 */
  router.post(
    '/vendas-nfe/:id(\\d+)/cce',
    rota(async (req, res) => {
      const v = await vendaNFe(res, ID(req));
      exigirAutorizada(v);
      const correcao = txt(req.body?.correcao);
      if (correcao.length < 15) throw recusar('Correção deve ter pelo menos 15 caracteres !');
      const [[q]] = await pool.query<any[]>("SELECT COUNT(*) n FROM nfe_eventos WHERE id_venda = ? AND (nome_interno IS NULL OR nome_interno NOT LIKE 'CANC-%')", [v.id]);
      const seq = Number(q.n) + 1;
      const ctx = await montarContexto(E(res), G(res), v.id);
      const r = await enviarEvento(ctx, { chave: v.nfe_chave, tipoEvento: '110110', sequencia: seq, correcao });
      await logNFe(G(res), E(res), v.id, `CARTA DE CORRECAO ${seq}: ${r.cStat} - ${r.xMotivo}`);
      if (!r.sucesso) {
        await gravarSituacao(res, v.id, { nfe_ultima_msg: msg255(`CARTA DE CORRECAO NAO REGISTRADA! / ${r.cStat} - ${r.xMotivo}`) });
        throw recusar(`CARTA DE CORREÇÃO NÃO REGISTRADA! ${r.cStat} - ${r.xMotivo}`);
      }
      const prot = String(r.dados?.protocolo || '');
      const reg = String(r.dados?.dataRegistro || '');
      const s2 = String(seq).padStart(2, '0');
      // descricao é varchar(30): o texto completo da correção fica em texto (255) e no XML do evento
      await comUsuario(contexto(res), (c) =>
        c.query(
          `INSERT INTO nfe_eventos (id_venda, data, hora, protocolo, seq, descricao, texto, nome_interno, evento_XML_PED, evento_XML_RET)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [v.id, reg.slice(0, 10) || null, reg.slice(11, 19) || null, prot.slice(0, 15), s2, correcao.slice(0, 30), correcao.slice(0, 255), `CCE-${s2}-${prot}`.slice(0, 50), r.dados?.xmlEnvio ?? null, r.dados?.procEventoNFe ?? r.xml],
        ),
      );
      await gravarSituacao(res, v.id, { nfe_ultima_msg: msg255(`Carta de correção ${s2} registrada`) });
      return { protocolo: prot, seq };
    }),
  );

  /** Imprimir evento (grava evento_PDF) */
  router.get(
    '/vendas-nfe/eventos/:id(\\d+)/pdf',
    rota(async (req, res) => {
      const [[e]] = await pool.query<any[]>(
        `SELECT X.*, V.serie, V.numero FROM nfe_eventos X JOIN vendas V ON V.id = X.id_venda WHERE X.id = ? AND V.id_grupo = ? AND V.id_empresa = ?`,
        [ID(req), G(res), E(res)],
      );
      if (!e) throw recusar('NFe ainda não tem carta de correção', 404);
      let pdf: Buffer = e.evento_PDF;
      if (!pdf?.length) {
        const empresa = await carregarEmpresa(E(res), G(res));
        const ret = recortarElemento(txt(e.evento_XML_RET), 'retEvento') || txt(e.evento_XML_RET);
        pdf = await gerarPdf(htmlEvento(txt(e.evento_XML_PED), ret, { emitente: empresa.razao_social || empresa.nome_comercial, numero: txt(e.numero), serie: txt(e.serie) }));
        await comUsuario(contexto(res), (c) => c.query('UPDATE nfe_eventos SET evento_PDF = ? WHERE id = ?', [pdf, e.id]));
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="evento_${txt(e.seq)}_${txt(e.numero)}.pdf"`);
      res.send(pdf);
    }),
  );

  /** E-mail da NF-e ao cliente (XML + DANFE + boletos das parcelas, se houver); o Delphi tinha destinatário fixo */
  router.post(
    '/vendas-nfe/:id(\\d+)/email',
    rota(async (req, res) => {
      const v = await vendaNFe(res, ID(req));
      const xml = await xmlDaVenda(v);
      if (!xml || txt(v.nfe_status) !== '100') throw recusar('Envie por e-mail só a NF-e autorizada.');
      const para = enderecos(txt(req.body?.para) || v.cliente_email);
      if (!para.length) throw recusar('O cliente não tem e-mail válido no cadastro: informe o destinatário.');
      const empresa = await carregarEmpresa(E(res), G(res));
      const anexos = [
        { filename: `${v.nfe_chave}-procNfe.xml`, content: xml, contentType: 'application/xml' },
        { filename: `danfe_${txt(v.serie)}_${txt(v.numero).padStart(6, '0')}.pdf`, content: await gerarPdf(htmlDanfe(xml)), contentType: 'application/pdf' },
      ];
      if (req.body?.boletos !== false) {
        const [parc] = await pool.query<any[]>(
          "SELECT A.id FROM areceber A JOIN bancos B ON B.id = A.id_banco WHERE A.id_venda = ? AND A.id_grupo = ? AND B.emite_boleto = 'S' ORDER BY A.parcelas_nr",
          [v.id, G(res)],
        );
        if (parc.length) {
          const linhas = [];
          for (const p of parc) linhas.push(await comUsuario(contexto(res), (c) => gerarBoletoAreceber(c, p.id, G(res), E(res))));
          anexos.push({ filename: `boleto_${txt(v.serie)}_${txt(v.numero).padStart(6, '0')}.pdf`, content: await gerarPdf(await htmlBoletosAreceber(linhas, G(res))), contentType: 'application/pdf' });
        }
      }
      await enviarEmail({
        para,
        assunto: `NF-e ${txt(v.numero)} - ${empresa.nome_comercial || empresa.razao_social}`,
        html: `<p>Prezado(a) ${txt(v.cliente_nome)},</p><p>Segue a Nota Fiscal Eletrônica nº ${txt(v.numero)}, série ${txt(v.serie)}, chave ${txt(v.nfe_chave)}.</p><p>${empresa.razao_social || empresa.nome_comercial || ''}</p>`,
        responderPara: empresa.email_financeiro || undefined,
        nomeRemetente: empresa.nome_comercial || undefined,
        anexos,
      });
      await logNFe(G(res), E(res), v.id, `E-mail enviado para ${para.join(', ')}`);
      return { para };
    }),
  );

  /** E-mail de um evento (carta de correção) ao cliente */
  router.post(
    '/vendas-nfe/eventos/:id(\\d+)/email',
    rota(async (req, res) => {
      const [[e]] = await pool.query<any[]>(
        `SELECT X.*, V.serie, V.numero, V.nfe_chave, B.email, B.nome FROM nfe_eventos X JOIN vendas V ON V.id = X.id_venda LEFT JOIN pessoas B ON B.id = V.id_cliente
          WHERE X.id = ? AND V.id_grupo = ? AND V.id_empresa = ?`,
        [ID(req), G(res), E(res)],
      );
      if (!e) throw recusar('Evento não encontrado.', 404);
      const para = enderecos(txt(req.body?.para) || e.email);
      if (!para.length) throw recusar('O cliente não tem e-mail válido no cadastro: informe o destinatário.');
      const empresa = await carregarEmpresa(E(res), G(res));
      const ret = recortarElemento(txt(e.evento_XML_RET), 'retEvento') || txt(e.evento_XML_RET);
      const pdf = e.evento_PDF?.length ? e.evento_PDF : await gerarPdf(htmlEvento(txt(e.evento_XML_PED), ret, { emitente: empresa.razao_social, numero: txt(e.numero), serie: txt(e.serie) }));
      await enviarEmail({
        para,
        assunto: `${txt(e.descricao)} - NF-e ${txt(e.numero)}`,
        html: `<p>Prezado(a) ${txt(e.nome)},</p><p>Segue o evento registrado para a NF-e ${txt(e.numero)} (chave ${txt(e.nfe_chave)}).</p>`,
        nomeRemetente: empresa.nome_comercial || undefined,
        anexos: [
          { filename: `evento_${txt(e.seq)}_${txt(e.numero)}.pdf`, content: pdf, contentType: 'application/pdf' },
          { filename: `${txt(e.nfe_chave)}-${txt(e.seq)}-procEventoNFe.xml`, content: txt(e.evento_XML_RET), contentType: 'application/xml' },
        ],
      });
      return { para };
    }),
  );

  /** Inutilizar numeração (o Delphi não validava a justificativa) */
  router.post(
    '/vendas-nfe/inutilizar',
    rota(async (req, res) => {
      const b = req.body ?? {};
      const just = txt(b.justificativa);
      if (just.length < 15) throw recusar('Justificativa deve ter pelo menos 15 caracteres !');
      const de = Number(b.de);
      const ate = Number(b.ate);
      if (!(de > 0) || !(ate >= de)) throw recusar('Numeração inválida: informe "de" e "até" (até ≥ de).');
      const ctx = await montarContexto(E(res), G(res));
      const r = await inutilizar(ctx, { ano: Number(b.ano) || new Date().getFullYear(), modelo: txt(b.modelo) || '55', serie: Number(b.serie) || 1, numeroInicial: de, numeroFinal: ate, justificativa: just });
      await logNFe(G(res), E(res), null, `INUTILIZACAO: ${r.cStat} - ${r.xMotivo} (de: ${de} ate: ${ate})`);
      if (!r.sucesso) throw recusar(`${r.cStat} - ${r.xMotivo}`);
      return { cStat: r.cStat, xMotivo: r.xMotivo, protocolo: r.dados?.protocolo };
    }),
  );
}
