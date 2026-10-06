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

/** Guarda a preferência e grava o JSON inteiro depois de um respiro, para não gravar a cada pixel */
export function salvarConfigLista(recurso: string, config: ConfigLista) {
  cache = { ...(cache || {}), [recurso]: config };
  if (gravacao) clearTimeout(gravacao);
  gravacao = setTimeout(() => saveConfigListas(cache || {}).catch(() => {}), 800);
}

export function limparConfigListas() {
  cache = null;
  carregando = null;
}
