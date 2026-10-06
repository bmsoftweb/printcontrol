import { Router, Request, Response, NextFunction } from 'express';
import type { PoolConnection } from 'mysql2/promise';
import { pool, comUsuario, Contexto } from './db.js';
import { contexto, temNivel } from './crud.js';
import { registrarRegras, recusar } from './regras.js';
import { enviarEmail, emailConfigurado } from './email.js';
import { gerarPdf } from './pdf.js';
import {
  aplicarVariaveis,
  camposPivot,
  dividirComandos,
  formatarColuna,
  formatarNumero,
  motivoRecusa,
  parseParametros,
  parseTitulos,
  prepararSql,
  tituloAba,
  validarPeca,
  valorParametro,
  type ColunaConsulta,
  type TipoColuna,
} from '../src/modulos/os/regras.js';

/**
 * Ordens de Serviço, Requisições e Consultas (ufrmOS, ufrmRequisicoes, ufrmConsultas do Delphi).
 * Listas com os JOINs do Delphi e os processos (executar, finalizar, VOID, gerar OS/requisições, impressão,
 * consultas SQL) ficam aqui; inclusão/alteração/exclusão passam pelo CRUD genérico com as regras abaixo.
 */

const FUSO = 'America/Sao_Paulo';
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
const agora = () => new Date().toLocaleString('sv-SE', { timeZone: FUSO }).replace('T', ' ');

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

async function nivelDe(usuarioId: number | null): Promise<string> {
  const [[u]] = await pool.query<any[]>('SELECT nivel FROM usuarios WHERE id = ?', [usuarioId ?? 0]);
  return String(u?.nivel || 'Z').charAt(0).toUpperCase();
}

/** Contrato do cliente na empresa ativa, com a descrição do equipamento ("marca modelo") */
async function contratoDoCliente(id: number, clienteId: number, ctx: Contexto) {
  const [[c]] = await pool.query<any[]>(
    `SELECT C.id, C.id_equip, M.descricao marca_descricao, E.modelo
       FROM locacao_contratos C
       LEFT JOIN equipamentos E ON E.id = C.id_equip
       LEFT JOIN equipamentos_marcas M ON M.id = E.id_marca
      WHERE C.id = ? AND C.id_grupo = ? AND C.id_empresa = ? AND C.id_cliente = ?`,
    [id, ctx.grupoId, ctx.empresaId, clienteId],
  );
  if (!c) throw recusar('Contrato inválido para este cliente.');
  return { id_equip: c.id_equip || null, equip_descricao: Number(c.id_equip) > 0 ? `${c.marca_descricao ?? ''} ${c.modelo ?? ''}`.trim().slice(0, 50) : null };
}

// ============================================================
// Regras do CRUD genérico (BeforePost / OnNewRecord do Delphi)
// ============================================================

registrarRegras('os', {
  async antesDeGravar(p, id, ctx) {
    let atual: any = {};
    if (id) [[atual]] = await pool.query<any[]>('SELECT id_cliente, id_contrato FROM os WHERE id = ? AND id_grupo = ? AND id_empresa = ?', [id, ctx.grupoId, ctx.empresaId]);
    if (!atual) throw recusar('OS não encontrada.', 404);
    if (!id) {
      // OnNewRecord: o Delphi deixava usuário, status e tipo para o DEFAULT do banco; aqui vão explícitos
      Object.assign(p, { id_usuario_inclusao: ctx.usuarioId, datahora_inclusao: agora(), status: 'A', status_impressao: 'N' });
      p.os_tipo ||= 'C';
      p.data_os ||= hoje();
    }
    const clienteId = Number('id_cliente' in p ? p.id_cliente : atual.id_cliente) || 0;
    if (!id || 'id_cliente' in p) {
      const [[cli]] = await pool.query<any[]>("SELECT id, cpf_cnpj FROM pessoas WHERE id = ? AND id_grupo = ? AND ativo = 'S'", [clienteId, ctx.grupoId]);
      if (!cli) throw recusar('Cliente inválido!');
      if (!p.cnpj_cliente && Number(atual.id_cliente) !== clienteId) p.cnpj_cliente = String(cli.cpf_cnpj ?? '').replace(/\D/g, '').slice(0, 14) || null;
    }
    if ('id_contrato' in p) {
      if (Number(p.id_contrato) > 0) Object.assign(p, await contratoDoCliente(Number(p.id_contrato), clienteId, ctx));
      else Object.assign(p, { id_contrato: null, id_equip: null, equip_descricao: null });
    }
  },
  // O Delphi deixava as peças órfãs; aqui saem junto (a tela pede confirmação)
  async antesDeExcluir(id, ctx) {
    await comUsuario(ctx, (c) =>
      c.query('DELETE P FROM os_pecas P JOIN os O ON O.id = P.id_os WHERE P.id_os = ? AND O.id_grupo = ? AND O.id_empresa = ?', [id, ctx.grupoId, ctx.empresaId]),
    );
  },
});

registrarRegras('os_pecas', {
  async antesDeGravar(p, id, ctx) {
    let atual: any = {};
    if (id) {
      [[atual]] = await pool.query<any[]>('SELECT P.* FROM os_pecas P JOIN os O ON O.id = P.id_os WHERE P.id = ? AND O.id_grupo = ? AND O.id_empresa = ?', [id, ctx.grupoId, ctx.empresaId]);
      if (!atual) throw recusar('Peça não encontrada.', 404);
      delete p.id_os;
    }
    const [[os]] = await pool.query<any[]>('SELECT id, qtdade_os FROM os WHERE id = ? AND id_grupo = ? AND id_empresa = ?', [id ? atual.id_os : p.id_os, ctx.grupoId, ctx.empresaId]);
    if (!os) throw recusar('OS não encontrada.', 404);
    if (!id) {
      p.qtdade_entregue ??= 0;
      if (!(Number(p.qtdade) > 0)) p.qtdade = Math.trunc(Number(os.qtdade_os) || 0) > 0 ? Math.trunc(Number(os.qtdade_os)) : 1;
    }
    if (p.id_produto) {
      const [[pro]] = await pool.query<any[]>('SELECT preco_venda FROM produtos WHERE id = ? AND id_grupo = ?', [p.id_produto, ctx.grupoId]);
      if (!pro) throw recusar('Produto inválido!');
      if (!id && (p.valor_unit === null || p.valor_unit === undefined)) p.valor_unit = pro.preco_venda ?? 0;
    }
    try {
      p.valor_total = validarPeca({ ...atual, ...p }, Number(os.qtdade_os) || 0, await nivelDe(ctx.usuarioId));
    } catch (e: any) {
      throw recusar(e.message);
    }
  },
});

registrarRegras('req', {
  async antesDeGravar(p, id, ctx) {
    let atual: any = {};
    if (id) [[atual]] = await pool.query<any[]>('SELECT status, data_entrega, id_cliente FROM req WHERE id = ? AND id_grupo = ? AND id_empresa = ?', [id, ctx.grupoId, ctx.empresaId]);
    if (!atual) throw recusar('Requisição não encontrada.', 404);
    if (!id) {
      Object.assign(p, { id_usuario_inclusao: ctx.usuarioId, datahora_inclusao: agora(), status_impressao: 'N' });
      p.status ||= 'A';
      p.data_req ||= hoje();
    }
    if (p.id_cliente) {
      const [[cli]] = await pool.query<any[]>("SELECT id FROM pessoas WHERE id = ? AND id_grupo = ? AND ativo = 'S'", [p.id_cliente, ctx.grupoId]);
      if (!cli) throw recusar('Cliente inválido!');
    }
    // BeforePost: com data de entrega a requisição está entregue; sem ela, "entregue" volta a "entregando"
    const m = { ...atual, ...p };
    if (m.data_entrega) p.status = 'E';
    else if (m.status === 'E') p.status = 'I';
  },
  async antesDeExcluir(id, ctx) {
    await comUsuario(ctx, (c) =>
      c.query('DELETE P FROM req_produtos P JOIN req R ON R.id = P.id_req WHERE P.id_req = ? AND R.id_grupo = ? AND R.id_empresa = ?', [id, ctx.grupoId, ctx.empresaId]),
    );
  },
});

