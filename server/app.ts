import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { pool, checkDbHealth, gravarLog, buscarServidor, noServidor, Servidor } from './db.js';
import { createCrudRouter } from './crud.js';
import { createArmazenamentoRouter, STORAGE_DIR } from './armazenamento.js';
import { ROTAS_MODULOS, ROTAS_CLIENTE, ROTAS_PUBLICAS } from './rotas.js';

// ==========================================================
// Sessão: token "<tipo>.<servidor>.<id>.<empresa>.<expiração>.<assinatura>" (HMAC-SHA256)
//   servidor = printcontrol_admin.servidores.id (banco de trabalho, digitado no login como no bi)
//   tipo u = usuário interno (empresa = empresa ativa escolhida no login)
//   tipo c = cliente da Área do Cliente (pessoas.id; empresa = 0)
// ==========================================================
const SEGREDO =
  process.env.SESSION_SECRET ||
  (console.warn('SESSION_SECRET não definido: as sessões expiram a cada reinício do servidor.'),
  crypto.randomBytes(32).toString('hex'));
const VALIDADE_MS = 30 * 24 * 60 * 60 * 1000;

const assinar = (dados: string) => crypto.createHmac('sha256', SEGREDO).update(dados).digest('base64url');

function emitirToken(tipo: 'u' | 'c', servidor: number, id: number, empresaId: number): string {
  const dados = `${tipo}.${servidor}.${id}.${empresaId}.${Date.now() + VALIDADE_MS}`;
  return `${dados}.${assinar(dados)}`;
}

function lerToken(token: string): { tipo: 'u' | 'c'; servidor: number; id: number; empresaId: number } | null {
  const [tipo, servidor, id, empresa, exp, assinatura] = String(token || '').split('.');
  if ((tipo !== 'u' && tipo !== 'c') || !servidor || !id || !exp || !assinatura) return null;
  const esperada = assinar(`${tipo}.${servidor}.${id}.${empresa}.${exp}`);
  if (esperada.length !== assinatura.length || !crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(assinatura))) return null;
  if (Number(exp) < Date.now()) return null;
  return { tipo, servidor: Number(servidor), id: Number(id), empresaId: Number(empresa) };
}

/** IP de quem chamou (log do Delphi grava o IP) */
const ipDe = (req: Request) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 15);

// usuarios.senha é texto puro: o PrintControl Delphi usa a mesma tabela e confere assim (sem diferenciar maiúsculas, pela collation)
const SQL_USUARIO = `
  SELECT A.id, A.id_grupo, A.nome, A.email, A.senha, A.nivel, A.pagina_web, A.ativo
    FROM usuarios A
   WHERE COALESCE(A.ativo, 'S') <> 'N'`;

/** Empresas liberadas para o usuário (empresas_usuarios), do grupo dele */
const SQL_EMPRESAS_DO_USUARIO = `
  SELECT B.id, B.apelido, B.nome_comercial, B.id_grupo, G.apelido AS grupo_apelido, G.nome AS grupo_nome
    FROM empresas_usuarios A
    JOIN empresas_filiais B ON B.id = A.id_empresa
    LEFT JOIN empresas_grupos G ON G.id = B.id_grupo
   WHERE A.id_usuario = ? AND B.id_grupo = ?
   ORDER BY B.id`;

const usuarioPublico = (u: any) => ({
  id: String(u.id),
  nome: u.nome,
  email: u.email,
  nivel: String(u.nivel || 'Z').charAt(0).toUpperCase(),
  paginaWeb: u.pagina_web || null,
});

const servidorPublico = (s: Servidor) => ({ id: s.id, descricao: s.descricao });

const empresaPublica = (e: any) => ({
  id: Number(e.id),
  apelido: e.apelido || '',
  nome: e.nome_comercial || e.apelido || '',
  grupoId: Number(e.id_grupo),
  grupoApelido: e.grupo_apelido || '',
  grupoNome: e.grupo_nome || '',
});

