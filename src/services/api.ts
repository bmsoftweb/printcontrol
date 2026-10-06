import { ResourceDef, ListaPaginada, FiltroAvancado, RegistroCrud, OpcaoRef, DbConnectionStatus, Usuario, Id, EmpresaSessao, ClienteSessao, ServidorSessao } from '../types';

/** O token da sessão acompanha toda requisição no header Authorization */
let tokenAtual: string | null = null;
let aoExpirar: ((msg: string) => void) | null = null;

export function setTokenSessao(token: string | null) {
  tokenAtual = token;
}

/** Chamado quando o servidor recusa o token (sessão expirada ou usuário desativado) */
export function setAoExpirarSessao(fn: ((msg: string) => void) | null) {
  aoExpirar = fn;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  if (tokenAtual) h.Authorization = `Bearer ${tokenAtual}`;
  return h;
}

async function parseOrThrow(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || `Falha na requisição (HTTP ${res.status}).`;
    if (res.status === 401 && aoExpirar) aoExpirar(msg);
    throw new Error(msg);
  }
  return data;
}

const get = (url: string) => fetch(url, { headers: headers() }).then(parseOrThrow);
const enviar = (method: string, url: string, corpo?: unknown) =>
  fetch(url, {
    method,
    headers: headers({ 'Content-Type': 'application/json' }),
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  }).then(parseOrThrow);

