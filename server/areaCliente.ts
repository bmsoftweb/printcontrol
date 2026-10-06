import { Router, type Request, type Response } from 'express';
import { pool, comUsuario } from './db.js';
import { gerarPdf } from './pdf.js';

/**
 * Área do Cliente (ufrmAreaCliente + ufrmAvaliacao), montada em /api/cliente.
 * O middleware de app.ts já validou o token de cliente: res.locals.cliente (pessoas) e res.locals.grupoId.
 * Tudo é filtrado pelo cliente logado, pelo grupo dele e só por contratos ativos (o Delphi mostrava os encerrados).
 */

export interface ContratoCliente {
  id: number;
  id_grupo: number;
  id_empresa: number;
  id_cliente: number;
  id_equip: number;
  marca_descricao: string | null;
  modelo: string | null;
  nr_serie: string | null;
  setor: string | null;
  rede_usb: string | null;
}

/** Rascunho de uma linha da grade, como as colunas em memória do Delphi (qtdade_req, qtdade_cil, nome_req, os_problema, leituras) */
export interface ItemEnvio {
  contratoId: number;
  qtdade?: number;
  qtdadeCil?: number;
  nome?: string;
  obs?: string;
  leituraPb?: number;
  leituraColor?: number;
}

export type TipoEnvio = 'pedido' | 'reparo' | 'leituras';

const SQL_CONTRATOS = `
  SELECT C.id, C.id_grupo, C.id_empresa, C.id_cliente, C.id_equip, M.descricao AS marca_descricao, E.modelo,
         C.nr_serie, C.setor, C.rede_usb
    FROM locacao_contratos C
    LEFT JOIN equipamentos E ON E.id = C.id_equip
    LEFT JOIN equipamentos_marcas M ON M.id = E.id_marca
   WHERE C.id_cliente = ? AND C.id_grupo = ? AND COALESCE(C.ativo, 'S') = 'S'
   ORDER BY C.nr_serie`;

async function contratosDo(res: Response): Promise<ContratoCliente[]> {
  const [rows] = await pool.query<any[]>(SQL_CONTRATOS, [res.locals.cliente.id, res.locals.grupoId]);
  return rows;
}

const inteiro = (v: unknown) => Math.max(0, Math.trunc(Number(v) || 0));
const texto = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const nota = (v: unknown) => Math.min(5, inteiro(v));

/**
 * Linhas a gravar a partir do rascunho (função pura, testada em tests/areaCliente.test.ts).
 * Itens de contratos que não são do cliente (ou inativos) são ignorados.
 * - pedido (os_cliente tipo 'R'): cartucho > 0 OU cilindro > 0 (o Delphi ignorava o pedido só de cilindro)
 * - reparo (os_cliente tipo 'C'): problema preenchido, qtdade = 1
 * - leituras (equipamentos_leituras): P/B + Color > 0
 */