registrarRegras('req_produtos', {
  async antesDeGravar(p, id, ctx) {
    let atual: any = {};
    if (id) {
      [[atual]] = await pool.query<any[]>('SELECT P.* FROM req_produtos P JOIN req R ON R.id = P.id_req WHERE P.id = ? AND R.id_grupo = ? AND R.id_empresa = ?', [id, ctx.grupoId, ctx.empresaId]);
      if (!atual) throw recusar('Produto da requisição não encontrado.', 404);
      delete p.id_req;
    }
    const [[req]] = await pool.query<any[]>('SELECT id, id_cliente FROM req WHERE id = ? AND id_grupo = ? AND id_empresa = ?', [id ? atual.id_req : p.id_req, ctx.grupoId, ctx.empresaId]);
    if (!req) throw recusar('Requisição não encontrada.', 404);
    if (!id) p.id_cliente = req.id_cliente;
    if (!(Number({ ...atual, ...p }.qtdade_req) > 0)) throw recusar('Quantidade inválida!');
    if (p.id_produto) {
      const [[pro]] = await pool.query<any[]>('SELECT id FROM produtos WHERE id = ? AND id_grupo = ?', [p.id_produto, ctx.grupoId]);
      if (!pro) throw recusar('Produto inválido!');
    }
    if ('id_contrato' in p) {
      if (Number(p.id_contrato) > 0) {
        if (!(Number(req.id_cliente) > 0)) throw recusar('Requisição tem que ter um cliente!');
        Object.assign(p, await contratoDoCliente(Number(p.id_contrato), Number(req.id_cliente), ctx));
      } else Object.assign(p, { id_contrato: null, id_equip: null, equip_descricao: null });
    }
  },
});

// ============================================================
// SQL das listas (os do Delphi, com os nomes de tabela em minúsculas: o MySQL do Linux diferencia)
// ============================================================

const SQL_OS = `
  SELECT O.id, O.id_grupo, O.id_empresa, O.id_cliente, O.os_tipo, T.descricao tipo_descricao,
         P.nome cliente_nome, P.endereco, P.endereco_complemento, P.endereco_nr, P.endereco_cidade, P.endereco_uf, P.fone_fixo,
         O.id_equip, O.id_contrato, O.id_produto, O.id_os_cliente, O.equip_descricao,
         M.descricao marca_descricao, Q.modelo, C.setor,
         O.cnpj_cliente, O.nome_req, O.data_os, O.qtdade_os, O.data_execucao, O.qtdade_usada,
         O.defeito_cliente, O.defeito_constatado, O.servico_realizado, O.obs, O.obs_interna,
         O.datahora_inclusao, O.id_usuario_inclusao, U.nome usuario_nome, O.status, O.status_impressao,
         O.valor_servicos, O.valor_pecas, O.valor_terceiros, O.valor_total_bruto,
         O.valor_acrescimos, O.valor_descontos, O.valor_total_liquido
    FROM os O
    LEFT JOIN os_tipos T ON T.id = O.os_tipo
    LEFT JOIN pessoas P ON P.id = O.id_cliente
    LEFT JOIN locacao_contratos C ON C.id = O.id_contrato
    LEFT JOIN equipamentos Q ON Q.id = O.id_equip
    LEFT JOIN equipamentos_marcas M ON M.id = Q.id_marca
    LEFT JOIN usuarios U ON U.id = O.id_usuario_inclusao
   WHERE O.id_grupo = ? AND O.id_empresa = ?`;

const SQL_PECAS = `
  SELECT P.id, P.id_os, P.id_produto, P.nr_serie, A.descricao produto_descricao, P.qtdade, P.qtdade_entregue,
         P.valor_unit, P.valor_total, P.obs, P.status, P.status_impressao
    FROM os_pecas P
    JOIN os O ON O.id = P.id_os AND O.id_grupo = ? AND O.id_empresa = ?
    LEFT JOIN produtos A ON A.id = P.id_produto
   WHERE P.id_os = ?
   ORDER BY P.id`;

const SQL_REQ = `
  SELECT R.id, R.id_cliente, P.nome cliente_nome, P.fantasia cliente_fantasia, P.email cliente_email,
         R.data_req, R.data_entrega, R.obs, R.id_usuario_inclusao, U.nome usuario_nome, R.datahora_inclusao, R.status_impressao, R.status
    FROM req R
    LEFT JOIN pessoas P ON P.id = R.id_cliente
    LEFT JOIN usuarios U ON U.id = R.id_usuario_inclusao
   WHERE R.id_grupo = ? AND R.id_empresa = ?`;

const SQL_REQ_PRODUTOS = `
  SELECT R.id, R.id_req, R.id_cliente, P.nome cliente_nome, R.id_equip, M.descricao marca_descricao, Q.modelo, C.setor,
         R.id_contrato, R.id_produto, T.descricao produto_descricao, R.id_req_cliente, R.equip_descricao, R.cnpj_cliente,
         R.nome_req, R.datahora_req, R.qtdade_req, R.datahora_entrega, R.qtdade_entregue, R.obs, R.status, R.status_impressao
    FROM req_produtos R
    JOIN req Q0 ON Q0.id = R.id_req AND Q0.id_grupo = ? AND Q0.id_empresa = ?
    LEFT JOIN pessoas P ON P.id = R.id_cliente
    LEFT JOIN equipamentos Q ON Q.id = R.id_equip
    LEFT JOIN equipamentos_marcas M ON M.id = Q.id_marca
    LEFT JOIN locacao_contratos C ON C.id = R.id_contrato
    LEFT JOIN produtos T ON T.id = R.id_produto
   WHERE R.id_req = ?
   ORDER BY R.id`;

/** Sem paginação no Delphi; "Todos" pode ter anos de OS. ponytail: últimos LIMITE_TODOS; paginar se fizer falta */
const LIMITE_TODOS = 3000;

// ============================================================
// Impressão (layouts .fr3 do Delphi convertidos em HTML A4)
// ============================================================

const CSS_A4 = `
  @page { size: A4; margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; margin: 0; }
  .topo { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 8px; }
  .emitente { font-size: 10px; line-height: 1.4; }
  .emitente b { font-size: 13px; }
  .numero { font-size: 18px; font-weight: bold; text-align: right; }
  h2 { font-size: 14px; text-align: center; margin: 8px 0; }
  .ficha { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  .ficha td { padding: 3px 4px; border-bottom: 1px dotted #999; }
  .ficha td.r { width: 130px; font-weight: bold; white-space: nowrap; }
  table.lista { width: 100%; border-collapse: collapse; margin: 6px 0; }
  table.lista th, table.lista td { border: 1px solid #555; padding: 4px; text-align: left; }
  table.lista th { background: #eee; }
  table.lista td.n { text-align: right; }
  .vazio td { height: 18px; }
  .obs { border: 1px solid #555; min-height: 60px; padding: 4px; margin-top: 6px; }
  .assinaturas { display: flex; gap: 40px; margin-top: 50px; }
  .assinaturas div { flex: 1; border-top: 1px solid #111; text-align: center; padding-top: 3px; }
  .bloco { margin-top: 6px; }
`;

