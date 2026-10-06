import { Router, Request, Response, NextFunction } from 'express';
import { pool, comUsuario, gravarLog, type Contexto } from './db.js';
import { contexto, temNivel } from './crud.js';
import { registrarRegras, recusar } from './regras.js';
import { gerarPdf } from './pdf.js';
import {
  acertarGrupo,
  calcularLeitura,
  contadoresALancar,
  contadoresDaColeta,
  derivarValoresContrato,
  recalcularLeitura,
  totalizarGrupo,
  validarContrato,
  vencimentoEsperado,
  vencimentoLeitura,
} from '../src/modulos/locacoes/calculos.js';

/** Banco do Scan Impressoras SNMP (tabelas impressora e leitura), no mesmo host do banco de trabalho */
const PRINTERS_DB = /^\w+$/.test(process.env.PRINTERS_DATABASE || '') ? process.env.PRINTERS_DATABASE! : 'printers_000000';

/** Conexão ou pool: as consultas servem dentro e fora de transação */
type Q = { query: typeof pool.query };

/** Hoje no horário de Brasília (aaaa-mm-dd) */
const hojeLocal = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

const ESCOPO_C = 'C.id_grupo = ? AND C.id_empresa = ?';
const escopo = (ctx: Contexto) => [ctx.grupoId, ctx.empresaId];

async function contratoDoEscopo(q: Q, ctx: Contexto, id: unknown): Promise<any | null> {
  const [r] = await q.query<any[]>(`SELECT C.* FROM locacao_contratos C WHERE C.id = ? AND ${ESCOPO_C}`, [Number(id) || 0, ...escopo(ctx)]);
  return r[0] ?? null;
}

/** Última leitura do equipamento/contador (o Delphi buscava no banco todo; aqui dentro do grupo/empresa) */
async function ultimaLeitura(q: Q, ctx: Contexto, nrSerie: string | null, color: string | null) {
  const [r] = await q.query<any[]>(
    `SELECT L.leitura_atual, L.nr_copias_total FROM locacao_leituras L JOIN locacao_contratos C ON C.id = L.id_contrato
      WHERE L.nr_serie = ? AND L.color = ? AND ${ESCOPO_C}
      ORDER BY L.data_leitura DESC, L.id DESC LIMIT 1`,
    [nrSerie ?? '', color ?? 'N', ...escopo(ctx)],
  );
  return r[0] ?? null;
}

/** Leitura nova de um contrato (botão "+"): última leitura como anterior, preços do contrato e vencimento */
async function dadosNovaLeitura(q: Q, ctx: Contexto, c: any) {
  const ult = await ultimaLeitura(q, ctx, c.nr_serie, c.color);
  const hoje = hojeLocal();
  return {
    id_contrato: c.id,
    data_leitura: hoje,
    data_vencimento: Number(c.dia_vencimento) > 0 ? vencimentoLeitura(hoje, Number(c.dia_vencimento)) : null,
    nr_serie: c.nr_serie,
    color: c.color,
    codigo_grupo: c.codigo_grupo,
    nr_copias_contrato: c.nr_copias,
    valor_contrato: c.valor_contrato,
    valor_copia_unit: c.valor_copia,
    valor_copia_unit_excedente: c.valor_excedente,
    leitura_anterior: Number(ult?.leitura_atual ?? 0),
    nr_copiar_total_anterior: Number(ult?.nr_copias_total ?? 0),
    status_fatur: 'N',
    grupo_acertado: 'N',
  };
}

const inserir = (q: Q, tabela: string, dados: Record<string, any>) => {
  const cols = Object.keys(dados);
  return q.query<any>(`INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => dados[c]));
};
const atualizar = (q: Q, tabela: string, id: number, dados: Record<string, any>) => {
  const cols = Object.keys(dados);
  return q.query<any>(`UPDATE ${tabela} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => dados[c]), id]);
};

// ---------------------------------------------------------------------------------------------
// Regras do CRUD genérico (qrContratosBeforePost / qrLeiturasBeforePost)
// ---------------------------------------------------------------------------------------------

