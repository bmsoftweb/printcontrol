import express, { Router, Request, Response, NextFunction } from 'express';
import { pool } from './db.js';
import { temNivel } from './crud.js';
import { registrarRegras, recusar } from './regras.js';
import { gravar, nomeSeguro } from './armazenamento.js';

// Usuários: e-mail é o login, então não pode repetir entre usuários ativos
registrarRegras('usuarios', {
  async antesDeGravar(payload, id) {
    if (payload.email) {
      payload.email = String(payload.email).trim();
      const [r] = await pool.query<any[]>('SELECT id FROM usuarios WHERE LOWER(email) = LOWER(?) AND id <> ? LIMIT 1', [payload.email, id ?? 0]);
      if (r.length) throw recusar(`O e-mail ${payload.email} já é usado pelo usuário nº ${r[0].id}.`);
    }
    if (payload.nivel) payload.nivel = String(payload.nivel).charAt(0).toUpperCase();
  },
  async antesDeExcluir(id) {
    await pool.query('DELETE FROM empresas_usuarios WHERE id_usuario = ?', [id]);
  },
});

/** Telas Usuários e Empresas do Delphi: nível A */
export function createAcessoRouter() {
  const router = Router();
  const soAdmin = (_req: Request, res: Response, next: NextFunction) =>
    temNivel(res, 'A') ? next() : res.status(403).json({ error: 'Somente administradores acessam esta opção.' });

  /** "Liberar Usuário para as Empresas": empresas do grupo do usuário com o indicador de acesso */
  router.get('/usuarios/:id/empresas', soAdmin, async (req: Request, res: Response) => {
    try {
      const [rows] = await pool.query<any[]>(
        `SELECT A.id, A.apelido, A.nome_comercial, (B.id IS NOT NULL) AS acesso
           FROM empresas_filiais A
           JOIN usuarios U ON U.id = ? AND U.id_grupo = :grupo
           LEFT JOIN empresas_usuarios B ON B.id_empresa = A.id AND B.id_usuario = U.id
          WHERE A.id_grupo = U.id_grupo
          ORDER BY A.id`.replace(':grupo', String(Number(res.locals.grupoId))),
        [Number(req.params.id)],
      );
      res.json(rows.map((r) => ({ ...r, acesso: Boolean(Number(r.acesso)) })));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/usuarios/:id/empresas/:empresaId', soAdmin, async (req: Request, res: Response) => {
    try {
      const usuarioId = Number(req.params.id);
      const empresaId = Number(req.params.empresaId);
      const grupo = Number(res.locals.grupoId);
      const [[ok]] = await pool.query<any[]>(
        'SELECT 1 AS ok FROM usuarios U JOIN empresas_filiais E ON E.id = ? AND E.id_grupo = U.id_grupo WHERE U.id = ? AND U.id_grupo = ?',
        [empresaId, usuarioId, grupo],
      );
      if (!ok) return res.status(404).json({ error: 'Usuário ou empresa não encontrado neste grupo.' });
      if (req.body?.acesso) {
        await pool.query(
          'INSERT INTO empresas_usuarios (id_empresa, id_usuario) SELECT ?, ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM empresas_usuarios WHERE id_empresa = ? AND id_usuario = ?)',
          [empresaId, usuarioId, empresaId, usuarioId],
        );
      } else {
        await pool.query('DELETE FROM empresas_usuarios WHERE id_empresa = ? AND id_usuario = ?', [empresaId, usuarioId]);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Upload .PFX: guarda o certificado na pasta do CNPJ da empresa da linha (o Delphi usava a da empresa ativa) */
  router.post('/empresas/:id/pfx', soAdmin, express.raw({ type: 'application/octet-stream', limit: '5mb' }), async (req: Request, res: Response) => {
    try {
      const nome = nomeSeguro(String(req.query.nome || 'certificado.pfx'));
      if (!/\.(pfx|p12)$/i.test(nome)) return res.status(400).json({ error: 'Envie um certificado .pfx ou .p12.' });
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Arquivo vazio.' });
      const [[e]] = await pool.query<any[]>('SELECT id, cnpj FROM empresas_filiais WHERE id = ? AND id_grupo = ?', [Number(req.params.id), Number(res.locals.grupoId)]);
      if (!e) return res.status(404).json({ error: 'Empresa não encontrada.' });
      const grupo = String(res.locals.grupoId).padStart(6, '0');
      const cnpj = String(e.cnpj || e.id).replace(/\D/g, '');
      // Sufixo aleatório: o endereço não é adivinhável (o Blob é público). ponytail: guardar cifrado se o certificado passar a ser usado pelo servidor
      const url = await gravar(`grupos/${grupo}/empresas/${cnpj}/pfx/${nome}`, req.body, 'application/x-pkcs12', true);
      await pool.query('UPDATE empresas_filiais SET arquivo_pfx = ? WHERE id = ?', [(url.length <= 120 ? url : nome).slice(0, 120), e.id]);
      res.json({ success: true, arquivo: nome });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  return router;
}