// ------------------------------------------------------------
// Autenticação e preferências
// ------------------------------------------------------------
/** Login: escolherEmpresa = usuário liberado para mais de uma empresa (repetir com empresaId); cliente = Área do Cliente */
export async function login(payload: { servidor: string; usuario: string; senha: string; empresaId?: number | null }): Promise<{
  token?: string;
  servidor?: ServidorSessao;
  usuario?: Usuario;
  empresa?: EmpresaSessao;
  cliente?: ClienteSessao;
  escolherEmpresa?: EmpresaSessao[];
}> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Falha no login (HTTP ${res.status}).`);
  return data;
}

/**
 * Confere se a sessão guardada no navegador ainda vale.
 * Retorna false só quando o servidor recusa; falha de rede ou de banco devolve null,
 * para não deslogar ninguém por instabilidade.
 */
export async function validarSessao(cliente = false): Promise<{ valida: boolean | null; error?: string }> {
  try {
    const res = await fetch(cliente ? '/api/cliente/sessao' : '/api/sessao', { headers: headers() });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) return { valida: false, error: data?.error };
    return { valida: res.ok ? true : null, error: data?.error };
  } catch {
    return { valida: null };
  }
}

/** Meus Dados: e-mail de acesso, página inicial e nova senha (opcional) */
export const salvarMeusDados = (d: { email: string; paginaWeb: string; senha: string; redigite: string }) => enviar('POST', '/api/meus-dados', d);

/** Requisições genéricas para as telas dos módulos (já com o token da sessão; 401 volta ao login) */
export const api = {
  get: <T = any>(url: string): Promise<T> => get(url),
  post: <T = any>(url: string, corpo?: unknown): Promise<T> => enviar('POST', url, corpo),
  put: <T = any>(url: string, corpo?: unknown): Promise<T> => enviar('PUT', url, corpo),
  delete: <T = any>(url: string): Promise<T> => enviar('DELETE', url),
  /** Envia um arquivo cru (application/octet-stream) */
  arquivo: async <T = any>(url: string, arquivo: Blob): Promise<T> =>
    parseOrThrow(await fetch(url, { method: 'POST', headers: headers({ 'Content-Type': 'application/octet-stream' }), body: arquivo })),
};

export const fetchConfigListas = (): Promise<Record<string, unknown>> => get('/api/config-listas');

export async function saveConfigListas(config: Record<string, unknown>): Promise<void> {
  await enviar('PUT', '/api/config-listas', config);
}

// ------------------------------------------------------------
// Metadados e painel
// ------------------------------------------------------------
export const fetchResources = (): Promise<ResourceDef[]> => get('/api/meta/resources');

export async function fetchDbStatus(): Promise<DbConnectionStatus> {
  try {
    // O banco depende do servidor da sessão: a rota exige o token
    const res = await fetch('/api/db/status', { headers: headers() });
    return await res.json();
  } catch (err: any) {
    return { connected: false, latencyMs: 0, error: err.message || 'Falha ao conectar com a API' };
  }
}


// ------------------------------------------------------------
// CRUD genérico
// ------------------------------------------------------------
export function listRecords(
  resource: string,
  params: {
    page?: number;
    limit?: number;
    search?: string;
    sort?: string;
    dir?: 'asc' | 'desc';
    filterField?: string;
    filterValue?: string;
    filters?: FiltroAvancado[];
    /** Recurso em árvore: só as raízes */
    arvore?: 'raizes';
    /** Só as do usuário logado (recurso com filtro "minhas") */
    minhas?: boolean;
  } = {},
): Promise<ListaPaginada> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.search) qs.set('search', params.search);
  if (params.sort) qs.set('sort', params.sort);
  if (params.dir) qs.set('dir', params.dir);
  if (params.filterField && params.filterValue) {
    qs.set('filter_field', params.filterField);
    qs.set('filter_value', params.filterValue);
  }
  if (params.filters && params.filters.length) qs.set('filters', JSON.stringify(params.filters));
  if (params.arvore) qs.set('arvore', params.arvore);
  if (params.minhas) qs.set('minhas', '1');
  return get(`/api/crud/${resource}?${qs.toString()}`);
}

export const getRecord = (resource: string, id: Id): Promise<RegistroCrud> =>
  get(`/api/crud/${resource}/${encodeURIComponent(String(id))}`);

export const createRecord = (resource: string, payload: RegistroCrud): Promise<{ success: boolean; id: string }> =>
  enviar('POST', `/api/crud/${resource}`, payload);

export const updateRecord = (resource: string, id: Id, payload: RegistroCrud): Promise<{ success: boolean }> =>
  enviar('PUT', `/api/crud/${resource}/${encodeURIComponent(String(id))}`, payload);

export const deleteRecord = (resource: string, id: Id): Promise<{ success: boolean }> =>
  enviar('DELETE', `/api/crud/${resource}/${encodeURIComponent(String(id))}`);

// ------------------------------------------------------------
// Combos de chave estrangeira, com cache em memória
// ------------------------------------------------------------
const optionsCache = new Map<string, OpcaoRef[]>();

export async function fetchOptions(resource: string, labelField: string, filtro?: { campo: string; valor: string }): Promise<OpcaoRef[]> {
  const key = `${resource}:${labelField}:${filtro ? `${filtro.campo}=${filtro.valor}` : ''}`;
  const cached = optionsCache.get(key);
  if (cached) return cached;
  const qs = new URLSearchParams({ label_field: labelField });
  if (filtro) {
    qs.set('filtro_campo', filtro.campo);
    qs.set('filtro_valor', filtro.valor);
  }
  const data = await get(`/api/options/${resource}?${qs}`);
  optionsCache.set(key, data);
  return data;
}

/** Invalida o cache de combos após gravações que alteram listas de referência */
export function invalidateOptions(resource?: string) {
  if (!resource) {
    optionsCache.clear();
    return;
  }
  for (const key of Array.from(optionsCache.keys())) {
    if (key.startsWith(`${resource}:`)) optionsCache.delete(key);
  }
}

// ------------------------------------------------------------

// ------------------------------------------------------------
// Arquivos
// ------------------------------------------------------------
/** Baixa um arquivo de rota autenticada (PDF, CSV) com o nome que o servidor mandar */
export async function baixarArquivo(url: string, nomePadrao: string) {
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) return parseOrThrow(res);
  const nome = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? nomePadrao;
  const link = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = link;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(link), 10_000);
}
// ------------------------------------------------------------
// Armazenamento de arquivos (Vercel Blob ou disco do servidor)
// ------------------------------------------------------------
/** Nome seguro para o caminho do arquivo (mesma regra do servidor) */
export const nomeSeguro = (nome: string) => nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_').slice(-120) || 'arquivo';

let modoArmazenamento: Promise<{ blob: boolean; configurado: boolean }> | null = null;

/**
 * Envia um arquivo do navegador para o armazenamento e devolve o endereço. Com Vercel Blob, vai direto
 * para o Blob (o servidor só libera o envio, como no crmweb); sem ele, vai para o servidor.
 */
export async function enviarArquivo(caminho: string, arquivo: File): Promise<string> {
  modoArmazenamento ??= get('/api/armazenamento').catch((e) => {
    modoArmazenamento = null;
    throw e;
  });
  const modo = await modoArmazenamento!;
  if (!modo.configurado) throw new Error('Armazenamento de arquivos não configurado no servidor (Vercel Blob).');
  if (modo.blob) {
    const { upload } = await import('@vercel/blob/client');
    const blob = await upload(caminho, arquivo, {
      access: 'public',
      handleUploadUrl: '/api/arquivos/upload',
      headers: headers(),
      multipart: arquivo.size > 5 * 1024 * 1024,
    });
    return blob.url;
  }
  const qs = new URLSearchParams({ caminho, tipo: arquivo.type || 'application/octet-stream' });
  const res = await fetch(`/api/arquivos?${qs}`, { method: 'POST', headers: headers({ 'Content-Type': 'application/octet-stream' }), body: arquivo });
  return (await parseOrThrow(res)).url;
}
