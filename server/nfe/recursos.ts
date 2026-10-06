/**
 * Pasta server/nfe/recursos: ACBrNFeServicos.ini (URLs da SEFAZ), Schemas (XSD) e cadeias (raízes ICP-Brasil).
 * Trazida do nfeWeb. Rodando com tsx o módulo sabe onde está; no bundle (build/server.cjs) não há
 * import.meta, então vale o diretório de trabalho.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let cache: string | null = null;

export function pastaRecursos(): string | null {
  if (cache) return cache;
  const lista = [path.join(process.cwd(), 'server', 'nfe', 'recursos')];
  try {
    lista.unshift(path.join(path.dirname(fileURLToPath(import.meta.url)), 'recursos'));
  } catch {
    // bundle CommonJS
  }
  cache = lista.find((c) => fs.existsSync(c)) ?? null;
  return cache;
}

/** Caminho de um arquivo dentro de recursos, ou null quando não existe */
export function arquivoRecurso(...partes: string[]): string | null {
  const base = pastaRecursos();
  if (!base) return null;
  const completo = path.join(base, ...partes);
  return fs.existsSync(completo) ? completo : null;
}
