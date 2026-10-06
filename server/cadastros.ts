import { Router, Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { pool, comUsuario, Contexto } from './db.js';
import { contexto, friendlyDbError, temNivel } from './crud.js';
import { registrarRegras, recusar } from './regras.js';
import { gerarPdf } from './pdf.js';
import { formatarEtiquetaVoid, recalcularKardex } from '../src/modulos/cadastros/calculos.js';

// ============================================================ Checagem de dependências antes de excluir
// (nenhuma tela do Delphi verificava: excluía e deixava registros órfãos)

/** [tabela, coluna, nome para a mensagem, filtro extra com :grupo/:empresa] */
type Uso = [string, string, string, string?];

async function bloquearSeEmUso(id: string, ctx: Contexto, oQue: string, usos: Uso[]) {
  const achados: string[] = [];
  for (const [tabela, coluna, nome, filtro] of usos) {
    const extra = filtro ? ` AND ${filtro.replace(/:grupo\b/g, String(ctx.grupoId ?? 0)).replace(/:empresa\b/g, String(ctx.empresaId ?? 0))}` : '';
    const [[r]] = await pool.query<any[]>(`SELECT COUNT(*) AS n FROM ${tabela} WHERE ${coluna} = ?${extra}`, [id]);
    if (Number(r.n)) achados.push(`${nome} (${r.n})`);
  }
  if (achados.length) throw recusar(`Não é possível excluir ${oQue}: está em uso em ${achados.join(', ')}.`);
}

const dependencias = (recurso: string, oQue: string, usos: Uso[]) =>
  registrarRegras(recurso, { antesDeExcluir: (id, ctx) => bloquearSeEmUso(id, ctx, oQue, usos) });

dependencias('equipamentos', 'o equipamento', [
  ['locacao_contratos', 'id_equip', 'contratos de locação'],
  ['equipamentos_leituras', 'id_equip', 'leituras'],
  ['locacao_pre_leituras_leituras', 'id_equip', 'pré-leituras'],
  ['os', 'id_equip', 'ordens de serviço'],
  ['os_cliente', 'id_equip', 'pedidos dos clientes'],
  ['fatur_notas_produtos', 'id_equip', 'notas de faturamento'],
  ['req_cliente', 'id_equip', 'requisições de clientes'],
  ['req_produtos', 'id_equip', 'requisições de material'],
]);
dependencias('equipamentos_marcas', 'a marca', [['equipamentos', 'id_marca', 'equipamentos']]);
dependencias('equipamentos_tipos', 'o tipo', [['equipamentos', 'id_tipo', 'equipamentos']]);
dependencias('produtos', 'o produto', [
  ['os_pecas', 'id_produto', 'peças de OS'],
  ['os', 'id_produto', 'ordens de serviço'],
  ['produtos_cardex', 'produto_id', 'movimentos de estoque'],
  ['produtos_clientes', 'id_produto', 'etiquetas VOID'],
  ['produtos_estoque_simples', 'id_produto', 'estoque'],
  ['vendas_produtos', 'id_produto', 'vendas'],
  ['req_produtos', 'id_produto', 'requisições de material'],
  ['req_cliente', 'id_produto', 'requisições de clientes'],
]);
dependencias('produtos_marcas', 'a marca', [
  ['produtos', 'id_marca', 'produtos'],
  ['produtos', 'id_marca_compatib', 'produtos (marca compatível)'],
]);
dependencias('produtos_familias', 'a família', [['produtos_grupos', 'id_familia', 'grupos de produtos']]);
dependencias('produtos_grupos', 'o grupo', [
  ['produtos_grupos', 'id_produtos_grupos', 'subgrupos'],
  ['produtos', 'id_familia_grupo', 'produtos'],
]);
// Planos e séries: o código se repete entre grupos/empresas
dependencias('fatur_planos', 'o plano', [
  ['pessoas', 'id_plano', 'clientes', 'id_grupo = :grupo'],
  ['fatur_notas', 'id_plano', 'notas de faturamento', 'id_grupo = :grupo'],
]);
dependencias('fatur_series', 'a série', [
  ['locacao_contratos', 'serie_nf', 'contratos de locação', 'id_empresa = :empresa'],
  ['fatur_notas', 'serie', 'notas de faturamento', 'id_empresa = :empresa'],
]);
dependencias('bancos', 'o banco', [
  ['pessoas', 'id_banco', 'clientes'],
  ['areceber', 'id_banco', 'contas a receber'],
  ['fatur_financ', 'id_banco', 'financeiro do faturamento'],
  ['fatur_notas', 'id_banco', 'notas de faturamento'],
  ['vendas_condicoes', 'id_banco', 'condições de venda'],
]);

// ============================================================ Equipamentos

/** "Gerar NS": 'PC' + 8 hexadecimais, sem repetir dentro do grupo (o Delphi não conferia) */
async function gerarNumeroSerie(grupoId: number | null): Promise<string> {
  for (;;) {
    const ns = `PC${randomBytes(4).toString('hex').toUpperCase()}`;
    const [r] = await pool.query<any[]>('SELECT 1 FROM equipamentos WHERE id_grupo = ? AND nr_serie = ? LIMIT 1', [grupoId, ns]);
    if (!r.length) return ns;
  }
}

registrarRegras('equipamentos', {
  async antesDeGravar(payload, id, ctx) {
    if (id !== null && !('nr_serie' in payload)) return;
    payload.nr_serie = String(payload.nr_serie ?? '').trim() || (await gerarNumeroSerie(ctx.grupoId));
  },
});

// ============================================================ Produtos e árvore de grupos

/** Grupos abaixo do grupo indicado (todos os níveis) */
async function descendentes(id: number): Promise<number[]> {
  const [r] = await pool.query<any[]>(
    `WITH RECURSIVE d AS (SELECT id FROM produtos_grupos WHERE id_produtos_grupos = ?
       UNION ALL SELECT g.id FROM produtos_grupos g JOIN d ON g.id_produtos_grupos = d.id)
     SELECT id FROM d LIMIT 10000`,
    [id],
  );
  return r.map((x) => Number(x.id));
}

registrarRegras('produtos', {
  async antesDeGravar(payload, _id, ctx) {
    const grupo = Number(payload.id_familia_grupo) || 0;
    if (!grupo) return;
    const [[g]] = await pool.query<any[]>(
      'SELECT G.id, (SELECT COUNT(*) FROM produtos_grupos F WHERE F.id_produtos_grupos = G.id) AS filhos FROM produtos_grupos G WHERE G.id = ? AND G.id_grupo = ?',
      [grupo, ctx.grupoId],
    );
    if (!g) throw recusar('Família/grupo não encontrado.');
    if (Number(g.filhos)) throw recusar('Você deve escolher o último nível na hierarquia de grupos.');
  },
});

registrarRegras('produtos_grupos', {
  async antesDeGravar(payload, id, ctx) {
    if ('descricao' in payload) payload.descricao = String(payload.descricao ?? '').trim().toUpperCase();
    const meuId = id === null ? 0 : Number(id);
    const atual = meuId ? (await pool.query<any[]>('SELECT * FROM produtos_grupos WHERE id = ? AND id_grupo = ?', [meuId, ctx.grupoId]))[0][0] : null;
    const pai = Number('id_produtos_grupos' in payload ? payload.id_produtos_grupos : atual?.id_produtos_grupos) || 0;
    payload.id_produtos_grupos = pai;
    if (pai) {
      const [[p]] = await pool.query<any[]>(
        'SELECT id, id_familia, descricao, (SELECT COUNT(*) FROM produtos WHERE id_familia_grupo = G.id) AS produtos FROM produtos_grupos G WHERE id = ? AND id_grupo = ?',
        [pai, ctx.grupoId],
      );
      if (!p) throw recusar(`Grupo pai nº ${pai} não encontrado.`);
      if (meuId && (pai === meuId || (await descendentes(meuId)).includes(pai))) throw recusar('O grupo pai não pode ser o próprio grupo nem um subgrupo dele.');
      // Produto só fica no último nível: um grupo com produtos não pode ganhar subgrupos
      if (Number(p.produtos)) throw recusar(`O grupo ${p.descricao} tem ${p.produtos} produto(s) ligado(s): mova-os antes de criar subgrupos nele.`);
      payload.id_familia = p.id_familia; // subgrupo herda a família do pai
    } else if (!Number(payload.id_familia ?? atual?.id_familia)) {
      throw recusar('Escolha a família do grupo.');
    }
    // Mudou a família: os subgrupos vão junto (no Delphi ficavam na família antiga)
    if (atual && 'id_familia' in payload && Number(payload.id_familia) !== Number(atual.id_familia)) {
      const filhos = await descendentes(meuId);
      if (filhos.length) await comUsuario(ctx, (c) => c.query('UPDATE produtos_grupos SET id_familia = ? WHERE id IN (?)', [payload.id_familia, filhos]));
    }
  },
});

// ============================================================ Estoque (Kardex)

const agoraLocal = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' });

registrarRegras('produtos_cardex', {
  async antesDeGravar(payload, id, ctx) {
    const qtd = Number(payload.qtdade_mov) || 0;
    const unit = qtd > 0 ? Math.round((Number(payload.valor_total_mov) || 0) / qtd * 100) / 100 : 0;
    const datahora = payload.data_mov ? `${payload.data_mov} ${payload.hora_mov || '00:00:00'}` : null;
    if (id === null) {
      Object.assign(payload, { valor_unit_mov: unit, datahora_mov: datahora, datahora_inclusao: agoraLocal(), usuario_inclusao: ctx.usuarioId });
    } else {
      // ponytail: o PUT genérico só grava as colunas que vieram do formulário; as calculadas vão aqui
      await comUsuario(ctx, (c) =>
        c.query('UPDATE produtos_cardex SET valor_unit_mov = ?, datahora_mov = COALESCE(?, datahora_mov) WHERE id = ? AND id_grupo = ?', [unit, datahora, id, ctx.grupoId]),
      );
    }
  },
  async antesDeExcluir(id, ctx) {
    const [[m]] = await pool.query<any[]>('SELECT venda_id, compra_id FROM produtos_cardex WHERE id = ? AND id_grupo = ?', [id, ctx.grupoId]);
    if (m && (Number(m.venda_id) > 0 || Number(m.compra_id) > 0)) throw recusar('Registro não pode ser deletado porque foi gerado em venda ou compra.');
  },
});

// ============================================================ Relatório "Inventário de Equipamentos" (equip_inventario.fr3)

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const valorBR = (v: unknown) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBR = (d: unknown) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

export function htmlInventarioEquip(linhas: { marca_descricao: unknown; modelo: unknown; nr_serie: unknown; data_aquisicao: unknown; valor_aquisicao: unknown; nome: unknown }[]) {
  const total = linhas.reduce((s, l) => s + (Number(l.valor_aquisicao) || 0), 0);
  const corpo = linhas
    .map(
      (l) => `<tr><td>${esc(l.marca_descricao)}</td><td>${esc(l.modelo)}</td><td>${esc(l.nr_serie)}</td>` +
        `<td class="c">${dataBR(l.data_aquisicao)}</td><td class="d">${valorBR(l.valor_aquisicao)}</td><td>${esc(l.nome)}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Inventário de equipamentos</title><style>
@page { size: A4 portrait; margin: 10mm; }
body { font-family: 'Courier New', monospace; font-size: 9pt; color: #000; margin: 0; }
h1 { font-size: 12pt; text-align: center; text-decoration: underline; margin: 0 0 8px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; border-bottom: 1px solid #000; padding: 2px 4px; }
td { padding: 1px 4px; vertical-align: top; }
.c { text-align: center; } .d { text-align: right; }
tfoot td { border-top: 1px solid #000; padding-top: 4px; font-weight: bold; }
</style></head><body>
<h1>INVENTÁRIO DE EQUIPAMENTOS</h1>
<table><thead><tr><th>Marca</th><th>Modelo</th><th>Nr. Série</th><th class="c">Aquisição</th><th class="d">Valor</th><th>Cliente Atual</th></tr></thead>
<tbody>${corpo}</tbody>
<tfoot><tr><td colspan="4">${linhas.length} Registros</td><td class="d">${valorBR(total)}</td><td></td></tr></tfoot></table>
</body></html>`;
}

/** Telas Equipamentos, Produtos, Tabelas e Estoque do Delphi: nível A */
export function createCadastrosRouter() {
  const router = Router();
  const soAdmin = (_req: Request, res: Response, next: NextFunction) =>
    temNivel(res, 'A') ? next() : res.status(403).json({ error: 'Somente administradores acessam esta opção.' });
  const falha = (res: Response, err: any) => res.status(err.status || 400).json({ error: friendlyDbError(err) });

  /**
   * Planos e séries: o Id é digitado (char, PK com o grupo/empresa). O CRUD genérico não grava a PK de tabelas
   * sem AUTO_INCREMENT, então a inclusão é tratada aqui (antes do CRUD genérico); alterar/excluir seguem por ele.
   */
  router.post('/crud/:recurso(fatur_planos|fatur_series)', soAdmin, async (req: Request, res: Response) => {
    try {
      const serie = req.params.recurso === 'fatur_series';
      const ctx = contexto(res);
      const b = req.body || {};
      const id = String(b.id ?? '').trim().toUpperCase();
      if (!id || id.length > 3) return res.status(400).json({ error: 'Informe o Id (até 3 caracteres).' });
      const texto = (v: unknown, max: number) => (String(v ?? '').trim() ? String(v).trim().slice(0, max) : null);
      const linha: Record<string, unknown> = { id, id_grupo: ctx.grupoId, descricao: texto(b.descricao, 25), modelo_nf: texto(b.modelo_nf, 30) };
      if (serie) Object.assign(linha, { id_empresa: ctx.empresaId, ultima_nota: b.ultima_nota === '' || b.ultima_nota == null ? null : Math.trunc(Number(b.ultima_nota)) || 0 });
      const tabela = serie ? 'fatur_series' : 'fatur_planos';
      const [ja] = await pool.query<any[]>(`SELECT 1 FROM ${tabela} WHERE id = ? AND id_grupo = ?${serie ? ' AND id_empresa = ?' : ''}`, [id, ctx.grupoId, ctx.empresaId]);
      if (ja.length) return res.status(409).json({ error: `Já existe ${serie ? 'série' : 'plano'} com o Id ${id}.` });
      const cols = Object.keys(linha);
      await comUsuario(ctx, (c) => c.query(`INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((k) => linha[k])));
      res.json({ success: true, id });
    } catch (err: any) {
      falha(res, err);
    }
  });

  // ------------------------------------------------------------ Equipamentos
  router.get('/equipamentos/inventario.pdf', soAdmin, async (_req: Request, res: Response) => {
    try {
      const [linhas] = await pool.query<any[]>(
        `SELECT M.descricao AS marca_descricao, A.modelo, A.nr_serie, A.data_aquisicao, A.valor_aquisicao,
                (SELECT P.nome FROM locacao_contratos C JOIN pessoas P ON P.id = C.id_cliente
                  WHERE C.id_equip = A.id AND C.ativo <> 'N' ORDER BY C.id DESC LIMIT 1) AS nome
           FROM equipamentos A
           LEFT JOIN equipamentos_marcas M ON M.id = A.id_marca
          WHERE A.id_grupo = ?
          ORDER BY nome, A.id`,
        [res.locals.grupoId],
      );
      const pdf = await gerarPdf(htmlInventarioEquip(linhas));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="inventario_equipamentos.pdf"');
      res.send(pdf);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** "Gerar NS" de um equipamento já gravado com o número de série em branco */
  router.post('/equipamentos/:id/gerar-ns', soAdmin, async (req: Request, res: Response) => {
    try {
      const ctx = contexto(res);
      const [[e]] = await pool.query<any[]>('SELECT id, nr_serie FROM equipamentos WHERE id = ? AND id_grupo = ?', [Number(req.params.id), ctx.grupoId]);
      if (!e) return res.status(404).json({ error: 'Equipamento não encontrado.' });
      if (String(e.nr_serie ?? '').trim()) return res.status(409).json({ error: `O equipamento já tem número de série (${e.nr_serie}).` });
      const ns = await gerarNumeroSerie(ctx.grupoId);
      await comUsuario(ctx, (c) => c.query('UPDATE equipamentos SET nr_serie = ? WHERE id = ?', [ns, e.id]));
      res.json({ success: true, nr_serie: ns });
    } catch (err: any) {
      falha(res, err);
    }
  });

  // ------------------------------------------------------------ Produtos: árvore Família > Grupo > Subgrupo
  router.get('/produtos-grupos/arvore', soAdmin, async (_req: Request, res: Response) => {
    try {
      const [rows] = await pool.query<any[]>(
        `SELECT A.ID AS id, A.ID_FAMILIA AS id_familia, A.FAMILIA_DESCRICAO AS familia, A.ID_PRODUTOS_GRUPOS AS id_pai,
                A.GRUPO_DESCRICAO_AUX AS descricao, A.descricao_completa AS caminho_pai, A.descricao_complex AS caminho,
                (SELECT COUNT(*) FROM produtos_grupos F WHERE F.id_produtos_grupos = A.ID) AS filhos,
                (SELECT COUNT(*) FROM produtos P WHERE P.id_familia_grupo = A.ID) AS produtos
           FROM produtos_arvore_grupos A
          WHERE A.ID_GRUPO = ?
          ORDER BY A.FAMILIA_DESCRICAO, A.descricao_complex`,
        [res.locals.grupoId],
      );
      res.json(
        rows.map((r) => ({
          ...r,
          nivel: r.caminho_pai ? String(r.caminho_pai).split('/').length : 0,
          filhos: Number(r.filhos),
          produtos: Number(r.produtos),
        })),
      );
    } catch (err: any) {
      falha(res, err);
    }
  });

  // ------------------------------------------------------------ Tabelas › Etiquetas VOID (produtos_clientes, sem PK)
  router.get('/etiquetas-void', soAdmin, async (req: Request, res: Response) => {
    try {
      const busca = String(req.query.busca ?? '').trim();
      const [rows] = await pool.query<any[]>(
        `SELECT A.nr_serie, A.id_cliente, P.nome AS cliente, A.id_produto, B.descricao AS produto
           FROM produtos_clientes A
           LEFT JOIN pessoas P ON P.id = A.id_cliente
           LEFT JOIN produtos B ON B.id = A.id_produto
          WHERE A.id_grupo = ? AND A.id_empresa = ?${busca ? ' AND (A.nr_serie LIKE ? OR P.nome LIKE ? OR B.descricao LIKE ?)' : ''}
          ORDER BY A.nr_serie
          LIMIT 1001`, // ponytail: lista até 1000; a busca acha o resto
        [res.locals.grupoId, res.locals.empresaId, ...(busca ? [`%${busca}%`, `%${busca}%`, `%${busca}%`] : [])],
      );
      res.json({ linhas: rows.slice(0, 1000), mais: rows.length > 1000 });
    } catch (err: any) {
      falha(res, err);
    }
  });

  router.post('/etiquetas-void/gerar', soAdmin, async (req: Request, res: Response) => {
    try {
      const formato = String(req.body?.formato ?? '').trim();
      const inicial = Math.trunc(Number(req.body?.inicial));
      const final = Math.trunc(Number(req.body?.final));
      if (!formato) return res.status(400).json({ error: 'Informe o formato da etiqueta.' });
      if (!Number.isFinite(inicial) || !Number.isFinite(final) || inicial < 0 || final < inicial) return res.status(400).json({ error: 'Faixa de números inválida: a final deve ser maior ou igual à inicial.' });
      if (final - inicial >= 10000) return res.status(400).json({ error: 'Gere no máximo 10.000 etiquetas por vez.' });
      const [ano, mes] = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).split('-').map(Number);
      const numeros = Array.from({ length: final - inicial + 1 }, (_, i) => formatarEtiquetaVoid(formato, inicial + i, { mes, ano }));
      const longo = numeros.find((n) => n.length > 25);
      if (longo) return res.status(400).json({ error: `A etiqueta "${longo}" passa de 25 caracteres.` });
      const ctx = contexto(res);
      let geradas = 0;
      await comUsuario(ctx, async (c) => {
        for (const nr of numeros) {
          const [r] = await c.query<any>(
            `INSERT INTO produtos_clientes (id_grupo, id_empresa, nr_serie)
             SELECT ?, ?, ? FROM DUAL
              WHERE NOT EXISTS (SELECT 1 FROM produtos_clientes WHERE id_grupo = ? AND id_empresa = ? AND nr_serie = ?)`,
            [ctx.grupoId, ctx.empresaId, nr, ctx.grupoId, ctx.empresaId, nr],
          );
          geradas += r.affectedRows;
        }
      });
      res.json({ success: true, geradas, ignoradas: numeros.length - geradas });
    } catch (err: any) {
      falha(res, err);
    }
  });

  router.delete('/etiquetas-void', soAdmin, async (req: Request, res: Response) => {
    try {
      const nr = String(req.query.nr_serie ?? '');
      const ctx = contexto(res);
      const [[e]] = await pool.query<any[]>(
        'SELECT MAX(id_cliente) AS id_cliente FROM produtos_clientes WHERE id_grupo = ? AND id_empresa = ? AND nr_serie = ?',
        [ctx.grupoId, ctx.empresaId, nr],
      );
      if (e?.id_cliente) return res.status(409).json({ error: `A etiqueta ${nr} já está ligada ao cliente nº ${e.id_cliente}: não pode ser excluída.` });
      const [r] = await comUsuario(ctx, (c) => c.query<any>('DELETE FROM produtos_clientes WHERE id_grupo = ? AND id_empresa = ? AND nr_serie = ?', [ctx.grupoId, ctx.empresaId, nr]));
      if (!r.affectedRows) return res.status(404).json({ error: 'Etiqueta não encontrada.' });
      res.json({ success: true });
    } catch (err: any) {
      falha(res, err);
    }
  });

  // ------------------------------------------------------------ Estoque: RECALCULAR SALDOS (custo médio móvel)
  router.post('/estoque/recalcular', soAdmin, async (_req: Request, res: Response) => {
    try {
      const ctx = contexto(res);
      const [movs] = await pool.query<any[]>(
        `SELECT id, produto_id, ES, qtdade_mov, valor_total_mov FROM produtos_cardex
          WHERE id_grupo = ?
          ORDER BY produto_id, COALESCE(datahora_mov, TIMESTAMP(data_mov, COALESCE(hora_mov, '00:00:00'))), id`,
        [ctx.grupoId],
      );
      const porProduto = new Map<number, any[]>();
      for (const m of movs) porProduto.set(m.produto_id, [...(porProduto.get(m.produto_id) ?? []), m]);
      await comUsuario(ctx, async (c) => {
        for (const lista of porProduto.values()) {
          for (const s of recalcularKardex(lista)) {
            await c.query(
              'UPDATE produtos_cardex SET qtdade_saldo = ?, valor_unit_mov = ?, valor_total_mov = ?, valor_custo_medio_unit = ?, valor_total_estoque = ? WHERE id = ?',
              [s.qtdade_saldo, s.valor_unit_mov, s.valor_total_mov, s.valor_custo_medio_unit, s.valor_total_estoque, s.id],
            );
          }
        }
      });
      res.json({ success: true, produtos: porProduto.size, movimentos: movs.length });
    } catch (err: any) {
      falha(res, err);
    }
  });

  return router;
}