function cabecalhoEmpresa(e: any, direita: string) {
  const end = [e.endereco, e.numero].filter(Boolean).join(', ');
  const cidade = [e.cep ? `CEP: ${e.cep}` : '', [e.cidade, e.uf].filter(Boolean).join(' - ')].filter(Boolean).join(' - ');
  return `<div class="topo"><div class="emitente"><b>${esc(e.razao_social || e.nome_comercial)}</b><br>${esc(end)}${e.bairro ? ` - ${esc(e.bairro)}` : ''}<br>${esc(cidade)}<br>
    ${e.ie ? `I.E: ${esc(e.ie)} &nbsp; ` : ''}${e.cnpj ? `CNPJ: ${esc(e.cnpj)}` : ''}${e.email_financeiro ? `<br>${esc(e.email_financeiro)}` : ''}</div><div class="numero">${direita}</div></div>`;
}

function fichaCliente(o: any) {
  const linha = (r: string, v: unknown) => `<tr><td class="r">${r}</td><td>${esc(v)}</td></tr>`;
  return `<table class="ficha">${linha('CLIENTE', o.cliente_nome)}${linha('ENDEREÇO', [o.endereco, o.endereco_complemento, o.endereco_nr].filter(Boolean).join(' '))}
    ${linha('CIDADE', [o.endereco_cidade, o.endereco_uf].filter(Boolean).join(' / '))}${linha('CNPJ', o.cnpj_cliente)}
    <tr><td class="r">NOME CONTATO</td><td>${esc(o.nome_req)} &nbsp; &nbsp; <b>FONE:</b> ${esc(o.fone_fixo)}</td></tr></table>`;
}

const rodapeAssinatura = (texto = '') =>
  `${texto ? `<p class="bloco">${texto}</p>` : ''}<div class="bloco"><b>OBSERVAÇÕES:</b><div class="obs"></div></div><div class="assinaturas"><div>LOCAL E DATA</div><div>ASSINATURA CLIENTE</div></div>`;

const equipamento = (o: any) => [`${o.marca_descricao ?? ''} ${o.modelo ?? ''}`.trim(), o.setor].filter(Boolean).join(' - ');
const qtd = (v: unknown) => formatarNumero(v, ',0.##');

const ROTULO_TIPO: Record<string, string> = { C: 'CONTRATO', F: 'FATURADO', D: 'DEVOLUÇÃO' };

/** Uma OS pelo tipo (os_contrato/faturado/devolucao, os_entrega, os_requisicao, os_recarga) */
export function htmlOs(o: any, pecas: any[], empresa: any): string {
  const tipo = String(o.os_tipo || 'S');
  const listaPecas = (titulo: string, colProduto: string) =>
    `<h2>${titulo}</h2><table class="lista"><tr><th>${colProduto}</th><th style="width:90px">QTDADE.</th></tr>
     ${pecas.map((p) => `<tr><td>${esc(p.produto_descricao)} (Id: ${esc(p.id_produto)})</td><td class="n">${qtd(p.qtdade)}</td></tr>`).join('') || '<tr class="vazio"><td></td><td></td></tr>'}</table>`;
  let corpo: string;
  if (tipo === 'E') {
    corpo = `<h2>ENTREGA DE EQUIPAMENTO</h2>${fichaCliente(o)}<p><b>Impressora Entregue:</b> ${esc(equipamento(o))}</p>
      ${listaPecas('PEÇAS / PRODUTOS ENTREGUES', 'PEÇA / PRODUTO')}${rodapeAssinatura('Confirmo que recebi os equipamentos acima.')}`;
  } else if (tipo === 'R' || tipo === 'G') {
    const rotulo = tipo === 'R' ? `<p><b>Requisição de Cartucho para:</b> ${esc(equipamento(o))}</p>` : '<p><b>Recarga de Cartucho</b></p>';
    corpo = `<h2>${tipo === 'R' ? 'REQUISIÇÃO DE CARTUCHO' : 'RECARGA DE CARTUCHO'}</h2>${fichaCliente(o)}${rotulo}
      ${o.defeito_cliente ? `<p><b>Mensagem:</b> ${esc(o.defeito_cliente)}</p>` : ''}${listaPecas('CARTUCHOS ENTREGUES', 'PRODUTO')}${rodapeAssinatura('Confirmo que recebi os produtos acima.')}`;
  } else {
    const vazias = Array.from({ length: 8 }, () => '<tr class="vazio"><td></td><td></td><td></td></tr>').join('');
    corpo = `<h2>ORDEM DE SERVIÇO${ROTULO_TIPO[tipo] ? ` - ${ROTULO_TIPO[tipo]}` : ''}</h2>${fichaCliente(o)}
      <p><b>Equipamento:</b> ${esc(equipamento(o))}</p><p><b>Defeito Informado:</b> ${esc(o.defeito_cliente)}</p>
      <h2>PEÇAS USADAS NA OS</h2><table class="lista"><tr><th style="width:90px">CÓDIGO</th><th>PEÇA</th><th style="width:90px">QTDADE.</th></tr>${vazias}</table>
      ${rodapeAssinatura()}`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS_A4}</style></head><body>${cabecalhoEmpresa(empresa, `OS Nr: ${esc(o.id)}`)}${corpo}</body></html>`;
}

/** Várias OS marcadas (os_req): uma linha por peça de cada OS */
export function htmlOsReq(o: any, linhas: any[], empresa: any): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS_A4}</style></head><body>${cabecalhoEmpresa(empresa, 'ENTREGA CARTUCHO/CILINDRO')}
    ${fichaCliente(o)}<h2>CARTUCHOS/CILINDROS ENTREGUES</h2>
    <table class="lista"><tr><th>PRODUTO</th><th>ID.PROD.</th><th>OS</th><th>QTD.</th><th>IMPRESSORA</th></tr>
    ${linhas.map((l) => `<tr><td>${esc(l.pro_descricao)}</td><td>${esc(l.pro_id)}</td><td>${esc(l.id)}</td><td class="n">${qtd(l.qtdade_os)}</td><td>${esc([l.marca_descricao, l.modelo, l.setor].filter(Boolean).join(' '))}</td></tr>`).join('')}
    </table>${rodapeAssinatura()}</body></html>`;
}

