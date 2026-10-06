import { Router, Request, Response, NextFunction } from 'express';
import { pool, comUsuario } from './db.js';
import { contexto, temNivel } from './crud.js';
import { registrarRegras, recusar } from './regras.js';
import { gerarPdf } from './pdf.js';
import { emailConfigurado, enderecos, enviarEmail } from './email.js';
import { paginaContrato, preencherContrato } from '../src/modulos/clientes/contrato.js';

// BeforePost do Delphi (CPF/CNPJ só dígitos: o tipo 'cnpj' do recurso já faz) + validações que o Delphi não tinha
registrarRegras('pessoas', {
  antesDeGravar(payload) {
    if (typeof payload.endereco_cep === 'string') {
      const cep = payload.endereco_cep.replace(/\D/g, '');
      if (cep && cep.length !== 8) throw recusar('CEP inválido: são 8 dígitos.', 400);
      payload.endereco_cep = cep;
    }
    if (typeof payload.endereco_uf === 'string') payload.endereco_uf = payload.endereco_uf.toUpperCase();
    if (typeof payload.email === 'string' && payload.email.trim() && !enderecos(payload.email).length) throw recusar('e-Mail inválido.', 400);
    if (payload.id_plano === null) payload.id_plano = '0';
    if (payload.id_banco === null) payload.id_banco = 0;
  },
  // O Delphi excluía sem olhar nada; aqui a exclusão é recusada se o cliente tem movimento
  async antesDeExcluir(id, ctx) {
    const [[r]] = await pool.query<any[]>(
      `SELECT (SELECT COUNT(*) FROM locacao_contratos WHERE id_cliente = ? AND id_grupo = ?) contratos,
              (SELECT COUNT(*) FROM os WHERE id_cliente = ? AND id_grupo = ?) os,
              (SELECT COUNT(*) FROM fatur_notas WHERE id_cliente = ?) notas,
              (SELECT COUNT(*) FROM areceber WHERE id_cliente = ?) areceber,
              (SELECT COUNT(*) FROM vendas WHERE id_cliente = ?) vendas,
              (SELECT COUNT(*) FROM apagar WHERE id_fornecedor = ?) apagar`,
      [id, ctx.grupoId, id, ctx.grupoId, id, id, id, id],
    );
    const nomes: Record<string, string> = { contratos: 'contrato(s) de locação', os: 'OS', notas: 'nota(s)', areceber: 'conta(s) a receber', vendas: 'venda(s)', apagar: 'conta(s) a pagar' };
    const tem = Object.entries(r).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${n} ${nomes[k]}`);
    if (tem.length) throw recusar(`Não é possível excluir: o cliente tem ${tem.join(', ')}.`);
  },
});

/** Colunas da lista (qrClientes do Delphi), sem o contrato e a senha */
const COLUNAS_LISTA = `A.id, A.cliente_flag, A.fornec_flag, A.fj, A.tipo_imposto, A.nome, A.fantasia, A.endereco, A.endereco_nr,
  A.endereco_complemento, A.endereco_bairro, A.endereco_uf, A.endereco_cep, A.endereco_id_cidade, A.endereco_cidade,
  A.endereco_lat, A.endereco_lon, A.regiao, A.cpf_cnpj, A.rg, A.representante_legal_nome, A.representante_legal_cpf,
  A.fone_fixo, A.fone_celular1, A.fone_celular2, A.email, A.id_banco, A.id_plano, A.id_integracao, A.obs_nf, A.obs,
  IF(A.contrato IS NULL, 'N', 'S') tem_contrato, IF(COALESCE(A.endereco_lat, 0) <> 0, 'S', 'N') tem_coordenadas,
  IF(COALESCE(A.senha, '') <> '', 'S', 'N') tem_senha,
  (SELECT B.apelido FROM bancos B WHERE B.id = A.id_banco AND B.id_grupo = A.id_grupo LIMIT 1) banco,
  (SELECT P.descricao FROM fatur_planos P WHERE P.id = A.id_plano AND P.id_grupo = A.id_grupo LIMIT 1) plano`;

const dataHoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/** Contratos de locação do cliente (grade "Lista de Equipamentos"), na ordem do número de série */
async function contratosDoCliente(id: number, grupo: number) {
  const [rows] = await pool.query<any[]>(
    `SELECT C.id, C.id_empresa, C.id_equip, M.descricao marca_descricao, E.modelo, C.nr_serie, C.setor, C.data_contrato,
            C.data_vencimento, C.dia_leitura, C.dia_vencimento, C.valor_contrato, C.valor_copia, C.valor_excedente, C.nr_copias,
            C.obs, C.ativo, C.codigo_grupo, C.serie_nf
       FROM locacao_contratos C
       LEFT JOIN equipamentos E ON E.id = C.id_equip
       LEFT JOIN equipamentos_marcas M ON M.id = E.id_marca
      WHERE C.id_cliente = ? AND C.id_grupo = ?
      ORDER BY C.nr_serie`,
    [id, grupo],
  );
  return rows;
}

async function clienteDoGrupo(id: number, grupo: number) {
  const [[c]] = await pool.query<any[]>('SELECT * FROM pessoas WHERE id = ? AND id_grupo = ?', [id, grupo]);
  if (!c) throw recusar('Cliente não encontrado.', 404);
  return c;
}

const erro = (res: Response, err: any) => res.status(err.status || 400).json({ error: err.message });

/** Tela Clientes / Fornecedores do Delphi: menu de nível A */
export function createClientesRouter() {
  const router = Router();
  router.use('/clientes', (_req: Request, res: Response, next: NextFunction) =>
    temNivel(res, 'A') ? next() : res.status(403).json({ error: 'Somente administradores acessam Clientes.' }),
  );
  const grupo = (res: Response) => Number(res.locals.grupoId);

  /** Combos da tela: bancos e planos do grupo (o Delphi não filtrava os planos), regiões e coordenadas da empresa ativa */
  router.get('/clientes/opcoes', async (_req, res) => {
    try {
      const [bancos] = await pool.query('SELECT id, apelido, nome FROM bancos WHERE id_grupo = ? ORDER BY apelido', [grupo(res)]);
      const [planos] = await pool.query('SELECT id, descricao FROM fatur_planos WHERE id_grupo = ? ORDER BY descricao', [grupo(res)]);
      // ponytail: regiões do grupo (o Delphi filtrava pela empresa ativa, mas o cliente é do grupo)
      const [regioes] = await pool.query('SELECT id, descricao FROM pessoas_regiao WHERE id_grupo = ? ORDER BY id', [grupo(res)]);
      const [[empresa]] = await pool.query<any[]>('SELECT latitude, longitude FROM empresas_filiais WHERE id = ?', [Number(res.locals.empresaId)]);
      res.json({ bancos, planos, regioes, empresa: empresa ?? null });
    } catch (err) {
      erro(res, err);
    }
  });

  /**
   * Lista (btnAtualizarClick): filtros ID, Nome (começa com), CPF/CNPJ e Região — no Delphi ID e CPF não filtravam.
   * `mapa=1`: todos os filtrados com coordenadas, sem paginação (botão Mapa).
   */
  router.get('/clientes/lista', async (req, res) => {
    try {
      const where = ['A.id_grupo = ?'];
      const params: any[] = [grupo(res)];
      const id = Number(req.query.id) || 0;
      const nome = String(req.query.nome ?? '').trim();
      const cpf = String(req.query.cpf ?? '').replace(/\D/g, '');
      const regiao = String(req.query.regiao ?? '').trim();
      if (id) where.push('A.id = ?'), params.push(id);
      if (nome) where.push('A.nome LIKE ?'), params.push(`${nome}%`);
      if (cpf) where.push(`REPLACE(REPLACE(REPLACE(A.cpf_cnpj, '.', ''), '-', ''), '/', '') LIKE ?`), params.push(`%${cpf}%`);
      if (regiao) where.push('A.regiao = ?'), params.push(regiao);
      if (req.query.mapa === '1') {
        const [rows] = await pool.query(`SELECT ${COLUNAS_LISTA} FROM pessoas A WHERE ${where.join(' AND ')} AND COALESCE(A.endereco_lat, 0) <> 0 ORDER BY A.nome LIMIT 5000`, params);
        return res.json({ data: rows, total: (rows as any[]).length });
      }
      const limite = Math.min(200, Math.max(1, Number(req.query.limite) || 100));
      const pagina = Math.max(1, Number(req.query.pagina) || 1);
      const [[{ total }]] = await pool.query<any[]>(`SELECT COUNT(*) total FROM pessoas A WHERE ${where.join(' AND ')}`, params);
      const [rows] = await pool.query(`SELECT ${COLUNAS_LISTA} FROM pessoas A WHERE ${where.join(' AND ')} ORDER BY A.nome, A.id LIMIT ? OFFSET ?`, [
        ...params,
        limite,
        (pagina - 1) * limite,
      ]);
      res.json({ data: rows, total: Number(total) });
    } catch (err) {
      erro(res, err);
    }
  });

  /** Clique nas colunas ".", CLI e FOR: inverte o valor gravado no banco (Refresh + Edit + Post do Delphi) e grava na hora */
  router.post('/clientes/:id/alternar', async (req, res) => {
    try {
      const expr: Record<string, string> = {
        fj: "IF(fj = 'F', 'J', 'F')",
        cliente_flag: "IF(cliente_flag = 'S', 'N', 'S')",
        fornec_flag: "IF(fornec_flag = 'S', 'N', 'S')",
      };
      const campo = String(req.body?.campo ?? '');
      if (!expr[campo]) return res.status(400).json({ error: 'Campo inválido.' });
      const id = Number(req.params.id);
      const valor = await comUsuario(contexto(res), async (conn) => {
        const [r] = await conn.query<any>(`UPDATE pessoas SET ${campo} = ${expr[campo]} WHERE id = ? AND id_grupo = ?`, [id, grupo(res)]);
        if (!r.affectedRows) throw recusar('Cliente não encontrado.', 404);
        const [[p]] = await conn.query<any[]>(`SELECT ${campo} v FROM pessoas WHERE id = ?`, [id]);
        return p.v;
      });
      res.json({ valor });
    } catch (err) {
      erro(res, err);
    }
  });

  /** Grade "Lista de Equipamentos" embaixo da lista: contratos de locação do cliente (somente leitura) */
  router.get('/clientes/:id/contratos', async (req, res) => {
    try {
      res.json(await contratosDoCliente(Number(req.params.id), grupo(res)));
    } catch (err) {
      erro(res, err);
    }
  });

  /** Aba Inventário: produtos em posse do cliente (view produtos_estoque_clientes) */
  router.get('/clientes/:id/inventario', async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT A.ID_PRODUTO id_produto, A.QTDADE qtdade, C.DESCRICAO descricao, D.APELIDO apelido_grupo, E.APELIDO apelido_empresa,
                F.ID id_equip, G.DESCRICAO marca_descricao, F.MODELO modelo_descricao, H.SETOR setor
           FROM produtos_estoque_clientes A
           LEFT JOIN produtos C ON C.ID = A.ID_PRODUTO
           LEFT JOIN empresas_grupos D ON D.ID = A.ID_GRUPO
           LEFT JOIN empresas_filiais E ON E.ID = A.ID_EMPRESA
           LEFT JOIN locacao_contratos H ON H.ID = A.ID_CONTRATO
           LEFT JOIN equipamentos F ON F.ID = H.ID_EQUIP
           LEFT JOIN equipamentos_marcas G ON G.ID = F.ID_MARCA
          WHERE A.ID_CLIENTE = ? AND A.ID_GRUPO = ?
          ORDER BY C.DESCRICAO`,
        [Number(req.params.id), grupo(res)],
      );
      res.json(rows);
    } catch (err) {
      erro(res, err);
    }
  });

  /** "Copiar Padrão": contrato padrão da empresa ativa com as variáveis trocadas (não grava; a tela grava em seguida) */
  router.get('/clientes/:id/contrato-padrao', async (req, res) => {
    try {
      const c = await clienteDoGrupo(Number(req.params.id), grupo(res));
      const [[e]] = await pool.query<any[]>('SELECT contrato_padrao FROM empresas_filiais WHERE id = ? AND id_grupo = ?', [Number(res.locals.empresaId), grupo(res)]);
      if (!String(e?.contrato_padrao ?? '').trim()) throw recusar('A empresa ativa não tem contrato padrão. Cadastre em Empresas › Contrato.', 404);
      const equipamentos = (await contratosDoCliente(c.id, grupo(res))).filter((x) => x.ativo === 'S');
      res.json({ html: preencherContrato(String(e.contrato_padrao), c, equipamentos, dataHoje()) });
    } catch (err) {
      erro(res, err);
    }
  });

  const pdfDoContrato = async (id: number, grupoId: number) => {
    const c = await clienteDoGrupo(id, grupoId);
    if (!String(c.contrato ?? '').trim()) throw recusar('O cliente não tem contrato.', 404);
    const nome = `contrato_${String(c.id).padStart(6, '0')}.pdf`;
    return { c, nome, pdf: await gerarPdf(paginaContrato(String(c.contrato), `Contrato - ${c.nome}`)) };
  };

  /** PDF do contrato gravado do cliente (o Delphi gerava contrato_<ID 6 dígitos>.pdf com o wkhtmltopdf) */
  router.get('/clientes/:id/contrato.pdf', async (req, res) => {
    try {
      const { nome, pdf } = await pdfDoContrato(Number(req.params.id), grupo(res));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
      res.send(pdf);
    } catch (err) {
      erro(res, err);
    }
  });

  /** "Enviar por Email": PDF anexado ao e-mail do cliente; sem SMTP ou sem e-mail, devolve enviado=false (a tela baixa o PDF) */
  router.post('/clientes/:id/contrato/email', async (req, res) => {
    try {
      const c = await clienteDoGrupo(Number(req.params.id), grupo(res));
      if (!emailConfigurado()) return res.json({ enviado: false, motivo: 'E-mail não configurado no servidor: o PDF foi baixado.' });
      const para = enderecos(c.email);
      if (!para.length) return res.json({ enviado: false, motivo: 'Cliente sem e-mail válido: o PDF foi baixado.' });
      const { nome, pdf } = await pdfDoContrato(c.id, grupo(res));
      const [[e]] = await pool.query<any[]>('SELECT nome_comercial, apelido, email_financeiro FROM empresas_filiais WHERE id = ?', [Number(res.locals.empresaId)]);
      const empresa = e?.nome_comercial || e?.apelido || 'PrintControl';
      await enviarEmail({
        para,
        assunto: `Contrato - ${empresa}`,
        html: `<p>Prezado(a) ${c.nome},</p><p>Segue em anexo o contrato de locação.</p><p>Atenciosamente,<br>${empresa}</p>`,
        nomeRemetente: empresa,
        responderPara: enderecos(e?.email_financeiro)[0],
        anexos: [{ filename: nome, content: pdf, contentType: 'application/pdf' }],
      });
      res.json({ enviado: true, para: para.join(', ') });
    } catch (err) {
      erro(res, err);
    }
  });

  return router;
}
