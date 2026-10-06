import type { Contexto } from './db.js';

/**
 * Regras de negócio do CRUD genérico, registradas por cada módulo (server/<módulo>.ts) com registrarRegras.
 * Equivalem aos eventos BeforePost/BeforeDelete/AfterInsert das telas Delphi.
 */
export interface Regras {
  /** `payload` já validado e convertido; pode ser ajustado. `id` null = inclusão. Lança erro com mensagem ao usuário */
  antesDeGravar?: (payload: Record<string, any>, id: string | null, ctx: Contexto) => Promise<void> | void;
  /** Devolve arquivos do armazenamento a apagar depois que a exclusão der certo */
  antesDeExcluir?: (id: string, ctx: Contexto) => Promise<string[] | void> | string[] | void;
  aposIncluir?: (id: string, ctx: Contexto) => Promise<void> | void;
}

const REGRAS: Record<string, Regras[]> = {};

export function registrarRegras(recurso: string, regras: Regras) {
  (REGRAS[recurso] ??= []).push(regras);
}

/** Erro com status HTTP (409 = regra de negócio) */
export const recusar = (mensagem: string, status = 409) => Object.assign(new Error(mensagem), { status });

export async function antesDeGravar(recurso: string, payload: Record<string, any>, id: string | null, ctx: Contexto) {
  for (const r of REGRAS[recurso] ?? []) await r.antesDeGravar?.(payload, id, ctx);
}

export async function antesDeExcluir(recurso: string, id: string, ctx: Contexto): Promise<string[]> {
  const arquivos: string[] = [];
  for (const r of REGRAS[recurso] ?? []) arquivos.push(...((await r.antesDeExcluir?.(id, ctx)) || []));
  return arquivos;
}

export async function aposIncluir(recurso: string, id: string, ctx: Contexto) {
  for (const r of REGRAS[recurso] ?? []) await r.aposIncluir?.(id, ctx);
}