/** Requisição de material (requisicao.fr3) */
export function htmlRequisicao(r: any, produtos: any[], empresa: any): string {
  const p0 = produtos[0] ?? {};
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS_A4}</style></head><body>${cabecalhoEmpresa(empresa, `Requisição Nr: ${esc(r.id)}`)}
    <h2>REQUISIÇÃO MATERIAL / CARTUCHO</h2>
    <table class="ficha"><tr><td class="r">CLIENTE</td><td>${esc(r.cliente_nome)}</td></tr><tr><td class="r">CNPJ</td><td>${esc(p0.cnpj_cliente)}</td></tr></table>
    <h2>MATERIAIS / CARTUCHOS</h2>
    <table class="lista"><tr><th>EQUIPAMENTO / NR. SÉRIE</th><th>MARCA</th><th>MODELO</th><th>SETOR</th><th>PRODUTO</th><th>QTD.</th><th>REQUISITADO POR</th></tr>
    ${produtos.map((p) => `<tr><td>${esc(p.id_equip)}</td><td>${esc(p.marca_descricao)}</td><td>${esc(p.modelo)}</td><td>${esc(p.setor)}</td><td>${esc(p.produto_descricao)}</td><td class="n">${qtd(p.qtdade_req)}</td><td>${esc(p.nome_req)}</td></tr>`).join('')}
    </table><div class="bloco"><b>Observações:</b><div class="obs">${esc(r.obs)}</div></div>
    <div class="assinaturas"><div>LOCAL E DATA</div><div>ASSINATURA CLIENTE</div></div></body></html>`;
}

/** Grade de resultado da consulta (o layout .fr3 guardado no banco não roda na web) */
export function htmlConsulta(titulo: string, filtros: string, abas: AbaConsulta[]): string {
  const celula = (c: ColunaConsulta, v: unknown) => {
    if (v === null || v === undefined) return '';
    if (c.tipo === 'dec' || (c.tipo === 'int' && c.formato)) return formatarNumero(v, c.formato || ',0.00');
    if (c.tipo === 'date') return String(v).slice(0, 10).split('-').reverse().join('/');
    if (c.tipo === 'datetime') return `${String(v).slice(0, 10).split('-').reverse().join('/')} ${String(v).slice(11, 19)}`;
    return String(v);
  };
  const css = `@page { size: A4 landscape; margin: 10mm; } body { font-family: Arial, sans-serif; font-size: 9px; } h1 { font-size: 14px; margin: 0 0 2px; }
    h2 { font-size: 11px; margin: 10px 0 4px; } .f { color: #555; margin-bottom: 6px; } table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #999; padding: 2px 4px; } th { background: #eee; } td.n { text-align: right; } td.c { text-align: center; } thead { display: table-header-group; }`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><h1>${esc(titulo)}</h1><div class="f">${esc(filtros)}</div>
    ${abas
      .map(
        (a) => `${abas.length > 1 ? `<h2>${esc(a.titulo)}</h2>` : ''}<table><thead><tr>${a.colunas.map((c) => `<th>${esc(c.titulo)}</th>`).join('')}</tr></thead><tbody>
      ${a.linhas
        .map((l) => `<tr>${a.colunas.map((c) => `<td class="${c.tipo === 'int' || c.tipo === 'dec' ? 'n' : c.tipo === 'date' || c.tipo === 'datetime' ? 'c' : ''}">${esc(celula(c, l[c.campo]))}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>${a.truncado ? `<p>Mostrando só as primeiras ${a.linhas.length} linhas.</p>` : ''}`,
      )
      .join('')}</body></html>`;
}

async function enviarPdf(res: Response, html: string, nome: string) {
  const pdf = await gerarPdf(html);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nome}"`);
  res.send(pdf);
}

// ============================================================
// E-mails (modelos de grupos/<id>/cfg/*.txt do Delphi, com as mesmas variáveis)
// ============================================================

const EMAIL_OS = `<html><body><font face="Courier New">
Bom dia, @contato,<br><br>
Sua solicitação foi recebida e está sendo processada.<br><br>
Empresa solicitante: @nome_cliente<br>
Impressora: @equipamento<br><br>
Número OS: <b>@nr_os</b><br>
Mensagem da OS: <b>@comentario</b><br><br>
Por favor, confirme o recebimento desse email.<br>
Duvidas, estaremos a disposição.<br>
Atenciosamente,<br><br>
________________________________<br>
@nome_empresa<br>
@nome_usuario
</font></body></html>`;

const EMAIL_NOTA_RUIM = `<html><body><font face="Courier New">
A/C Depto. Relacionamento com o Cliente,<br><br>
Um cliente seu avaliou o seu atendimento abaixo da nota "4".<br><br>
Empresa que avaliou: @nome_cliente<br>
Pessoa que avaliou: @contato<br>
Nota da avaliação: @nota<br>
Comentário na avaliação: @obs_avaliacao<br><br>
Sugiro que você dê uma atenção especial para esse cliente.<br>
Atenciosamente,<br><br>
PrintControl - Sistema para Controle de Locação de Impressoras
</font></body></html>`;

const EMAIL_REQUISICAO = `<html><body><font face="Courier New">
Bom dia, @contato,<br><br>
Sua(s) requisição(ões) de cartucho foram recebidas e estão sendo processadas.<br><br>
Empresa requisitante: @nome_cliente<br><br>
Produtos requisitados:<br>
---------------------<br><br>
@produtos_requisitados<br><br>
@comentario<br><br>
Por favor, confirme o recebimento desse email.<br>
Duvidas, estaremos a disposição.<br>
Atenciosamente,<br><br>
________________________________<br>
@nome_empresa<br>
@nome_usuario
</font></body></html>`;

const CONTATO_PADRAO = 'A/C Responsável pelas Impressoras Locadas';

/** Empresa ativa e grupo (remetente e cabeçalhos) */
async function empresaAtiva(ctx: Contexto) {
  const [[e]] = await pool.query<any[]>(
    'SELECT E.*, G.nome grupo_nome FROM empresas_filiais E LEFT JOIN empresas_grupos G ON G.id = E.id_grupo WHERE E.id = ? AND E.id_grupo = ?',
    [ctx.empresaId, ctx.grupoId],
  );
  return e ?? {};
}

type Envio = { para: string; assunto: string; html: string; descricao: string };

/** Envia depois de gravar: falha de e-mail não desfaz nada, vira aviso para a tela */
async function enviarTodos(envios: Envio[], empresa: any): Promise<string[]> {
  if (!envios.length) return [];
  if (!emailConfigurado()) return [`E-mails não enviados (${envios.length}): SMTP não configurado no servidor.`];
  const avisos: string[] = [];
  for (const e of envios) {
    try {
      await enviarEmail({ para: e.para, assunto: e.assunto, html: e.html, nomeRemetente: empresa.grupo_nome || undefined, responderPara: empresa.email_financeiro || undefined });
    } catch (err: any) {
      avisos.push(`${e.descricao}: ${err.message}`);
    }
  }
  return avisos;
}

// ============================================================
// Consultas configuráveis
// ============================================================

export interface AbaConsulta {
  n: number;
  titulo: string;
  colunas: ColunaConsulta[];
  linhas: Record<string, unknown>[];
  truncado: boolean;
}

/** Linhas devolvidas por SQL (o Delphi não limitava; ponytail: subir se alguém precisar, o PDF/Excel saem do mesmo resultado) */
const LIMITE_LINHAS = 5000;
const TEMPO_MAXIMO_MS = 30_000;

/** Tipo da coluna pelo código do MySQL (mysql2 FieldPacket.columnType) */
function tipoColuna(f: any): TipoColuna {
  const t = Number(f.columnType ?? f.type);
  if ([1, 2, 3, 8, 9, 13].includes(t)) return 'int';
  if ([0, 4, 5, 246].includes(t)) return 'dec';
  if ([10, 14].includes(t)) return 'date';
  if ([7, 12].includes(t)) return 'datetime';
  return 'str';
}

/** Tamanho em caracteres (o MySQL informa bytes: 3 por caractere em utf8, 4 em utf8mb4) */
const tamanho = (f: any) => {
  const cs = Number(f.characterSet);
  const bytes = cs === 63 || cs === 8 || cs === 48 ? 1 : cs === 33 || cs === 83 || (cs >= 192 && cs <= 215) ? 3 : 4;
  return Math.ceil(Number(f.columnLength ?? f.length ?? 0) / bytes);
};

/** Consulta que o usuário pode ver: do grupo, ativa, do nível dele e (se houver lista) liberada para ele */
const SQL_CONSULTAS_PERMITIDAS = `
  FROM consultas
 WHERE id_grupo = ? AND status = 'A' AND COALESCE(NULLIF(nivel_usuario, ''), 'Z') >= ?
   AND (COALESCE(TRIM(usuarios_liberados), '') = '' OR FIND_IN_SET(?, REPLACE(REPLACE(usuarios_liberados, ' ', ''), ';', ',')) > 0)`;

async function consultaPermitida(id: number, res: Response) {
  const u = res.locals.usuario;
  const [[c]] = await pool.query<any[]>(`SELECT * ${SQL_CONSULTAS_PERMITIDAS} AND id = ?`, [res.locals.grupoId, String(u?.nivel || 'Z').charAt(0).toUpperCase(), String(res.locals.usuarioId), id]);
  if (!c) throw recusar('Consulta não encontrada ou não liberada para você.', 404);
  return c;
}

/** Executa os comandos em transação READ ONLY, com tempo máximo, e devolve o resultado do último */
async function rodarSql(conn: PoolConnection, sql: string, valores: Record<string, unknown>) {
  const cmds = dividirComandos(sql);
  for (const c of cmds) {
    const motivo = motivoRecusa(c);
    if (motivo) throw recusar(motivo, 400);
  }
  let ultimo: [any[], any[]] = [[], []];
  for (const c of cmds) {
    const { sql: texto, params } = prepararSql(c, valores);
    ultimo = (await conn.execute({ sql: texto, timeout: TEMPO_MAXIMO_MS + 5000 }, params as any[])) as any;
  }
  return ultimo;
}

async function comConexaoLeitura<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.query(`SET SESSION max_execution_time = ${TEMPO_MAXIMO_MS}`);
    await conn.query('START TRANSACTION READ ONLY');
    return await fn(conn);
  } catch (err: any) {
    if (err.code === 'ER_QUERY_TIMEOUT' || err.code === 'PROTOCOL_SEQUENCE_TIMEOUT' || /max_execution_time|timeout/i.test(err.message)) {
      throw recusar(`A consulta passou de ${TEMPO_MAXIMO_MS / 1000} segundos e foi interrompida.`, 400);
    }
    if (err.code === 'ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION') throw recusar('A consulta tentou gravar no banco: só leitura é permitida.', 400);
    if (err.sqlMessage) throw recusar(`Erro no SQL da consulta: ${err.sqlMessage}`, 400);
    throw err;
  } finally {
    await conn.query('ROLLBACK').catch(() => {});
    await conn.query('SET SESSION max_execution_time = 0').catch(() => {});
    conn.release();
  }
}