registrarRegras('locacao_contratos', {
  async antesDeGravar(payload, id, ctx) {
    const atual = id ? await contratoDoEscopo(pool, ctx, id) : {};
    if (!atual) throw recusar('Contrato não encontrado.', 404);
    // Toggles mandam só a coluna alterada: as validações valem para o contrato inteiro, como no Delphi
    const c = { ...atual, ...payload };
    const erro = validarContrato(c);
    if (erro) throw recusar(erro);
    if (c.id_cliente) {
      const [p] = await pool.query<any[]>('SELECT id FROM pessoas WHERE id = ? AND id_grupo = ?', [c.id_cliente, ctx.grupoId]);
      if (!p.length) throw recusar('Cliente não encontrado neste grupo.');
    }
    if ('id_equip' in payload || !id) {
      const [e] = await pool.query<any[]>('SELECT nr_serie FROM equipamentos WHERE id = ? AND id_grupo = ?', [c.id_equip ?? 0, ctx.grupoId]);
      if (c.id_equip && !e.length) throw recusar('Equipamento não encontrado neste grupo.');
      payload.nr_serie = e[0]?.nr_serie ?? '';
    }
    Object.assign(payload, derivarValoresContrato(c));
  },
  async antesDeExcluir(id, ctx) {
    // O Delphi excluía e deixava as leituras órfãs
    const [[r]] = await pool.query<any[]>(
      `SELECT COUNT(*) n FROM locacao_leituras L JOIN locacao_contratos C ON C.id = L.id_contrato WHERE L.id_contrato = ? AND ${ESCOPO_C}`,
      [id, ...escopo(ctx)],
    );
    if (Number(r.n) > 0) throw recusar(`O contrato tem ${r.n} leitura(s): inative o contrato em vez de excluir.`);
  },
});

registrarRegras('locacao_leituras', {
  async antesDeGravar(payload, id, ctx) {
    let antiga: any = null;
    if (id) {
      const [r] = await pool.query<any[]>(`SELECT L.* FROM locacao_leituras L JOIN locacao_contratos C ON C.id = L.id_contrato WHERE L.id = ? AND ${ESCOPO_C}`, [id, ...escopo(ctx)]);
      antiga = r[0];
      if (!antiga) throw recusar('Leitura não encontrada.', 404);
      delete payload.id_contrato;
    }
    const contrato = await contratoDoEscopo(pool, ctx, antiga?.id_contrato ?? payload.id_contrato);
    if (!contrato) throw recusar('Contrato não encontrado nesta empresa.');
    if (!id) {
      const base: Record<string, any> = await dadosNovaLeitura(pool, ctx, contrato);
      for (const [k, v] of Object.entries(base)) if (payload[k] === undefined || payload[k] === null || payload[k] === '') payload[k] = v;
      payload.nd ??= 0;
    }
    const l = { ...antiga, ...payload };
    if (!l.data_leitura) throw recusar('Data de leitura inválida!');
    payload.id_cliente = contrato.id_cliente;
    const alterou = !antiga || Number(l.leitura_atual ?? 0) !== Number(antiga.leitura_atual ?? 0);
    Object.assign(payload, calcularLeitura(l, contrato.valor_contrato, alterou));
  },
});

// ---------------------------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------------------------

