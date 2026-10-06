import 'dotenv/config';
import { AsyncLocalStorage } from 'async_hooks';
import mysql from 'mysql2/promise';

// Credenciais só pelo ambiente (.env): nunca no código, que vai para o GitHub
for (const nome of ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD']) {
  if (!process.env[nome]) throw new Error(`${nome} não definido no .env.`);
}

/**
 * Bancos (como no bi): no login o usuário digita o número do Servidor; as credenciais do banco de trabalho
 * vêm de printcontrol_admin.servidores (no servidor MySQL do .env). Cada requisição usa o banco do servidor
 * gravado no token: o `pool` exportado é um atalho para o pool desse servidor (AsyncLocalStorage), assim os
 * módulos continuam usando `pool.query` sem saber de servidores.
 */
const BASE: mysql.PoolOptions = {
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 20000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  dateStrings: true,
};

const ADMIN_DATABASE = process.env.MYSQL_ADMIN_DATABASE || 'printcontrol_admin';

function criarPool(config: mysql.PoolOptions): mysql.Pool {
  const p = mysql.createPool({ ...BASE, ...config });
  // O sistema opera no horário de Brasília: NOW(), CURDATE() e os DEFAULT CURRENT_TIMESTAMP
  // passam a sair em UTC-3, qualquer que seja o fuso do servidor MySQL.
  p.pool.on('connection', (conn: any) => {
    conn.query("SET time_zone = '-03:00'");
  });
  return p;
}

/** Banco administrativo (lista de servidores) */
export const poolAdmin = criarPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: ADMIN_DATABASE,
});

export interface Servidor {
  id: number;
  descricao: string;
  host: string;
  port: number;
  database: string;
  pool: mysql.Pool;
}

/** Pools por servidor; a chave inclui as credenciais, para uma troca de senha não reaproveitar o pool antigo */
const POOLS = new Map<string, mysql.Pool>();
/** Cadastro do servidor relido a cada 5 minutos (troca de banco/senha vale sem reiniciar) */
const CACHE = new Map<string, { servidor: Servidor | null; ate: number }>();

/** Servidor pelo número (id) ou pelo token de servidores; null se não existir */
export async function buscarServidor(chave: string | number): Promise<Servidor | null> {
  const texto = String(chave ?? '').trim();
  if (!texto) return null;
  const guardado = CACHE.get(texto);
  if (guardado && guardado.ate > Date.now()) return guardado.servidor;

  const [rows] = await poolAdmin.query<any[]>(
    /^\d+$/.test(texto)
      ? 'SELECT id, descricao, mysql_host, mysql_port, mysql_user, mysql_password, mysql_database FROM servidores WHERE id = ?'
      : 'SELECT id, descricao, mysql_host, mysql_port, mysql_user, mysql_password, mysql_database FROM servidores WHERE token = ?',
    [/^\d+$/.test(texto) ? Number(texto) : texto],
  );
  const s = rows[0];
  let servidor: Servidor | null = null;
  if (s?.mysql_host && s.mysql_database) {
    const config = { host: s.mysql_host, port: Number(s.mysql_port) || 3306, user: s.mysql_user, password: s.mysql_password, database: s.mysql_database };
    const chavePool = JSON.stringify(config);
    let p = POOLS.get(chavePool);
    if (!p) POOLS.set(chavePool, (p = criarPool(config)));
    servidor = { id: Number(s.id), descricao: s.descricao || '', host: config.host, port: config.port, database: config.database, pool: p };
  }
  CACHE.set(texto, { servidor, ate: Date.now() + 5 * 60 * 1000 });
  return servidor;
}

const contextoServidor = new AsyncLocalStorage<Servidor>();

/** Executa `fn` (e tudo o que ela disparar, inclusive o restante da requisição) no banco do servidor */
export const noServidor = <T>(servidor: Servidor, fn: () => T): T => contextoServidor.run(servidor, fn);