async function executarConsulta(c: any, brutos: Record<string, unknown>, res: Response): Promise<AbaConsulta[]> {
  const valores: Record<string, unknown> = {};
  for (const p of parseParametros(c.parametros)) valores[p.nome] = valorParametro(p, brutos?.[p.nome] ?? brutos?.[p.nome.toLowerCase()]);
  // Grupo e empresa sempre da sessão, mesmo que algum parâmetro tenha o mesmo nome
  valores.id_grupo = Number(res.locals.grupoId);
  valores.id_empresa = Number(res.locals.empresaId);
  return comConexaoLeitura(async (conn) => {
    const abas: AbaConsulta[] = [];
    for (const n of [1, 2, 3, 4]) {
      const sql = String(c[`sql${n}`] ?? '');
      if (!sql.trim()) continue;
      const [rows, fields] = await rodarSql(conn, sql, valores);
      const titulos = parseTitulos(c[`sql${n}_titulos`]);
      const colunas = (fields ?? []).map((f: any) => formatarColuna(f.name, tipoColuna(f), tamanho(f), titulos));
      const linhas = (Array.isArray(rows) ? rows : []).slice(0, LIMITE_LINHAS).map((r: any) => {
        for (const k of Object.keys(r)) if (Buffer.isBuffer(r[k])) r[k] = r[k].toString('utf8');
        return r;
      });
      abas.push({ n, titulo: tituloAba(sql, n), colunas, linhas, truncado: Array.isArray(rows) && rows.length > LIMITE_LINHAS });
    }
    return abas;
  });
}

// ============================================================
// Rotas
// ============================================================

const nivelMinimo = (nivel: string) => (_req: Request, res: Response, next: NextFunction) =>
  temNivel(res, nivel) ? next() : res.status(403).json({ error: 'Seu nível de usuário não acessa esta opção.' });

const falha = (res: Response, err: any) => res.status(err.status || 400).json({ error: err.message || 'Erro inesperado.' });

const ids = (v: unknown): number[] =>
  (Array.isArray(v) ? v : String(v ?? '').split(','))
    .map((x) => Math.trunc(Number(x)))
    .filter((x) => x > 0)
    .slice(0, 500);

