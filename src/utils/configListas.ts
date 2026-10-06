import { fetchConfigListas, saveConfigListas } from '../services/api';

/** Preferências de cada lista, gravadas em usuarios.config_listas como JSON */
export interface TamanhoCampo {
  span?: number;
  altura?: number;
}

export type Grade = 'ambas' | 'horizontais' | 'verticais' | 'nenhuma';

/** Como as larguras são definidas: recalculadas na abertura ou fixadas pelo usuário */
export type ModoLargura = 'manual' | 'ajustar' | 'melhor';

export interface ConfigLista {
  larguras?: Record<string, number>;
  ordem?: string[];
  grade?: Grade;
  /** false depois de 'Ajustar largura': as colunas ocupam tudo, sem a coluna vazia do fim */
  sobra?: boolean;
  modo?: ModoLargura;
  /** Campos exibidos como coluna na lista, escolhidos no formulário de edição */
  visiveis?: string[];
  /** Campos que existiam quando a configuração foi salva: coluna nova (listed) aparece mesmo com "visiveis" salvo */
  conhecidas?: string[];
  /** Campos oferecidos na busca avançada, escolhidos no formulário de edição */
  busca?: string[];
  /** Ordem dos campos no formulário de edição, arrastados pelo usuário */
  ordemForm?: string[];
  /** Tamanho de cada campo no formulário: colunas ocupadas (1-12) e altura do controle em px */
  tamanhosForm?: Record<string, TamanhoCampo>;
}

let cache: Record<string, ConfigLista> | null = null;
let carregando: Promise<Record<string, ConfigLista>> | null = null;
let gravacao: ReturnType<typeof setTimeout> | null = null;

export async function lerConfigLista(recurso: string): Promise<ConfigLista> {
  if (!cache) {
    carregando =
      carregando ||
      fetchConfigListas()
        .then((c) => (cache = (c as Record<string, ConfigLista>) || {}))
        .catch(() => (cache = {}));
    await carregando;
  }
  return cache?.[recurso] || {};
}

/** Quem espera o resultado da próxima gravação (agrupadas pelo respiro) */
let aguardando: { ok: () => void; falhou: (e: Error) => void }[] = [];

/**
 * Guarda a preferência e grava o JSON inteiro depois de um respiro, para não gravar a cada pixel.
 * A promessa diz se a gravação deu certo (ex.: banco sem a coluna usuarios.config_listas).
 */
export function salvarConfigLista(recurso: string, config: ConfigLista): Promise<void> {
  cache = { ...(cache || {}), [recurso]: config };
  if (gravacao) clearTimeout(gravacao);
  const promessa = new Promise<void>((ok, falhou) => aguardando.push({ ok, falhou }));
  gravacao = setTimeout(() => {
    const quem = aguardando;
    aguardando = [];
    saveConfigListas(cache || {}).then(
      () => quem.forEach((q) => q.ok()),
      (e) => quem.forEach((q) => q.falhou(e)),
    );
  }, 800);
  return promessa;
}

export function limparConfigListas() {
  cache = null;
  carregando = null;
}