/** App Express com todas as rotas /api. server.ts adiciona o Vite e o listen; na Vercel, api/index.ts */
export function createApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Login: Servidor (printcontrol_admin.servidores) + e-mail e senha (usuário interno) ou código numérico e senha (cliente)
  app.post('/api/login', async (req: Request, res: Response) => {
    try {
      const login = String(req.body?.usuario || '').trim();
      const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
      if (!String(req.body?.servidor ?? '').trim()) return res.status(400).json({ error: 'Informe o número do servidor.' });
      if (!login) return res.status(400).json({ error: 'Informe o usuário.' });
      const servidor = await buscarServidor(req.body.servidor);
      if (!servidor) return res.status(404).json({ error: 'Servidor não encontrado.' });
      await noServidor(servidor, () => entrar(req, res, servidor, login, senha));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Login no banco de trabalho do servidor escolhido */
  async function entrar(req: Request, res: Response, servidor: Servidor, login: string, senha: string) {
    {

      // Só dígitos = código do cliente (pessoas.id)
      if (/^\d+$/.test(login)) {
        const [rows] = await pool.query<any[]>(
          `SELECT A.id, A.id_grupo, A.nome, A.fantasia, A.senha, B.apelido AS grupo_apelido
             FROM pessoas A LEFT JOIN empresas_grupos B ON B.id = A.id_grupo
            WHERE A.id = ? AND COALESCE(A.ativo, 'S') <> 'N' LIMIT 1`,
          [Number(login)],
        );
        const c = rows[0];
        // Cliente sem senha cadastrada não entra (no Delphi entrava com senha vazia)
        if (!c || !c.senha || c.senha !== senha) return res.status(401).json({ error: 'Usuário e/ou senha inválido(s)!' });
        return res.json({
          token: emitirToken('c', servidor.id, Number(c.id), 0),
          servidor: servidorPublico(servidor),
          cliente: { id: Number(c.id), nome: c.nome, fantasia: c.fantasia, grupoId: Number(c.id_grupo), grupoApelido: c.grupo_apelido || '' },
        });
      }

      const [rows] = await pool.query<any[]>(`${SQL_USUARIO} AND LOWER(TRIM(A.email)) = LOWER(?) AND A.senha = ? LIMIT 1`, [login, senha]);
      const u = rows[0];
      if (!u || !senha) {
        // Diferente do Delphi, o log não grava a senha digitada
        await gravarLog({ usuarioId: null, grupoId: null, empresaId: null, ip: ipDe(req) }, `Tentativa de acesso negada! usuario: ${login.slice(0, 60)}`);
        return res.status(401).json({ error: 'Usuário/senha inválido(s)' });
      }
      if (!u.nivel) return res.status(401).json({ error: 'Usuário sem nível de acesso. Fale com o administrador.' });

      const [empresas] = await pool.query<any[]>(SQL_EMPRESAS_DO_USUARIO, [u.id, u.id_grupo]);
      if (!empresas.length) return res.status(401).json({ error: 'Usuário não liberado para nenhuma empresa' });

      // Mais de uma empresa: a tela pede a escolha e repete o login com empresaId
      const escolhida = empresas.length === 1 ? empresas[0] : empresas.find((e) => Number(e.id) === Number(req.body?.empresaId));
      if (!escolhida) return res.json({ escolherEmpresa: empresas.map(empresaPublica) });

      await gravarLog({ usuarioId: Number(u.id), grupoId: Number(escolhida.id_grupo), empresaId: Number(escolhida.id), ip: ipDe(req) }, 'Entrada no sistema');
      res.json({
        token: emitirToken('u', servidor.id, Number(u.id), Number(escolhida.id)),
        servidor: servidorPublico(servidor),
        usuario: usuarioPublico(u),
        empresa: empresaPublica(escolhida),
      });
    }
  }

  // Arquivos no disco (sem Blob, desenvolvimento local)
  app.use('/arquivos', express.static(STORAGE_DIR, { maxAge: '30d' }));

  // Rotas públicas dos módulos (ex.: rotinas agendadas)
  for (const criar of ROTAS_PUBLICAS) app.use('/api', criar());

  // ==========================================================
  // Daqui para baixo, toda rota /api exige um token válido.
  // Usuário e empresa são relidos a cada requisição: desativado ou sem a empresa perde o acesso na hora.
  // ==========================================================
  app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
    const sessao = lerToken(String(req.header('authorization') || '').replace(/^Bearer\s+/i, ''));
    if (!sessao) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
    res.locals.ip = ipDe(req);
    let servidor: Servidor | null;
    try {
      servidor = await buscarServidor(sessao.servidor);
    } catch (err: any) {
      return res.status(503).json({ valida: null, error: `Banco administrativo indisponível: ${err.message}` });
    }
    if (!servidor) return res.status(401).json({ valida: false, error: 'Servidor não encontrado. Entre novamente.' });
    res.locals.servidor = servidor;
    noServidor(servidor, () => autenticar(req, res, next, sessao));
  });

  /** Confere usuário/cliente e empresa no banco do servidor (já dentro de noServidor) */
  async function autenticar(req: Request, res: Response, next: NextFunction, sessao: NonNullable<ReturnType<typeof lerToken>>) {
    try {
      if (sessao.tipo === 'c') {
        // Cliente só acessa as rotas da Área do Cliente
        if (!req.path.startsWith('/cliente/')) return res.status(403).json({ error: 'Acesso restrito à Área do Cliente.' });
        const [rows] = await pool.query<any[]>("SELECT id, id_grupo, nome, fantasia, cpf_cnpj FROM pessoas WHERE id = ? AND COALESCE(ativo, 'S') <> 'N'", [sessao.id]);
        if (!rows.length) return res.status(401).json({ valida: false, error: 'Cadastro do cliente não encontrado ou inativo.' });
        res.locals.cliente = rows[0];
        res.locals.grupoId = Number(rows[0].id_grupo);
        return next();
      }
      const [rows] = await pool.query<any[]>(`${SQL_USUARIO} AND A.id = ? LIMIT 1`, [sessao.id]);
      if (!rows.length) return res.status(401).json({ valida: false, error: 'Seu usuário foi desativado. Fale com o administrador.' });
      const [empresas] = await pool.query<any[]>(`${SQL_EMPRESAS_DO_USUARIO.replace('ORDER BY B.id', '')} AND B.id = ?`, [sessao.id, rows[0].id_grupo, sessao.empresaId]);
      if (!empresas.length) return res.status(401).json({ valida: false, error: 'Você não tem mais acesso a esta empresa. Entre novamente.' });
      res.locals.usuarioId = sessao.id;
      res.locals.usuario = rows[0];
      res.locals.empresa = empresas[0];
      // O grupo ativo é o da empresa (como no Delphi)
      res.locals.grupoId = Number(empresas[0].id_grupo);
      res.locals.empresaId = Number(empresas[0].id);
      next();
    } catch (err: any) {
      // Falha de banco não derruba a sessão: o painel já mostra o banco como indisponível
      res.status(503).json({ valida: null, error: err.message });
    }
  }

  app.get('/api/db/status', async (_req: Request, res: Response) => {
    res.json(await checkDbHealth());
  });

  /** Revalidação da sessão guardada no navegador (a checagem em si é o middleware acima) */
  app.get('/api/sessao', (_req: Request, res: Response) => {
    res.json({ valida: true, servidor: servidorPublico(res.locals.servidor), usuario: usuarioPublico(res.locals.usuario), empresa: empresaPublica(res.locals.empresa) });
  });
  app.get('/api/cliente/sessao', (_req: Request, res: Response) => {
    res.json({ valida: true });
  });

  /** Meus Dados: e-mail de acesso, página inicial e (opcional) nova senha */
  app.post('/api/meus-dados', async (req: Request, res: Response) => {
    try {
      const { email, paginaWeb, senha, redigite } = req.body || {};
      const novoEmail = String(email ?? '').trim();
      if (!novoEmail) return res.status(400).json({ error: 'Informe o e-mail de acesso.' });
      if (senha && senha !== redigite) return res.status(400).json({ error: 'Senha não conferem!' });
      if (senha && String(senha).length > 15) return res.status(400).json({ error: 'A senha tem no máximo 15 caracteres.' });
      const sets = ['email = ?', 'pagina_web = ?'];
      const valores: any[] = [novoEmail.slice(0, 50), String(paginaWeb ?? '').trim().slice(0, 80) || null];
      if (senha) {
        sets.push('senha = ?');
        valores.push(String(senha));
      }
      await pool.query(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`, [...valores, res.locals.usuarioId]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Preferências das listas (larguras e ordem das colunas), por usuário: usuarios.config_listas
  // (database/migrations/001_config_listas.sql). Sem a coluna, as listas usam o padrão.
  app.get('/api/config-listas', async (_req: Request, res: Response) => {
    try {
      const [rows] = await pool.query<any[]>('SELECT config_listas FROM usuarios WHERE id = ?', [res.locals.usuarioId]);
      res.json(JSON.parse(rows[0]?.config_listas || '{}') || {});
    } catch {
      res.json({});
    }
  });

  app.put('/api/config-listas', async (req: Request, res: Response) => {
    const corpo = req.body;
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return res.status(400).json({ error: 'Configuração inválida.' });
    const texto = JSON.stringify(corpo);
    if (texto.length > 60000) return res.status(413).json({ error: 'Configuração muito grande.' });
    try {
      await pool.query('UPDATE usuarios SET config_listas = ? WHERE id = ?', [texto, res.locals.usuarioId]);
      res.json({ success: true });
    } catch (err: any) {
      if (err.code === 'ER_BAD_FIELD_ERROR') return res.status(503).json({ error: 'Rode database/migrations/001_config_listas.sql para gravar as preferências das listas.' });
      res.status(503).json({ error: err.message });
    }
  });

  // Rotas da Área do Cliente (token de cliente) e dos módulos internos
  for (const criar of ROTAS_CLIENTE) app.use('/api/cliente', criar());
  app.use('/api', createArmazenamentoRouter());
  for (const criar of ROTAS_MODULOS) app.use('/api', criar());
  app.use('/api', createCrudRouter());

  return app;
}