export function createOsRouter() {
  const router = Router();
  const T = nivelMinimo('T');
  const A = nivelMinimo('A');

  // ----------------------------------------------------------
  // Ordens de Serviço
  // ----------------------------------------------------------
  router.get('/os/lista', T, async (req, res) => {
    try {
      const status = String(req.query.status || 'A').charAt(0).toUpperCase();
      const params: any[] = [res.locals.grupoId, res.locals.empresaId];
      let sql = SQL_OS;
      if (status !== 'T') {
        sql += ' AND O.status = ?';
        params.push(status);
      }
      const [rows] = await pool.query<any[]>(`SELECT * FROM (${sql} ORDER BY O.id DESC LIMIT ${LIMITE_TODOS}) X ORDER BY X.id`, params);
      res.json(rows);
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Tipos de OS, clientes (cliente_flag e ativos) e produtos do grupo para os formulários */
  router.get('/os/apoio', T, async (_req, res) => {
    try {
      const g = res.locals.grupoId;
      const [tipos] = await pool.query<any[]>('SELECT id, descricao FROM os_tipos ORDER BY id');
      const [clientes] = await pool.query<any[]>(
        "SELECT id, nome, cpf_cnpj, endereco_cidade FROM pessoas WHERE id_grupo = ? AND cliente_flag = 'S' AND ativo = 'S' ORDER BY nome",
        [g],
      );
      const [produtos] = await pool.query<any[]>(
        "SELECT id, descricao, descricao_curta, preco_venda FROM produtos WHERE id_grupo = ? AND COALESCE(ativo, 'S') <> 'N' ORDER BY descricao",
        [g],
      );
      res.json({ tipos, clientes, produtos });
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Pesquisa de contrato (CON): contratos do cliente na empresa ativa */
  router.get('/os/contratos', T, async (req, res) => {
    try {
      const [rows] = await pool.query<any[]>(
        `SELECT C.id, C.id_cliente, C.id_equip, M.descricao marca, E.modelo, C.setor, COALESCE(NULLIF(C.nr_serie, ''), E.nr_serie) nr_serie
           FROM locacao_contratos C
           LEFT JOIN equipamentos E ON E.id = C.id_equip
           LEFT JOIN equipamentos_marcas M ON M.id = E.id_marca
          WHERE C.id_grupo = ? AND C.id_empresa = ? AND C.id_cliente = ?
          ORDER BY C.id`,
        [res.locals.grupoId, res.locals.empresaId, Number(req.query.cliente) || 0],
      );
      res.json(rows);
    } catch (err: any) {
      falha(res, err);
    }
  });

  router.get('/os/:id/pecas', T, async (req, res) => {
    try {
      const [rows] = await pool.query<any[]>(SQL_PECAS, [res.locals.grupoId, res.locals.empresaId, Number(req.params.id)]);
      res.json(rows);
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Executar (A → E) e Finalizar (A/E → F): o Delphi não conferia o status atual */
  router.post('/os/:id/executar', T, async (req, res) => {
    try {
      const ctx = contexto(res);
      const [[o]] = await pool.query<any[]>('SELECT status FROM os WHERE id = ? AND id_grupo = ? AND id_empresa = ?', [Number(req.params.id), ctx.grupoId, ctx.empresaId]);
      if (!o) throw recusar('OS não encontrada.', 404);
      if (o.status === 'E') throw recusar('A OS já está em execução.');
      if (o.status === 'F') throw recusar('A OS já está fechada.');
      await comUsuario(ctx, (c) => c.query("UPDATE os SET status = 'E' WHERE id = ? AND id_grupo = ? AND id_empresa = ?", [Number(req.params.id), ctx.grupoId, ctx.empresaId]));
      res.json({ success: true });
    } catch (err: any) {
      falha(res, err);
    }
  });

  router.post('/os/:id/finalizar', T, async (req, res) => {
    try {
      const ctx = contexto(res);
      const b = req.body || {};
      const [[o]] = await pool.query<any[]>('SELECT status FROM os WHERE id = ? AND id_grupo = ? AND id_empresa = ?', [Number(req.params.id), ctx.grupoId, ctx.empresaId]);
      if (!o) throw recusar('OS não encontrada.', 404);
      if (o.status === 'F') throw recusar('A OS já está fechada.');
      const data = /^\d{4}-\d{2}-\d{2}$/.test(String(b.data_execucao || '')) ? b.data_execucao : hoje();
      await comUsuario(ctx, (c) =>
        c.query("UPDATE os SET status = 'F', data_execucao = ?, defeito_constatado = ?, servico_realizado = ? WHERE id = ? AND id_grupo = ? AND id_empresa = ?", [
          data,
          String(b.defeito_constatado ?? '').slice(0, 255) || null,
          String(b.servico_realizado ?? '').slice(0, 255) || null,
          Number(req.params.id),
          ctx.grupoId,
          ctx.empresaId,
        ]),
      );
      res.json({ success: true });
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Entregar Todos: qtdade_entregue = qtdade em todas as peças (as validações da peça valem; tudo ou nada) */
  router.post('/os/:id/entregar-todos', T, async (req, res) => {
    try {
      const ctx = contexto(res);
      const [[o]] = await pool.query<any[]>('SELECT id, qtdade_os FROM os WHERE id = ? AND id_grupo = ? AND id_empresa = ?', [Number(req.params.id), ctx.grupoId, ctx.empresaId]);
      if (!o) throw recusar('OS não encontrada.', 404);
      const nivel = await nivelDe(ctx.usuarioId);
      const [pecas] = await pool.query<any[]>('SELECT id, qtdade, valor_unit FROM os_pecas WHERE id_os = ?', [o.id]);
      const novos = pecas.map((p) => {
        try {
          return { id: p.id, qtdade: p.qtdade, total: validarPeca({ qtdade: p.qtdade, qtdade_entregue: p.qtdade, valor_unit: p.valor_unit }, Number(o.qtdade_os) || 0, nivel) };
        } catch (e: any) {
          throw recusar(`Peça ${p.id}: ${e.message}`);
        }
      });
      await comUsuario(ctx, async (c) => {
        for (const p of novos) await c.query('UPDATE os_pecas SET qtdade_entregue = ?, valor_total = ? WHERE id = ?', [p.qtdade, p.total, p.id]);
      });
      res.json({ success: true, total: novos.length });
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Peça da OS da empresa ativa, com o cliente da OS */
  const pecaComOs = async (id: number, ctx: Contexto) => {
    const [[p]] = await pool.query<any[]>(
      'SELECT P.id, P.id_produto, P.nr_serie, O.id_cliente FROM os_pecas P JOIN os O ON O.id = P.id_os WHERE P.id = ? AND O.id_grupo = ? AND O.id_empresa = ?',
      [id, ctx.grupoId, ctx.empresaId],
    );
    if (!p) throw recusar('Peça não encontrada.', 404);
    return p;
  };

  /** VOID: atribui a etiqueta (nº de série) cadastrada em produtos_clientes à peça e ao cliente da OS */
  router.post('/os/pecas/:id/void', T, async (req, res) => {
    try {
      const ctx = contexto(res);
      const nr = String(req.body?.nr_serie ?? '').trim().slice(0, 25);
      if (!nr) throw recusar('Digite o Nr. da Etiqueta VOID.');
      const p = await pecaComOs(Number(req.params.id), ctx);
      if (p.nr_serie) throw recusar('Nr. série já atribuido!');
      const [[v]] = await pool.query<any[]>('SELECT id_cliente FROM produtos_clientes WHERE id_grupo = ? AND id_empresa = ? AND nr_serie = ? LIMIT 1', [ctx.grupoId, ctx.empresaId, nr]);
      if (!v) throw recusar('Nr. série não registrado!');
      if (Number(v.id_cliente) > 0 && Number(v.id_cliente) !== Number(p.id_cliente)) throw recusar('Nr. série já registrado para outro cliente!');
      await comUsuario(ctx, async (c) => {
        await c.query('UPDATE os_pecas SET nr_serie = ? WHERE id = ?', [nr, p.id]);
        await c.query('UPDATE produtos_clientes SET id_cliente = ?, id_produto = ? WHERE id_grupo = ? AND id_empresa = ? AND nr_serie = ?', [p.id_cliente, p.id_produto, ctx.grupoId, ctx.empresaId, nr]);
      });
      res.json({ success: true });
    } catch (err: any) {
      falha(res, err);
    }
  });

  router.post('/os/pecas/:id/limpar-void', T, async (req, res) => {
    try {
      const ctx = contexto(res);
      const p = await pecaComOs(Number(req.params.id), ctx);
      if (!p.nr_serie) return res.json({ success: true });
      await comUsuario(ctx, async (c) => {
        await c.query('UPDATE produtos_clientes SET id_cliente = NULL, id_produto = NULL WHERE id_grupo = ? AND id_empresa = ? AND nr_serie = ?', [ctx.grupoId, ctx.empresaId, p.nr_serie]);
        await c.query('UPDATE os_pecas SET nr_serie = NULL WHERE id = ?', [p.id]);
      });
      res.json({ success: true });
    } catch (err: any) {
      falha(res, err);
    }
  });

  const SQL_OS_CLIENTE = `
    SELECT O.id, O.id_cliente, P.nome cliente_nome, P.email, O.id_equip, O.id_contrato, O.equip_descricao, Q.modelo, M.descricao marca_descricao, C.setor,
           O.cnpj_cliente, O.nome_req, O.qtdade, O.qtdade_cil, O.datahora_os, O.datahora_status, O.status, O.tipo_os, O.nota_avaliacao, O.obs_avaliacao, O.obs
      FROM os_cliente O
      LEFT JOIN pessoas P ON P.id = O.id_cliente
      LEFT JOIN locacao_contratos C ON C.id = O.id_contrato
      LEFT JOIN equipamentos Q ON Q.id = O.id_equip
      LEFT JOIN equipamentos_marcas M ON M.id = Q.id_marca
     WHERE O.id_grupo = ? AND O.id_empresa = ? AND O.status = 'A'`;

  /** OS Pendentes: pedidos dos clientes ainda não gerados */
  router.get('/os/pendentes', T, async (_req, res) => {
    try {
      const [rows] = await pool.query<any[]>(`${SQL_OS_CLIENTE} ORDER BY O.id_cliente, O.id`, [res.locals.grupoId, res.locals.empresaId]);
      res.json(rows);
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Gerar OS: uma OS de cartuchos (qtdade) e outra de cilindros (qtdade_cil) por pedido marcado; o pedido vira 'R' */
  router.post('/os/gerar', T, async (req, res) => {
    try {
      const ctx = contexto(res);
      const marcados = ids(req.body?.ids);
      if (!marcados.length) throw recusar('Marque ao menos um pedido para gerar.');
      const [pedidos] = await pool.query<any[]>(`${SQL_OS_CLIENTE} AND O.id IN (?) ORDER BY O.id_cliente, O.id`, [ctx.grupoId, ctx.empresaId, marcados]);
      const empresa = await empresaAtiva(ctx);
      const usuario = res.locals.usuario;
      const envios: Envio[] = [];
      const geradas: number[] = [];
      await comUsuario(ctx, async (c) => {
        for (const o of pedidos) {
          const base = {
            id_grupo: ctx.grupoId,
            id_empresa: ctx.empresaId,
            id_cliente: o.id_cliente,
            id_equip: o.id_equip,
            id_contrato: o.id_contrato,
            id_os_cliente: o.id,
            equip_descricao: o.equip_descricao,
            cnpj_cliente: o.cnpj_cliente,
            nome_req: o.nome_req,
            data_os: String(o.datahora_os || hoje()).slice(0, 10),
            defeito_cliente: o.obs,
            datahora_inclusao: agora(),
            id_usuario_inclusao: ctx.usuarioId,
            os_tipo: o.tipo_os || 'C',
            status: 'A',
            status_impressao: 'N',
          };
          const inserir = async (qtdade: number, obs: string | null) => {
            const [r] = await c.query<any>('INSERT INTO os SET ?', [{ ...base, qtdade_os: qtdade, obs }]);
            geradas.push(r.insertId);
            return Number(r.insertId);
          };
          let ultima = 0;
          const cart = Math.trunc(Number(o.qtdade) || 0);
          const cil = Math.trunc(Number(o.qtdade_cil) || 0);
          if (cart > 0) ultima = await inserir(cart, o.tipo_os === 'R' ? `${cart} Cartucho(s)` : null);
          if (cil > 0) ultima = await inserir(cil, `${cil} Cilindro(s)`);
          await c.query("UPDATE os_cliente SET status = 'R', datahora_status = NOW() WHERE id = ?", [o.id]);

          const equip = [o.marca_descricao, o.modelo, o.setor].filter(Boolean).join(' ');
          const vars = { '@nome_empresa': esc(empresa.nome_comercial), '@nome_usuario': esc(usuario?.nome), '@comentario': esc(o.obs), '@equipamento': esc(equip), '@nome_cliente': esc(o.cliente_nome) };
          // Sem OS gerada, o Delphi mandava o número da OS anterior: aqui não manda
          if (ultima && o.email)
            envios.push({
              para: o.email,
              assunto: `${empresa.grupo_nome ?? ''} - Confirmação de Abertura de OS`,
              html: aplicarVariaveis(EMAIL_OS, { ...vars, '@nr_os': String(ultima).padStart(5, '0'), '@contato': CONTATO_PADRAO }),
              descricao: `E-mail da OS ${ultima} para ${o.email}`,
            });
          const nota = Number(o.nota_avaliacao) || 0;
          if (nota > 0 && nota < 4 && empresa.email_diretoria)
            envios.push({
              para: empresa.email_diretoria,
              assunto: `${empresa.grupo_nome ?? ''} - Avaliação abaixo de "4"`,
              html: aplicarVariaveis(EMAIL_NOTA_RUIM, { ...vars, '@contato': esc(o.nome_req), '@nota': nota, '@obs_avaliacao': esc(o.obs_avaliacao) }),
              descricao: 'E-mail de avaliação abaixo de 4 para a diretoria',
            });
        }
      });
      const avisos = await enviarTodos(envios, empresa);
      res.json({ success: true, geradas, pedidos: pedidos.length, avisos });
    } catch (err: any) {
      falha(res, err);
    }
  });

  /**
   * Imprimir OS: sem OS marcadas, o layout do tipo da OS atual; com marcadas, os_req (o Delphi carregava um nome vazio).
   * Depois marca a OS atual como impressa (só ela, como no Delphi).
   */
  router.get('/os/:id/imprimir', T, async (req, res) => {
    try {
      const ctx = contexto(res);
      const id = Number(req.params.id);
      const [[o]] = await pool.query<any[]>(`${SQL_OS} AND O.id = ?`, [ctx.grupoId, ctx.empresaId, id]);
      if (!o) throw recusar('OS não encontrada.', 404);
      const empresa = await empresaAtiva(ctx);
      const marcadas = ids(req.query.marcadas);
      let html: string;
      if (marcadas.length) {
        const [linhas] = await pool.query<any[]>(
          `SELECT O.id, B.qtdade qtdade_os, T.id pro_id, T.descricao pro_descricao, M.descricao marca_descricao, Q.modelo, C.setor
             FROM os O
             LEFT JOIN os_pecas B ON B.id_os = O.id
             LEFT JOIN produtos T ON T.id = B.id_produto
             LEFT JOIN locacao_contratos C ON C.id = O.id_contrato
             LEFT JOIN equipamentos Q ON Q.id = O.id_equip
             LEFT JOIN equipamentos_marcas M ON M.id = Q.id_marca
            WHERE O.id IN (?) AND O.id_grupo = ? AND O.id_empresa = ?
            ORDER BY O.id, B.id`,
          [marcadas, ctx.grupoId, ctx.empresaId],
        );
        html = htmlOsReq(o, linhas, empresa);
      } else {
        const [pecas] = await pool.query<any[]>(SQL_PECAS, [ctx.grupoId, ctx.empresaId, id]);
        html = htmlOs(o, pecas, empresa);
      }
      await comUsuario(ctx, (c) => c.query("UPDATE os SET status_impressao = 'S' WHERE id = ?", [id]));
      await enviarPdf(res, html, `OS_${id}.pdf`);
    } catch (err: any) {
      falha(res, err);
    }
  });

  // ----------------------------------------------------------
  // Requisições (menu só em desenvolvimento; nível A)
  // ----------------------------------------------------------
  router.get('/req/lista', A, async (req, res) => {
    try {
      // O Delphi abria com "filtro_status" (lista vazia) e "T" não listava nada: aqui A = padrão e T = todas
      const status = String(req.query.status || 'A').charAt(0).toUpperCase();
      const params: any[] = [res.locals.grupoId, res.locals.empresaId];
      let sql = SQL_REQ;
      if (status !== 'T') {
        sql += ' AND R.status = ?';
        params.push(status);
      }
      const [rows] = await pool.query<any[]>(`SELECT * FROM (${sql} ORDER BY R.id DESC LIMIT ${LIMITE_TODOS}) X ORDER BY X.id`, params);
      res.json(rows);
    } catch (err: any) {
      falha(res, err);
    }
  });

  router.get('/req/:id/produtos', A, async (req, res) => {
    try {
      const [rows] = await pool.query<any[]>(SQL_REQ_PRODUTOS, [res.locals.grupoId, res.locals.empresaId, Number(req.params.id)]);
      res.json(rows);
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Marcar Entregue: status E e data de entrega hoje */
  router.post('/req/:id/entregue', A, async (req, res) => {
    try {
      const ctx = contexto(res);
      const [r] = await comUsuario(ctx, (c) =>
        c.query<any>("UPDATE req SET status = 'E', data_entrega = ? WHERE id = ? AND id_grupo = ? AND id_empresa = ?", [hoje(), Number(req.params.id), ctx.grupoId, ctx.empresaId]),
      );
      if (!r.affectedRows) throw recusar('Requisição não encontrada.', 404);
      res.json({ success: true });
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Imprimir requisição; depois: impressa e "entregando" (ou entregue, se já tem data de entrega) */
  router.get('/req/:id/imprimir', A, async (req, res) => {
    try {
      const ctx = contexto(res);
      const id = Number(req.params.id);
      const [[r]] = await pool.query<any[]>(`${SQL_REQ} AND R.id = ?`, [ctx.grupoId, ctx.empresaId, id]);
      if (!r) throw recusar('Requisição não encontrada.', 404);
      const [produtos] = await pool.query<any[]>(SQL_REQ_PRODUTOS, [ctx.grupoId, ctx.empresaId, id]);
      const html = htmlRequisicao(r, produtos, await empresaAtiva(ctx));
      await comUsuario(ctx, (c) => c.query("UPDATE req SET status = IF(data_entrega IS NULL, 'I', 'E'), status_impressao = 'S' WHERE id = ?", [id]));
      await enviarPdf(res, html, `Requisicao_${id}.pdf`);
    } catch (err: any) {
      falha(res, err);
    }
  });

  const SQL_REQ_CLIENTE = `
    SELECT R.id, R.id_cliente, P.nome cliente_nome, P.fantasia, P.email, R.id_equip, R.id_contrato, R.id_produto, R.equip_descricao,
           E.descricao equip_desc, M.descricao marca_desc, E.modelo equip_modelo, R.cnpj_cliente, R.nome_req, R.datahora_req, R.qtdade_req, R.obs, R.status
      FROM req_cliente R
      LEFT JOIN pessoas P ON P.id = R.id_cliente
      LEFT JOIN locacao_contratos C ON C.id = R.id_contrato
      LEFT JOIN equipamentos E ON E.id = C.id_equip
      LEFT JOIN equipamentos_marcas M ON M.id = E.id_marca
     WHERE R.id_grupo = ? AND R.id_empresa = ? AND R.status = 'A'`;

  router.get('/req/pendentes', A, async (_req, res) => {
    try {
      const [rows] = await pool.query<any[]>(`${SQL_REQ_CLIENTE} ORDER BY R.id_cliente, R.id`, [res.locals.grupoId, res.locals.empresaId]);
      res.json(rows);
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Gerar Requisições: uma requisição por cliente com os itens marcados (o Delphi criava também requisição vazia) */
  router.post('/req/gerar', A, async (req, res) => {
    try {
      const ctx = contexto(res);
      const marcados = ids(req.body?.ids);
      if (!marcados.length) throw recusar('Marque ao menos uma requisição para gerar.');
      const [itens] = await pool.query<any[]>(`${SQL_REQ_CLIENTE} AND R.id IN (?) ORDER BY R.id_cliente, R.id`, [ctx.grupoId, ctx.empresaId, marcados]);
      const invalido = itens.find((i) => !(Math.trunc(Number(i.qtdade_req) || 0) > 0));
      if (invalido) throw recusar(`Quantidade inválida! (pedido ${invalido.id} de ${invalido.cliente_nome ?? 'cliente sem nome'})`);
      const porCliente = new Map<number, any[]>();
      for (const i of itens) porCliente.set(Number(i.id_cliente), [...(porCliente.get(Number(i.id_cliente)) ?? []), i]);
      const empresa = await empresaAtiva(ctx);
      const envios: Envio[] = [];
      const geradas: number[] = [];
      await comUsuario(ctx, async (c) => {
        for (const [clienteId, lista] of porCliente) {
          const [r] = await c.query<any>('INSERT INTO req SET ?', [
            { id_grupo: ctx.grupoId, id_empresa: ctx.empresaId, id_cliente: clienteId, data_req: hoje(), obs: '', id_usuario_inclusao: ctx.usuarioId, datahora_inclusao: agora(), status: 'A', status_impressao: 'N' },
          ]);
          geradas.push(r.insertId);
          const linhas: string[] = [];
          for (const i of lista) {
            await c.query('INSERT INTO req_produtos SET ?', [
              {
                id_req: r.insertId,
                id_grupo: ctx.grupoId,
                id_empresa: ctx.empresaId,
                id_cliente: clienteId,
                id_equip: i.id_equip,
                id_contrato: i.id_contrato,
                id_produto: i.id_produto,
                id_req_cliente: i.id,
                equip_descricao: i.equip_descricao,
                cnpj_cliente: i.cnpj_cliente,
                nome_req: i.nome_req,
                datahora_req: i.datahora_req,
                qtdade_req: Math.trunc(Number(i.qtdade_req)),
                obs: i.obs,
                status: 'A',
              },
            ]);
            linhas.push(`CARTUCHO ${esc(i.marca_desc ?? '')} ${esc(i.equip_modelo ?? '')} - Requisitante: ${esc(i.nome_req ?? '')}<br>`);
            await c.query("UPDATE req_cliente SET status = 'R' WHERE id = ?", [i.id]);
          }
          if (lista[0].email)
            envios.push({
              para: lista[0].email,
              assunto: `${empresa.grupo_nome ?? ''} - Confirmação de Requisição`,
              html: aplicarVariaveis(EMAIL_REQUISICAO, {
                '@nome_empresa': esc(empresa.nome_comercial),
                '@nome_usuario': esc(res.locals.usuario?.nome),
                '@comentario': '',
                '@produtos_requisitados': linhas.join(''),
                '@nome_cliente': esc(lista[0].cliente_nome),
                '@contato': CONTATO_PADRAO,
              }),
              descricao: `E-mail da requisição ${r.insertId} para ${lista[0].email}`,
            });
        }
      });
      const avisos = await enviarTodos(envios, empresa);
      res.json({ success: true, geradas, avisos });
    } catch (err: any) {
      falha(res, err);
    }
  });

  // ----------------------------------------------------------
  // Consultas configuráveis
  // ----------------------------------------------------------
  router.get('/consultas/lista', T, async (_req, res) => {
    try {
      const u = res.locals.usuario;
      const [rows] = await pool.query<any[]>(
        `SELECT id, grupo, codigo, descricao_resumida, parametros, sql1, sql2, sql3, sql4, pivot_linhas, pivot_colunas, pivot_metrica ${SQL_CONSULTAS_PERMITIDAS} ORDER BY grupo, descricao_resumida`,
        [res.locals.grupoId, String(u?.nivel || 'Z').charAt(0).toUpperCase(), String(res.locals.usuarioId)],
      );
      // O SQL não vai para o navegador: só os parâmetros (sem o SQL dos combos), as abas e o cubo
      res.json(
        rows.map((c) => ({
          id: c.id,
          grupo: c.grupo,
          codigo: c.codigo,
          descricao_resumida: c.descricao_resumida,
          parametros: parseParametros(c.parametros).map(({ extra, ...p }) => ({ ...p, extra: p.tipo === 'L' ? extra : '' })),
          abas: [1, 2, 3, 4].filter((n) => String(c[`sql${n}`] ?? '').trim()).map((n) => ({ n, titulo: tituloAba(c[`sql${n}`], n) })),
          pivot: { linhas: camposPivot(c.pivot_linhas), colunas: camposPivot(c.pivot_colunas), metrica: camposPivot(c.pivot_metrica) },
        })),
      );
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Opções do parâmetro P: o SQL do combo (1ª coluna = chave, 2ª = exibição), também só leitura e com :id_grupo/:id_empresa */
  router.get('/consultas/:id/opcoes/:nome', T, async (req, res) => {
    try {
      const c = await consultaPermitida(Number(req.params.id), res);
      const p = parseParametros(c.parametros).find((x) => x.nome.toLowerCase() === String(req.params.nome).toLowerCase() && x.tipo === 'P');
      if (!p?.extra) return res.json([]);
      const [rows] = await comConexaoLeitura((conn) => rodarSql(conn, p.extra, { id_grupo: Number(res.locals.grupoId), id_empresa: Number(res.locals.empresaId) }));
      res.json(
        rows.slice(0, LIMITE_LINHAS).map((r: any) => {
          const v = Object.values(r);
          return { value: String(v[0] ?? ''), label: String(v[1] ?? v[0] ?? '') };
        }),
      );
    } catch (err: any) {
      falha(res, err);
    }
  });

  router.post('/consultas/:id/executar', T, async (req, res) => {
    try {
      const c = await consultaPermitida(Number(req.params.id), res);
      res.json(await executarConsulta(c, req.body?.valores ?? {}, res));
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Imprimir: a grade em PDF (o layout FastReport de formato_fr3_blob não roda na web) */
  router.post('/consultas/:id/pdf', T, async (req, res) => {
    try {
      const c = await consultaPermitida(Number(req.params.id), res);
      const valores = req.body?.valores ?? {};
      const abas = await executarConsulta(c, valores, res);
      const filtros = parseParametros(c.parametros)
        .map((p) => `${p.rotulo}: ${req.body?.exibicao?.[p.nome] ?? valorParametro(p, valores[p.nome])}`)
        .join('  |  ');
      await enviarPdf(res, htmlConsulta(`${c.codigo ? `${c.codigo} - ` : ''}${c.descricao_resumida ?? ''}`, filtros, abas), `${c.codigo || 'consulta'}.pdf`);
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Salvar a configuração do cubo (só nível B ou menor) */
  router.put('/consultas/:id/pivot', nivelMinimo('B'), async (req, res) => {
    try {
      const c = await consultaPermitida(Number(req.params.id), res);
      const lista = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).join('\n') : '');
      await comUsuario(contexto(res), (conn) =>
        conn.query('UPDATE consultas SET pivot_linhas = ?, pivot_colunas = ?, pivot_metrica = ? WHERE id = ? AND id_grupo = ?', [
          lista(req.body?.linhas),
          lista(req.body?.colunas),
          lista(req.body?.metrica),
          c.id,
          res.locals.grupoId,
        ]),
      );
      res.json({ success: true });
    } catch (err: any) {
      falha(res, err);
    }
  });

  return router;
}
