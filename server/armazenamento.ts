import express, { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { del, head, put } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

/**
 * Arquivos do app (imagens, documentos, certificados).
 *
 * Com BLOB_READ_WRITE_TOKEN (Vercel › Storage › Blob "printcontrol", ligado ao projeto): Vercel Blob, como no
 * crmweb. Arquivos públicos; o endereço guardado no banco é a URL do Blob. Arquivos grandes (.dae e anexos) vão
 * direto do navegador para o Blob (client upload, sem o limite de 4,5 MB da Vercel): o servidor só libera o envio.
 *
 * Sem o token (desenvolvimento local): disco em STORAGE_DIR, servido em /arquivos.
 * Na Vercel o token é obrigatório (o disco lá é só de leitura).
 */
export const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || './storage');
export const usaBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const URL_BLOB = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/([^\s"'<>?]+)/i;
/** Tamanhos máximos por pasta (o envio direto confere antes de liberar) */
const LIMITE: Record<string, number> = { imagens: 5 * 1024 * 1024, documentos: 20 * 1024 * 1024 };

const falha = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

function exigirConfigurado() {
  if (!usaBlob() && process.env.VERCEL) {
    throw falha('Armazenamento não configurado: crie o Blob "printcontrol" em Vercel › Storage e ligue ao projeto (BLOB_READ_WRITE_TOKEN).', 503);
  }
}

/** Caminho no disco a partir do caminho relativo, sem sair da pasta do storage */
function noDisco(caminho: string): string {
  const p = path.resolve(STORAGE_DIR, caminho.replace(/^\/?(arquivos\/)?/, ''));
  if (!p.startsWith(STORAGE_DIR + path.sep)) throw falha('Caminho de arquivo inválido.');
  return p;
}

/** Nome seguro para caminho: sem acento, sem espaço, no máximo 120 caracteres */
export const nomeSeguro = (nome: string) =>
  nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-120) || 'arquivo';

/**
 * Grava um arquivo gerado no servidor e devolve o endereço (URL do Blob ou /arquivos/...).
 * `aleatorio`: sufixo aleatório no nome; sem ele, sobrescreve o que existir no mesmo caminho.
 */
export async function gravar(caminho: string, dados: Buffer | string, tipo: string, aleatorio = false): Promise<string> {
  exigirConfigurado();
  if (usaBlob()) {
    const b = await put(caminho, dados, { access: 'public', contentType: tipo, addRandomSuffix: aleatorio, allowOverwrite: !aleatorio });
    return b.url;
  }
  const final = aleatorio ? caminho.replace(/(\.[^./]+)?$/, `-${crypto.randomUUID().slice(0, 8)}$1`) : caminho;
  const destino = noDisco(final);
  await fs.promises.mkdir(path.dirname(destino), { recursive: true });
  await fs.promises.writeFile(destino, dados);
  return `/arquivos/${final}`;
}

/**
 * Lê um arquivo pelo endereço gravado: URL do Blob, /arquivos/..., /imagens/... (versões anteriores)
 * ou um caminho relativo (no Blob, procurado pelo nome; no disco, dentro do storage).
 */
export async function ler(ref: string): Promise<Buffer> {
  if (/^https:\/\//i.test(ref)) {
    if (!URL_BLOB.test(ref)) throw falha('Endereço de arquivo fora do armazenamento.');
    const r = await fetch(ref);
    if (!r.ok) throw falha(`Não foi possível ler o arquivo do armazenamento (HTTP ${r.status}).`, 502);
    return Buffer.from(await r.arrayBuffer());
  }
  if (ref.startsWith('/imagens/')) return fs.promises.readFile(noDisco(`imagens/${path.basename(ref)}`));
  if (!ref.startsWith('/') && usaBlob()) return ler(await urlDe(ref));
  return fs.promises.readFile(noDisco(ref));
}

/** Endereço público de um caminho gravado sem sufixo aleatório (ex.: a malha de uma importação) */
export async function urlDe(caminho: string): Promise<string> {
  if (usaBlob()) {
    try {
      return (await head(caminho)).url;
    } catch {
      throw falha('Arquivo não encontrado no armazenamento.', 404);
    }
  }
  if (!fs.existsSync(noDisco(caminho))) throw falha('Arquivo não encontrado no armazenamento.', 404);
  return `/arquivos/${caminho}`;
}

/** Apaga o arquivo (falha não interrompe quem chamou: fica só o arquivo órfão) */
export async function apagar(ref: string | null | undefined) {
  if (!ref) return;
  try {
    if (/^https:\/\//i.test(ref)) {
      if (URL_BLOB.test(ref)) await del(ref);
    } else if (usaBlob() && !ref.startsWith('/')) {
      await del((await head(ref)).url);
    } else {
      await fs.promises.unlink(noDisco(ref.startsWith('/imagens/') ? `imagens/${path.basename(ref)}` : ref));
    }
  } catch (err: any) {
    console.error(`Armazenamento: não apagou ${ref}: ${err.message}`);
  }
}

/** Endereço aceito no banco para um arquivo deste armazenamento */
export const enderecoValido = (ref: string) => URL_BLOB.test(ref) || /^\/(arquivos|imagens)\/[\w./-]+$/.test(ref);

/** Confere se o caminho de envio é de uma pasta permitida */
async function conferirCaminho(caminho: string) {
  const [pasta] = caminho.split('/');
  if (!(pasta in LIMITE) || caminho.includes('..')) throw falha('Caminho de envio inválido.');
  return LIMITE[pasta];
}

export function createArmazenamentoRouter() {
  const router = Router();

  /** O navegador pergunta como enviar: direto para o Blob ou para este servidor */
  router.get('/armazenamento', (_req: Request, res: Response) => {
    res.json({ blob: usaBlob(), configurado: usaBlob() || !process.env.VERCEL });
  });

  /** Libera o envio direto do navegador para o Blob (client upload), por pasta e com tamanho máximo */
  router.post('/arquivos/upload', async (req: Request, res: Response) => {
    try {
      exigirConfigurado();
      if (!usaBlob()) throw falha('Sem Blob configurado: o envio é pelo servidor.');
      const r = await handleUpload({
        request: req,
        body: req.body as HandleUploadBody,
        onBeforeGenerateToken: async (pathname) => ({ maximumSizeInBytes: await conferirCaminho(pathname), addRandomSuffix: true }),
      });
      res.json(r);
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  /** Sem Blob (local): o arquivo vem no corpo e fica no disco; devolve o endereço */
  router.post('/arquivos', express.raw({ type: 'application/octet-stream', limit: '200mb' }), async (req: Request, res: Response) => {
    try {
      const caminho = String(req.query.caminho ?? '');
      const limite = await conferirCaminho(caminho);
      const arquivo = req.body as Buffer;
      if (!Buffer.isBuffer(arquivo) || !arquivo.length) throw falha('Envie o arquivo.');
      if (arquivo.length > limite) throw falha('Arquivo grande demais.');
      res.json({ url: await gravar(caminho, arquivo, String(req.query.tipo || 'application/octet-stream'), true) });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  return router;
}