export function servidorAtual(): Servidor {
  const s = contextoServidor.getStore();
  if (!s) throw new Error('Nenhum servidor selecionado para esta operação (faça login informando o Servidor).');
  return s;
}

/** Pool do banco de trabalho da requisição atual */
export const pool: mysql.Pool = new Proxy({} as mysql.Pool, {
  get(_alvo, prop) {
    const real = servidorAtual().pool as any;
    const valor = real[prop];
    return typeof valor === 'function' ? valor.bind(real) : valor;
  },
});

export const DB_TABLES = ['usuarios', 'empresas_filiais', 'pessoas', 'equipamentos', 'locacao_contratos', 'locacao_leituras', 'fatur', 'fatur_notas', 'os'];

/** Quem está gravando: alimenta as variáveis @ usadas pelas triggers herdadas do Delphi (bi_log, bi_fatur) */
export interface Contexto {
  usuarioId: number | null;
  grupoId: number | null;
  empresaId: number | null;
  ip?: string | null;
}

/**
 * Conexão em transação com @id_usuario, @id_grupo, @id_empresa e @ip_usuario definidos, como o Delphi fazia
 * no login. Use em toda gravação: as triggers de log e de fatur leem essas variáveis.
 */
export async function comUsuario<T>(ctx: Contexto | null, fn: (conn: mysql.PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET @id_usuario = ?, @id_grupo = ?, @id_empresa = ?, @ip_usuario = ?', [
      ctx?.usuarioId ?? null,
      ctx?.grupoId ?? null,
      ctx?.empresaId ?? null,
      ctx?.ip ?? null,
    ]);
    await conn.beginTransaction();
    const r = await fn(conn);
    await conn.commit();
    return r;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    await conn.query('SET @id_usuario = NULL, @id_grupo = NULL, @id_empresa = NULL, @ip_usuario = NULL').catch(() => {});
    conn.release();
  }
}

/** Linha na tabela log (a trigger bi_log completa usuário, grupo, empresa e IP). Falha no log não interrompe nada */
export async function gravarLog(ctx: Contexto, mensagem: string, tabela?: { nome: string; id?: number | string; campo?: string; op?: 'I' | 'A' | 'E' }) {
  await comUsuario(ctx, (c) =>
    c.query('INSERT INTO log (datahora, mensagem, tabela, tabela_id, tabela_campo, tabela_op) VALUES (NOW(), ?, ?, ?, ?, ?)', [
      String(mensagem).slice(0, 255),
      tabela?.nome ?? null,
      tabela?.id ?? null,
      tabela?.campo ?? null,
      tabela?.op ?? null,
    ]),
  ).catch((e) => console.error(`Log: ${e.message}`));
}

export async function checkDbHealth() {
  const startTime = Date.now();
  try {
    const conn = await pool.getConnection();
    const [verResult] = await conn.query<any[]>('SELECT VERSION() as version, DATABASE() as db');
    const latency = Date.now() - startTime;

    const counts: Record<string, number> = {};
    for (const t of DB_TABLES) {
      try {
        const [res] = await conn.query<any[]>(`SELECT COUNT(*) as cnt FROM ${t}`);
        counts[t] = res[0]?.cnt ?? 0;
      } catch {
        counts[t] = 0;
      }
    }

    conn.release();

    return {
      connected: true,
      latencyMs: latency,
      version: verResult[0]?.version || 'MySQL 8.0',
      database: verResult[0]?.db || servidorAtual().database,
      host: servidorAtual().host,
      port: servidorAtual().port,
      servidor: servidorAtual().id,
      tableCounts: counts,
    };
  } catch (err: any) {
    return {
      connected: false,
      latencyMs: Date.now() - startTime,
      error: err.message || 'Falha de conexão com MySQL',
      code: err.code || 'UNKNOWN',

      tableCounts: {},
    };
  }
}