export function montarEnvio(tipo: TipoEnvio, contratos: ContratoCliente[], itens: ItemEnvio[], cnpj: string) {
  const porId = new Map(contratos.map((c) => [Number(c.id), c]));
  const os: Record<string, unknown>[] = [];
  const leituras: { id_equip: number; leitura_pb: number; leitura_color: number }[] = [];
  for (const it of Array.isArray(itens) ? itens : []) {
    const c = porId.get(Number(it?.contratoId));
    if (!c) continue;
    if (tipo === 'leituras') {
      const pb = inteiro(it.leituraPb);
      const color = inteiro(it.leituraColor);
      if (pb + color > 0) leituras.push({ id_equip: c.id_equip, leitura_pb: pb, leitura_color: color });
      continue;
    }
    const base = {
      id_grupo: c.id_grupo,
      id_empresa: c.id_empresa,
      id_cliente: c.id_cliente,
      id_equip: c.id_equip,
      id_contrato: c.id,
      cnpj_cliente: cnpj.replace(/\D/g, '').slice(0, 14),
      nome_req: texto(it.nome, 50),
      equip_descricao: [c.marca_descricao, c.modelo, c.setor].map((s) => s ?? '').join(' ').trim().slice(0, 50),
      obs: texto(it.obs, 255),
      status: 'A',
    };
    if (tipo === 'pedido') {
      const qtdade = Math.min(99, inteiro(it.qtdade));
      const qtdadeCil = Math.min(99, inteiro(it.qtdadeCil));
      if (qtdade > 0 || qtdadeCil > 0) os.push({ ...base, tipo_os: 'R', qtdade, qtdade_cil: qtdadeCil });
    } else if (base.obs) {
      os.push({ ...base, tipo_os: 'C', qtdade: 1 });
    }
  }
  return { os, leituras };
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** HTML A4 equivalente ao rel\minhas_impressoras.fr3 (coluna LEITURA em branco, para anotar à mão) */
export function htmlMinhasImpressoras(contratos: ContratoCliente[], empresaLocadora: string, emissao: string) {
  const linhas = contratos
    .map(
      (c) => `<tr><td class="c">${esc(c.id_equip)}</td><td>${esc(c.marca_descricao)}</td><td>${esc(c.modelo)}</td>` +
        `<td>${esc(c.nr_serie)}</td><td>${esc(c.setor)}</td><td></td></tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Minhas Impressoras</title><style>
@page { size: A4; margin: 10mm; }
body { font-family: 'Courier New', monospace; font-size: 11px; color: #000; margin: 0; }
h1 { font-family: Arial, sans-serif; font-size: 15px; text-align: center; margin: 0 0 6px; }
.topo { display: flex; justify-content: space-between; font-size: 9px; border-bottom: 1px solid #000; padding-bottom: 3px; margin-bottom: 6px; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #000; padding: 4px 5px; height: 16px; }
th { text-align: center; font-weight: normal; background: #eee; }
td.c { text-align: center; }
</style></head><body>
<h1>IMPRESSORAS LOCADAS</h1>
<div class="topo"><span>printControl</span><span>${esc(empresaLocadora)}</span><span>Emissão: ${esc(emissao)}</span></div>
<table><thead><tr><th style="width:11%">ID#</th><th style="width:13%">MARCA</th><th style="width:15%">MODELO</th>
<th style="width:20%">NR. SÉRIE</th><th style="width:20%">SETOR</th><th style="width:21%">LEITURA</th></tr></thead>
<tbody>${linhas}</tbody></table></body></html>`;
}

export function createAreaClienteRouter() {
  const router = Router();

  /** Contratos ativos do cliente (query base §9.1, recarregada ao entrar em cada opção) */
  router.get('/contratos', async (_req: Request, res: Response) => {
    try {
      res.json(await contratosDo(res));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Enviar Pedido / Enviar Solicitação / Enviar Leituras, com a avaliação (0 = avaliar depois) */
  router.post('/enviar', async (req: Request, res: Response) => {
    try {
      const tipo = req.body?.tipo as TipoEnvio;
      if (!['pedido', 'reparo', 'leituras'].includes(tipo)) return res.status(400).json({ error: 'Tipo de envio inválido.' });
      const cliente = res.locals.cliente;
      const { os, leituras } = montarEnvio(tipo, await contratosDo(res), req.body?.itens, String(cliente.cpf_cnpj ?? ''));
      const avaliacao = { nota_avaliacao: nota(req.body?.nota), obs_avaliacao: texto(req.body?.obsAvaliacao, 255) };

      await comUsuario({ usuarioId: null, grupoId: res.locals.grupoId, empresaId: null, ip: res.locals.ip }, async (conn) => {
        for (const o of os) {
          // datahora_os explícita (hora de Brasília da conexão), em vez do DEFAULT do banco
          await conn.query('INSERT INTO os_cliente SET ?, datahora_os = NOW()', [{ ...o, ...avaliacao }]);
        }
        for (const l of leituras) {
          // A trigger bi_equipamentos_leituras completa equip_ns, equip_marca e equip_modelo
          await conn.query('INSERT INTO equipamentos_leituras SET ?, data_leitura = CURDATE(), datahora_inclusao = NOW()', [{ ...l, ...avaliacao }]);
        }
      });
      res.json({ gravados: os.length + leituras.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Minhas Impressoras: PDF equivalente ao minhas_impressoras.fr3 */
  router.get('/minhas-impressoras', async (_req: Request, res: Response) => {
    try {
      const [[g]] = await pool.query<any[]>('SELECT apelido FROM empresas_grupos WHERE id = ?', [res.locals.grupoId]);
      const emissao = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).replace(',', ' -');
      const pdf = await gerarPdf(htmlMinhasImpressoras(await contratosDo(res), g?.apelido ?? '', emissao));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="minhas_impressoras.pdf"');
      res.send(pdf);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