/** Relatório "Leituras não efetuadas" (rel/nao_leituras.fr3) em HTML A4 */
export function htmlNaoLeituras(d: { empresa: string; emissao: string; mes: number; ano: number; dia: number; linhas: any[] }) {
  const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const linhas = d.linhas
    .map(
      (l) =>
        `<tr><td>${esc(l.marca)}</td><td>${esc(l.modelo)}</td><td>${esc(l.nr_serie)}</td><td>${esc(l.setor)}</td><td>${l.id_conferencia ? 'CONFERIDO' : ''}</td><td>${esc(l.nome)}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 12mm; }
body { font-family: Arial, sans-serif; font-size: 10px; color: #111; }
.cab { display: flex; justify-content: space-between; border-bottom: 2px solid #333; padding-bottom: 6px; margin-bottom: 8px; }
h1 { font-size: 14px; margin: 0 0 4px; } table { width: 100%; border-collapse: collapse; }
th { text-align: left; border-bottom: 1px solid #333; padding: 4px; } td { border-bottom: 1px solid #ddd; padding: 3px 4px; }
</style></head><body>
<div class="cab"><div><b>printControl</b><br>${esc(d.empresa)}</div><div style="text-align:right">Emissão: ${esc(d.emissao)}<br>
Mês Referência: ${String(d.mes).padStart(2, '0')}/${d.ano} - Dia da Leitura: ${String(d.dia).padStart(2, '0')}</div></div>
<h1>RELATÓRIO LEITURAS NÃO EFETUADAS</h1>
<table><thead><tr><th>MARCA</th><th>MODELO</th><th>NR. SÉRIE</th><th>SETOR</th><th></th><th>CLIENTE</th></tr></thead><tbody>${linhas}</tbody></table>
<p>${d.linhas.length} equipamento(s)</p></body></html>`;
}

export function createLocacoesRouter() {
  const router = Router();
  router.use('/locacoes', (_req: Request, res: Response, next: NextFunction) =>
    temNivel(res, 'A') ? next() : res.status(403).json({ error: 'Somente administradores acessam Locações.' }),
  );

  /** Envolve a rota: erro vira JSON (status do recusar ou 400) */
  const rota = (fn: (req: Request, res: Response, ctx: Contexto) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      const r = await fn(req, res, contexto(res));
      if (!res.headersSent) res.json(r ?? { success: true });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.sqlMessage || err.message });
    }
  };

  // ----- Contratos -----

  /** Combos do contrato (clientes ativos + os já usados, equipamentos "série / marca modelo", vendedores, séries NF) */
  router.get(
    '/locacoes/lookups',
    rota(async (_req, _res, ctx) => {
      const [clientes] = await pool.query<any[]>(
        `SELECT id value, nome label FROM pessoas
          WHERE id_grupo = ? AND (ativo = 'S' OR id IN (SELECT id_cliente FROM locacao_contratos WHERE id_grupo = ?)) ORDER BY nome`,
        [ctx.grupoId, ctx.grupoId],
      );
      const [equipamentos] = await pool.query<any[]>(
        `SELECT E.id value, CONCAT(E.nr_serie, ' / ', TRIM(CONCAT(COALESCE(M.descricao, ''), ' ', COALESCE(E.modelo, '')))) label
           FROM equipamentos E LEFT JOIN equipamentos_marcas M ON M.id = E.id_marca WHERE E.id_grupo = ? ORDER BY E.nr_serie`,
        [ctx.grupoId],
      );
      const [vendedores] = await pool.query<any[]>('SELECT id value, nome label FROM vendedores WHERE id_grupo = ? ORDER BY nome', [ctx.grupoId]);
      const [series] = await pool.query<any[]>(
        `SELECT id value, CONCAT(id, ' - ', COALESCE(descricao, '')) label FROM fatur_series WHERE id_grupo = ? AND id_empresa = ? ORDER BY id`,
        escopo(ctx),
      );
      const s = (l: any[]) => l.map((o) => ({ value: String(o.value), label: String(o.label ?? o.value) }));
      return { id_cliente: s(clientes), id_equip: s(equipamentos), id_vendedor: s(vendedores), serie_nf: s(series) };
    }),
  );

  router.get(
    '/locacoes/contratos',
    rota(async (req, _res, ctx) => {
      const nome = String(req.query.nome ?? '').trim();
      const serie = String(req.query.nr_serie ?? '').trim();
      const ativo = String(req.query.ativo ?? 'T').charAt(0).toUpperCase();
      const lote = Number(req.query.id_leitura) || 0;
      const where = [ESCOPO_C];
      const params: any[] = [...escopo(ctx)];
      if (nome) {
        where.push('P.nome LIKE ?');
        params.push(`${nome}%`);
      }
      if (serie) {
        where.push('C.nr_serie LIKE ?');
        params.push(`${serie}%`);
      }
      if (ativo === 'S' || ativo === 'N') {
        where.push('C.ativo = ?');
        params.push(ativo);
      }
      if (lote) {
        where.push('C.nr_serie IN (SELECT nr_serie FROM locacao_pre_leituras_leituras WHERE id_leitura = ? AND id_grupo = ? AND id_empresa = ?)');
        params.push(lote, ...escopo(ctx));
      }
      const [rows] = await pool.query<any[]>(
        `SELECT C.*, P.nome cliente_nome, P.cpf_cnpj, TRIM(CONCAT(COALESCE(M.descricao, ''), ' ', COALESCE(E.modelo, ''))) equip_descricao,
                V.nome vendedor_nome, S.descricao serie_descricao
           FROM locacao_contratos C
           LEFT JOIN pessoas P ON P.id = C.id_cliente
           LEFT JOIN equipamentos E ON E.id = C.id_equip
           LEFT JOIN equipamentos_marcas M ON M.id = E.id_marca
           LEFT JOIN vendedores V ON V.id = C.id_vendedor
           LEFT JOIN fatur_series S ON S.id = C.serie_nf AND S.id_grupo = C.id_grupo AND S.id_empresa = C.id_empresa
          WHERE ${where.join(' AND ')}
          ORDER BY P.nome, C.nr_serie, C.id`,
        params,
      );
      return rows;
    }),
  );

  /** Aviso (não bloqueia) depois de gravar: o equipamento está em outro contrato ativo */
  router.get(
    '/locacoes/contratos/:id/alocado',
    rota(async (req, _res, ctx) => {
      const c = await contratoDoEscopo(pool, ctx, req.params.id);
      if (!c || !c.nr_serie || c.ativo !== 'S') return { contratos: [] };
      const [r] = await pool.query<any[]>(
        `SELECT C.id, C.color, P.nome FROM locacao_contratos C LEFT JOIN pessoas P ON P.id = C.id_cliente
          WHERE C.nr_serie = ? AND C.ativo = 'S' AND C.id <> ? AND C.id_grupo = ?`,
        [c.nr_serie, c.id, ctx.grupoId],
      );
      return { contratos: r };
    }),
  );

  router.get(
    '/locacoes/contratos/:id/leituras',
    rota(async (req, _res, ctx) => {
      const [rows] = await pool.query<any[]>(
        `SELECT L.* FROM locacao_leituras L JOIN locacao_contratos C ON C.id = L.id_contrato
          WHERE L.id_contrato = ? AND ${ESCOPO_C} ORDER BY L.data_leitura DESC, L.id DESC`,
        [Number(req.params.id), ...escopo(ctx)],
      );
      return rows.map((r) => ({ ...r, status_fatur: r.status_fatur === 'S' ? 1 : 0 }));
    }),
  );

  router.get(
    '/locacoes/contratos/:id/nova-leitura',
    rota(async (req, _res, ctx) => {
      const c = await contratoDoEscopo(pool, ctx, req.params.id);
      if (!c) throw recusar('Contrato não encontrado.', 404);
      return dadosNovaLeitura(pool, ctx, c);
    }),
  );

  router.post(
    '/locacoes/leituras/:id/recalcular',
    rota(async (req, _res, ctx) => {
      await comUsuario(ctx, async (conn) => {
        const [r] = await conn.query<any[]>(`SELECT L.* FROM locacao_leituras L JOIN locacao_contratos C ON C.id = L.id_contrato WHERE L.id = ? AND ${ESCOPO_C} FOR UPDATE`, [
          Number(req.params.id),
          ...escopo(ctx),
        ]);
        if (!r[0]) throw recusar('Leitura não encontrada.', 404);
        const c = await contratoDoEscopo(conn, ctx, r[0].id_contrato);
        await atualizar(conn, 'locacao_leituras', r[0].id, recalcularLeitura(r[0], c));
      });
    }),
  );

  router.post(
    '/locacoes/contratos/:id/os-entrega',
    rota(async (req, _res, ctx) => {
      const c = await contratoDoEscopo(pool, ctx, req.params.id);
      if (!c) throw recusar('Contrato não encontrado.', 404);
      const [[e]] = await pool.query<any[]>(
        `SELECT TRIM(CONCAT(COALESCE(M.descricao, ''), ' ', COALESCE(E.modelo, ''))) d FROM equipamentos E LEFT JOIN equipamentos_marcas M ON M.id = E.id_marca WHERE E.id = ?`,
        [c.id_equip ?? 0],
      );
      const [[p]] = await pool.query<any[]>('SELECT cpf_cnpj FROM pessoas WHERE id = ?', [c.id_cliente ?? 0]);
      const [r] = await comUsuario(ctx, (conn) =>
        conn.query<any>(
          `INSERT INTO os (id_grupo, id_empresa, id_cliente, id_equip, id_contrato, id_os_cliente, equip_descricao, cnpj_cliente, nome_req, data_os,
                           qtdade_os, defeito_cliente, datahora_inclusao, id_usuario_inclusao, os_tipo, status, status_impressao)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'SISTEMA', CURDATE(), 1, 'ENTREGA DE EQUIPAMENTO', NOW(), ?, 'E', 'A', 'N')`,
          [ctx.grupoId, ctx.empresaId, c.id_cliente, c.id_equip, c.id, String(e?.d ?? '').slice(0, 50), String(p?.cpf_cnpj ?? '').replace(/\D/g, '').slice(0, 14), ctx.usuarioId],
        ),
      );
      gravarLog(ctx, `OS de entrega ${r.insertId} gerada pelo contrato ${c.id}`, { nome: 'os', id: r.insertId, op: 'I' });
      return { id: r.insertId };
    }),
  );

  /** Histórico SNMP (coletas do Scan Impressoras em PRINTERS_DB) do nr. de série; sem série = todas dos equipamentos do grupo */
  router.get(
    '/locacoes/snmp',
    rota(async (req, _res, ctx) => {
      const serie = String(req.query.nr_serie ?? '').trim();
      // Coletas do Scan Impressoras (PRINTERS_DB). ponytail: "Todas" traz as 2.000 mais recentes; paginar se crescer muito
      const [rows] = await pool.query<any[]>(
        `SELECT * FROM (
           SELECT L.id, L.coletado_em, L.ip, L.paginas, L.paginas_preto, L.paginas_color, L.paginas_unidade,
                  L.toner_preto, L.toner_ciano, L.toner_magenta, L.toner_amarelo,
                  I.numero_serie, I.fabricante, I.modelo, I.colorida, COALESCE(I.apelido, I.localizacao) AS local_impressora
             FROM \`${PRINTERS_DB}\`.leitura L
             JOIN \`${PRINTERS_DB}\`.impressora I ON I.id = L.impressora_id
            WHERE ${serie ? 'I.numero_serie = ?' : 'EXISTS (SELECT 1 FROM equipamentos E WHERE E.nr_serie = I.numero_serie AND E.id_grupo = ?)'}
            ORDER BY L.coletado_em DESC, L.id DESC LIMIT 2000) X
          ORDER BY coletado_em, id`,
        [serie || ctx.grupoId],
      );
      // Cliente e setor do contrato ativo da série (do grupo/empresa), para a mesma grade de antes
      const series = [...new Set(rows.map((r) => r.numero_serie).filter(Boolean))];
      const [contratos] = series.length
        ? await pool.query<any[]>(
            `SELECT C.nr_serie, C.setor, P.nome FROM locacao_contratos C LEFT JOIN pessoas P ON P.id = C.id_cliente
              WHERE C.nr_serie IN (?) AND ${ESCOPO_C} ORDER BY C.ativo = 'S', C.id`,
            [series, ...escopo(ctx)],
          )
        : [[]];
      const contrato = new Map((contratos as any[]).map((c) => [c.nr_serie, c]));
      return rows.map((r) => {
        const { pb, cor } = contadoresDaColeta(r);
        const c = contrato.get(r.numero_serie);
        return {
          id: r.id,
          datahora_inclusao: r.coletado_em,
          equip_ns: r.numero_serie,
          equip_marca: r.fabricante,
          equip_modelo: r.modelo,
          cliente_descricao_equip: c?.setor || r.local_impressora,
          cliente_nome: c?.nome ?? null,
          leitura_pb: pb,
          leitura_color: cor,
          nivel_toner_black: r.toner_preto,
          nivel_toner_cyan: r.toner_ciano,
          nivel_toner_magenta: r.toner_magenta,
          nivel_toner_yellow: r.toner_amarelo,
          cliente_ip_equip: r.ip,
          unidade: r.paginas_unidade,
        };
      });
    }),
  );

  // ----- Agrupamento -----

  const leiturasDoGrupo = async (q: Q, ctx: Contexto, codigo: string, travar = false) => {
    const [rows] = await q.query<any[]>(
      `SELECT L.*, C.id_equip, M.descricao marca_descricao, E.descricao equip_descricao,
              TRIM(CONCAT(COALESCE(M.descricao, ''), ' ', COALESCE(E.descricao, ''))) equip_descricao_total
         FROM locacao_leituras L
         JOIN locacao_contratos C ON C.id = L.id_contrato
         LEFT JOIN equipamentos E ON E.id = C.id_equip
         LEFT JOIN equipamentos_marcas M ON M.id = E.id_marca
        WHERE ${ESCOPO_C} AND L.codigo_grupo = ? AND L.status_fatur = 'N'
        ORDER BY L.data_leitura, L.id${travar ? ' FOR UPDATE' : ''}`,
      [...escopo(ctx), codigo],
    );
    return rows;
  };

  router.get(
    '/locacoes/agrupamento',
    rota(async (req, _res, ctx) => {
      const codigo = String(req.query.codigo ?? '').trim();
      if (!codigo) throw recusar('Informe o grupo.');
      const leituras = await leiturasDoGrupo(pool, ctx, codigo);
      return { leituras, total: leituras.length ? { codigo_grupo: codigo, ...totalizarGrupo(leituras) } : null };
    }),
  );

  router.post(
    '/locacoes/agrupamento/acertar',
    rota(async (req, _res, ctx) => {
      const codigo = String(req.body?.codigo ?? '').trim();
      if (!codigo) throw recusar('Informe o grupo.');
      return comUsuario(ctx, async (conn) => {
        const ls = await leiturasDoGrupo(conn, ctx, codigo, true);
        const { erro, alteracoes } = acertarGrupo(ls);
        if (erro) throw recusar(erro);
        for (const { id, ...dados } of alteracoes) await atualizar(conn, 'locacao_leituras', id, dados);
        return { alteradas: alteracoes.length };
      });
    }),
  );

  // ----- Conferência -----

  const naoLidas = async (ctx: Contexto, ano: number, mes: number, dia: number) => {
    if (!(ano > 2000 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31)) throw recusar('Informe ano, mês e dia da leitura.');
    const [contratos] = await pool.query<any[]>(
      `SELECT C.id, C.id_cliente, P.nome, C.nr_serie, C.id_equip, M.descricao marca, E.modelo, C.setor, C.dia_leitura, C.dia_vencimento
         FROM locacao_contratos C
         LEFT JOIN pessoas P ON P.id = C.id_cliente
         LEFT JOIN equipamentos E ON E.id = C.id_equip
         LEFT JOIN equipamentos_marcas M ON M.id = E.id_marca
        WHERE ${ESCOPO_C} AND C.ativo = 'S' AND C.dia_leitura = ?
        ORDER BY P.nome, C.nr_serie`,
      [...escopo(ctx), dia],
    );
    if (!contratos.length) return [];
    const ids = contratos.map((c) => c.id);
    const [lidas] = await pool.query<any[]>('SELECT id_contrato, data_vencimento FROM locacao_leituras WHERE id_contrato IN (?)', [ids]);
    const [conf] = await pool.query<any[]>('SELECT id, id_contrato, data_vencimento FROM locacao_confere WHERE id_contrato IN (?)', [ids]);
    const chave = (id: unknown, d: unknown) => `${id}|${String(d ?? '').slice(0, 10)}`;
    const lidasSet = new Set(lidas.map((l) => chave(l.id_contrato, l.data_vencimento)));
    const confMap = new Map(conf.map((c) => [chave(c.id_contrato, c.data_vencimento), c.id]));
    return contratos
      .map((c) => ({ ...c, novo_vencimento: vencimentoEsperado(ano, mes, Number(c.dia_leitura), Number(c.dia_vencimento)) }))
      .filter((c) => !lidasSet.has(chave(c.id, c.novo_vencimento)))
      .map((c) => ({ ...c, id_conferencia: confMap.get(chave(c.id, c.novo_vencimento)) ?? null }));
  };
  const parametrosConf = (req: Request) => [Number(req.query.ano), Number(req.query.mes), Number(req.query.dia)] as const;

  router.get(
    '/locacoes/conferencia',
    rota((req, _res, ctx) => naoLidas(ctx, ...parametrosConf(req))),
  );

  /** "Conferido!": marca (insere em locacao_confere) ou desmarca (exclui) */
  router.post(
    '/locacoes/conferencia',
    rota(async (req, _res, ctx) => {
      const c = await contratoDoEscopo(pool, ctx, req.body?.id_contrato);
      if (!c) throw recusar('Contrato não encontrado.', 404);
      const venc = String(req.body?.data_vencimento ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(venc)) throw recusar('Vencimento inválido.');
      return comUsuario(ctx, async (conn) => {
        const [r] = await conn.query<any[]>('SELECT id FROM locacao_confere WHERE id_contrato = ? AND data_vencimento = ?', [c.id, venc]);
        if (r.length) {
          await conn.query('DELETE FROM locacao_confere WHERE id_contrato = ? AND data_vencimento = ?', [c.id, venc]);
          return { id_conferencia: null };
        }
        const [ins] = await inserir(conn, 'locacao_confere', { id_contrato: c.id, dia_leitura: c.dia_leitura, data_vencimento: venc });
        return { id_conferencia: ins.insertId };
      });
    }),
  );

  router.get('/locacoes/conferencia/pdf', async (req: Request, res: Response) => {
    try {
      const ctx = contexto(res);
      const [ano, mes, dia] = parametrosConf(req);
      const linhas = await naoLidas(ctx, ano, mes, dia);
      const [[e]] = await pool.query<any[]>('SELECT nome_comercial FROM empresas_filiais WHERE id = ?', [ctx.empresaId]);
      const emissao = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).replace(',', ' -');
      const pdf = await gerarPdf(htmlNaoLeituras({ empresa: e?.nome_comercial ?? '', emissao, ano, mes, dia, linhas }));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="leituras_nao_efetuadas_${ano}${String(mes).padStart(2, '0')}.pdf"`);
      res.send(pdf);
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  // ----- Pré-leituras -----

  router.get(
    '/locacoes/pre-leituras',
    rota(async (_req, _res, ctx) => {
      const [r] = await pool.query<any[]>('SELECT * FROM locacao_pre_leituras WHERE id_grupo = ? AND id_empresa = ? ORDER BY datahora_geracao DESC, id DESC', escopo(ctx));
      return r;
    }),
  );

  router.get(
    '/locacoes/pre-leituras/:id/itens',
    rota(async (req, _res, ctx) => {
      const [r] = await pool.query<any[]>('SELECT * FROM locacao_pre_leituras_leituras WHERE id_leitura = ? AND id_grupo = ? AND id_empresa = ? ORDER BY nome, setor, id', [
        Number(req.params.id),
        ...escopo(ctx),
      ]);
      return r;
    }),
  );

  /** "Selecionar" do diálogo Gerar Pré-Leituras (o Delphi não filtrava grupo/empresa) */
  router.get(
    '/locacoes/pre-leituras-selecao',
    rota(async (req, _res, ctx) => {
      const dia = Number(req.query.dia) || 0;
      const cliente = Number(req.query.id_cliente) || 0;
      const [r] = await pool.query<any[]>(
        `SELECT C.id id_contrato, C.id_cliente, P.nome, P.fone_fixo, P.fone_celular1, C.id_equip, M.descricao marca, E.modelo, C.setor, C.nr_serie,
                C.rede_usb, C.dia_leitura, C.color
           FROM locacao_contratos C
           LEFT JOIN equipamentos E ON E.id = C.id_equip
           LEFT JOIN equipamentos_marcas M ON M.id = E.id_marca
           LEFT JOIN pessoas P ON P.id = C.id_cliente
          WHERE ${ESCOPO_C} AND C.ativo = 'S' AND (? = 0 OR C.dia_leitura = ?) AND (? = 0 OR C.id_cliente = ?)
          ORDER BY P.nome, C.setor`,
        [...escopo(ctx), dia, dia, cliente, cliente],
      );
      return r;
    }),
  );

  /** "Gravar Novo Lote Leituras" */
  router.post(
    '/locacoes/pre-leituras',
    rota(async (req, _res, ctx) => {
      const data = String(req.body?.data ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw recusar('Informe a data "Leitura até".');
      const dia = Math.max(0, Math.min(31, Number(req.body?.dia) || 0));
      const ids: number[] = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((x: number) => x > 0);
      return comUsuario(ctx, async (conn) => {
        const [lote] = await inserir(conn, 'locacao_pre_leituras', {
          id_grupo: ctx.grupoId,
          id_empresa: ctx.empresaId,
          filtro_dia_leitura: String(dia).padStart(2, '0'),
          filtro_ate_data: data,
          filtro_cliente: String(req.body?.nome_cliente ?? '').slice(0, 50) || null,
        });
        // datahora_geracao: DEFAULT CURRENT_TIMESTAMP na conexão em -03:00 (Brasília)
        let gravadas = 0;
        if (ids.length) {
          const [r] = await conn.query<any>(
            `INSERT INTO locacao_pre_leituras_leituras (id_leitura, id_grupo, id_empresa, id_contrato, id_cliente, nome, fone_fixo, fone_celular1, id_equip,
                    equip_marca, equip_modelo, setor, nr_serie, dia_leitura, data_leitura, data_leitura_prevista, leitura_pb, leitura_color, status, rede_usb)
             SELECT ?, C.id_grupo, C.id_empresa, C.id, C.id_cliente, LEFT(P.nome, 50), LEFT(P.fone_fixo, 25), LEFT(P.fone_celular1, 25), C.id_equip,
                    LEFT(M.descricao, 30), LEFT(E.modelo, 25), C.setor, C.nr_serie, C.dia_leitura, ?, ?, 0, 0, 'G', C.rede_usb
               FROM locacao_contratos C
               LEFT JOIN equipamentos E ON E.id = C.id_equip
               LEFT JOIN equipamentos_marcas M ON M.id = E.id_marca
               LEFT JOIN pessoas P ON P.id = C.id_cliente
              WHERE C.id IN (?) AND ${ESCOPO_C}
              ORDER BY P.nome, C.setor`,
            [lote.insertId, data, data, ids, ...escopo(ctx)],
          );
          gravadas = r.affectedRows;
        }
        return { id: lote.insertId, gravadas };
      });
    }),
  );

  /**
   * Captura para uma linha da pré-leitura: última coleta do Scan Impressoras SNMP (banco PRINTERS_DATABASE, padrão
   * printers_000000, no mesmo host do banco de trabalho) até o fim do dia da leitura, pelo nr. de série.
   */
  const capturar = async (conn: Q, ctx: Contexto, item: any) => {
    const [coletas] = await conn.query<any[]>(
      `SELECT L.id, L.coletado_em, L.paginas, L.paginas_preto, L.paginas_color, I.colorida
         FROM \`${PRINTERS_DB}\`.leitura L
         JOIN \`${PRINTERS_DB}\`.impressora I ON I.id = L.impressora_id
        WHERE I.numero_serie = ? AND L.coletado_em < DATE_ADD(?, INTERVAL 1 DAY)
        ORDER BY L.coletado_em DESC, L.id DESC LIMIT 1`,
      [String(item.nr_serie ?? '').trim(), item.data_leitura ?? hojeLocal()],
    );
    const c = coletas[0];
    if (!c) {
      await atualizar(conn, 'locacao_pre_leituras_leituras', item.id, { status: 'Z' });
      return false;
    }
    const { pb, cor } = contadoresDaColeta(c);
    const anterior = async (qtd: number, color: string) => (qtd > 0 ? Number((await ultimaLeitura(conn, ctx, item.nr_serie, color))?.leitura_atual ?? 0) : 0);
    await atualizar(conn, 'locacao_pre_leituras_leituras', item.id, {
      leitura_pb: pb,
      leitura_color: cor,
      leitura_pb_anterior: await anterior(pb, 'N'),
      leitura_color_anterior: await anterior(cor, 'S'),
      // A coluna aponta para equipamentos_leituras: a coleta do printers não tem registro lá
      id_equipamentos_leituras: null,
      datahora_leitura_auto: c.coletado_em,
      status: 'C',
    });
    return true;
  };

  router.post(
    '/locacoes/pre-leituras/itens/:id/capturar',
    rota(async (req, _res, ctx) =>
      comUsuario(ctx, async (conn) => {
        const [r] = await conn.query<any[]>('SELECT * FROM locacao_pre_leituras_leituras WHERE id = ? AND id_grupo = ? AND id_empresa = ? FOR UPDATE', [
          Number(req.params.id),
          ...escopo(ctx),
        ]);
        if (!r[0]) throw recusar('Pré-leitura não encontrada.', 404);
        if (r[0].status === 'F') throw recusar('Esta leitura já foi lançada (faturada): não pode ser recapturada.');
        return { capturada: await capturar(conn, ctx, r[0]) };
      }),
    ),
  );

  router.post(
    '/locacoes/pre-leituras/:id/capturar-todas',
    rota(async (req, _res, ctx) =>
      comUsuario(ctx, async (conn) => {
        const [itens] = await conn.query<any[]>(
          "SELECT * FROM locacao_pre_leituras_leituras WHERE id_leitura = ? AND id_grupo = ? AND id_empresa = ? AND status <> 'F' ORDER BY nome, setor, id FOR UPDATE",
          [Number(req.params.id), ...escopo(ctx)],
        );
        let capturadas = 0;
        for (const it of itens) if (await capturar(conn, ctx, it)) capturadas++;
        return { capturadas, zeradas: itens.length - capturadas };
      }),
    ),
  );

  /** "Lançar Leituras": cria as leituras dos itens conferidos (um por contador com contrato) */
  router.post(
    '/locacoes/pre-leituras/:id/lancar',
    rota(async (req, _res, ctx) =>
      comUsuario(ctx, async (conn) => {
        const lote = Number(req.params.id);
        const [itens] = await conn.query<any[]>('SELECT * FROM locacao_pre_leituras_leituras WHERE id_leitura = ? AND id_grupo = ? AND id_empresa = ? ORDER BY nome, setor, id FOR UPDATE', [
          lote,
          ...escopo(ctx),
        ]);
        const faltam = itens.filter((i) => (i.faturar ?? 'N') === 'N').length;
        if (faltam > 0) throw recusar(`Faltam conferir ainda ${faltam} leituras!`);
        let lancadas = 0;
        let ignoradas = 0;
        const lancados = new Set<number>();
        for (const it of itens.filter((i) => i.faturar === 'S')) {
          const [contratos] = await conn.query<any[]>(`SELECT C.* FROM locacao_contratos C WHERE C.nr_serie = ? AND C.ativo = 'S' AND ${ESCOPO_C} ORDER BY C.id`, [
            it.nr_serie ?? '',
            ...escopo(ctx),
          ]);
          // A linha é de um contrato (o lote grava id_contrato): lança o contador dele; linha sem contrato, um por contrato do equipamento
          const alvo = it.id_contrato ? contratos.filter((c) => c.id === it.id_contrato) : contratos;
          const contadores = contadoresALancar(it, alvo.map((c) => c.color))
            .map((k) => ({ ...k, c: alvo.find((x) => x.color === k.color) }))
            .filter((k) => !lancados.has(k.c.id));
          if (!contadores.length) {
            ignoradas++;
            continue;
          }
          for (const { c, ...k } of contadores) {
            lancados.add(c.id);
            const l: Record<string, any> = { ...(await dadosNovaLeitura(conn, ctx, c)), leitura_anterior: k.anterior, leitura_atual: k.atual, nr_copias_total: 0, nr_copias_excedente: 0, valor_total_geral: 0 };
            Object.assign(l, { id_cliente: c.id_cliente }, calcularLeitura(l as any, c.valor_contrato, true));
            await inserir(conn, 'locacao_leituras', l);
            lancadas++;
          }
          await atualizar(conn, 'locacao_pre_leituras_leituras', it.id, { faturar: 'F', status: 'F' });
        }
        return { lancadas, ignoradas };
      }),
    ),
  );

  return router;
}
