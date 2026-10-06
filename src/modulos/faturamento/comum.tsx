import React, { useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { GradeLista, type ColunaLista } from '../../components/GradeLista';
import { lerSessao } from '../../utils/session';
import { formatDateBR, formatDateTimeBR } from '../../utils/formatters';

/** Linha genérica vinda das rotas do módulo */
export type Reg = Record<string, any>;

export const moeda = (v: unknown) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const inteiro = (v: unknown) => (v === null || v === undefined || v === '' ? '' : (Number(v) || 0).toLocaleString('pt-BR'));
export const data = (v: unknown) => (v ? formatDateBR(String(v)) : '');
export const dataHora = (v: unknown) => (v ? formatDateTimeBR(String(v)) : '');

/** Botão da barra das telas (mesma altura dos campos: 38px) */
export const BOTAO_BARRA =
  'inline-flex items-center justify-center gap-1.5 h-[38px] px-3 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap';

export const BotaoBarra: React.FC<{ icone: React.ElementType; texto: string; onClick: () => void; carregando?: boolean; disabled?: boolean; titulo?: string; ativo?: boolean }> = ({
  icone: Icone,
  texto,
  onClick,
  carregando,
  disabled,
  titulo,
  ativo,
}) => (
  <button type="button" className={`${BOTAO_BARRA} ${ativo ? '!bg-blue-50 !border-blue-400 !text-blue-700 dark:!bg-blue-950/50 dark:!text-blue-300' : ''}`} onClick={onClick} disabled={disabled || carregando} title={titulo}>
    {carregando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icone className="w-3.5 h-3.5" />}
    {texto}
  </button>
);

/** Selo colorido (status, e-mail enviado, remessa) */
export const Selo: React.FC<{ cor: string; texto: string; escuro?: boolean }> = ({ cor, texto, escuro }) => (
  <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-wide whitespace-nowrap" style={{ background: cor, color: escuro ? '#333' : '#fff' }}>
    {texto}
  </span>
);

/** Dias de atraso de um vencimento (aaaa-mm-dd) em relação a hoje no horário de Brasília; 0 se em dia */
export function diasAtraso(vencimento: unknown): number {
  const v = String(vencimento ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 0;
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  return Math.max(0, Math.round((Date.parse(hoje) - Date.parse(v)) / 86_400_000));
}

/** Status da nota: âmbar a receber, vermelho vencida, verde recebida, cinza cancelada */
export const SeloStatusNota: React.FC<{ status: string; atraso?: number; vencimento?: unknown }> = ({ status, atraso, vencimento }) => {
  if (status === 'R') return <Selo cor="#2E8B57" texto="RECEBIDO" />;
  if (status === 'C') return <Selo cor="#9CA3AF" texto="CANCELADO" />;
  const dias = atraso ?? diasAtraso(vencimento);
  return dias > 0 ? <Selo cor="#DC2626" texto={`VENCIDA ${dias}d`} /> : <Selo cor="#F59E0B" texto="A RECEBER" escuro />;
};

const token = () => lerSessao()?.token ?? '';

async function falhou(r: Response): Promise<never> {
  const j = await r.json().catch(() => ({}));
  throw new Error(j?.error || `Falha na requisição (HTTP ${r.status}).`);
}

/** Abre um PDF de rota autenticada numa nova aba (a aba abre antes, para o navegador não bloquear) */
export async function abrirPdf(url: string) {
  const aba = window.open('', '_blank');
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
    if (!r.ok) await falhou(r);
    const link = URL.createObjectURL(await r.blob());
    if (aba) aba.location.href = link;
    else window.location.assign(link);
  } catch (e) {
    aba?.close();
    throw e;
  }
}

/** POST que devolve um arquivo para download (remessa); devolve os cabeçalhos para ler contagens */
export async function baixarPost(url: string, corpo: unknown, nomePadrao: string): Promise<Headers> {
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  if (!r.ok) await falhou(r);
  const nome = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? nomePadrao;
  const link = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = link;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(link), 10_000);
  return r.headers;
}

export interface Coluna {
  chave: string;
  titulo: React.ReactNode;
  /** Nome no menu Colunas quando o título é vazio ou não é texto */
  rotulo?: string;
  alinhar?: 'dir' | 'centro';
  /** Largura inicial (px) */
  largura?: number;
  render?: (r: Reg) => React.ReactNode;
  /** Conteúdo do rodapé (soma) */
  rodape?: React.ReactNode;
  /** Título do grupo de colunas (cabeçalho agrupado) */
  grupo?: string;
  /** Clique no título (ordenação) */
  aoClicarTitulo?: () => void;
  ordenada?: 'asc' | 'desc' | null;
  /** Classe extra da célula conforme a linha */
  classe?: (r: Reg) => string;
  /** Fora da grade por padrão (o usuário liga no menu Colunas) */
  oculta?: boolean;
  /** Presa à esquerda ao rolar (a GradeLista só prende a primeira coluna visível) */
  fixa?: boolean;
}

interface GradeProps {
  /** Chave da configuração da grade em usuarios.config_listas (ex.: 'faturamento.notas') */
  nome: string;
  colunas: Coluna[];
  linhas: Reg[];
  chave?: string;
  selecionado?: unknown;
  onSelecionar?: (r: Reg) => void;
  /** Duplo clique: recebe também a coluna clicada */
  onDuploClique?: (r: Reg, coluna: string) => void;
  carregando?: boolean;
  vazio?: string;
  /** Linha riscada (cancelada) */
  riscada?: (r: Reg) => boolean;
  /** Coluna Ações fixa à direita */
  acoes?: (r: Reg) => React.ReactNode;
  onToast?: (msg: string) => void;
}

/** Adaptador das grades do módulo para a GradeLista (☰, colunas configuráveis, preferências por usuário) */
export const Grade: React.FC<GradeProps> = ({ colunas, riscada, onDuploClique, acoes, ...resto }) => {
  // A GradeLista não informa a coluna do duplo clique: guarda a célula clicada (td[data-col] = chave)
  const colunaClicada = useRef('');
  const cols: ColunaLista<Reg>[] = colunas.map((c) => ({
    id: c.chave,
    campo: c.chave,
    titulo: c.titulo,
    rotulo: c.rotulo,
    alinhar: c.alinhar ?? 'esq',
    largura: c.largura,
    render: c.render,
    // O rodapé da GradeLista quebra linha: soma longa ('R$ 3.590,00') fica numa linha só
    rodape: c.rodape === undefined ? undefined : <span className="whitespace-nowrap">{c.rodape}</span>,
    grupo: c.grupo,
    aoClicarTitulo: c.aoClicarTitulo,
    ordenada: c.ordenada,
    oculta: c.oculta,
    fixa: c.fixa,
    classe: (r) => `${c.classe?.(r) ?? ''} ${riscada?.(r) ? '!text-stone-400' : ''}`,
  }));
  return (
    <div className="contents" onDoubleClickCapture={(e) => (colunaClicada.current = (e.target as HTMLElement).closest('td[data-col]')?.getAttribute('data-col') ?? '')}>
      <GradeLista<Reg>
        {...resto}
        colunas={cols}
        classeLinha={riscada ? (r) => (riscada(r) ? 'line-through' : '') : undefined}
        onDuploClique={onDuploClique ? (r) => onDuploClique(r, colunaClicada.current) : undefined}
        acoes={acoes}
        larguraAcoes="w-16 min-w-16 max-w-16"
      />
    </div>
  );
};

/** Título de painel (Faturamentos / Notas / Produtos da Nota) */
export const TituloPainel: React.FC<{ children: React.ReactNode; direita?: React.ReactNode }> = ({ children, direita }) => (
  <div className="px-3 py-2 flex items-center justify-between gap-2 border-b border-stone-200 dark:border-stone-800 bg-stone-50/60 dark:bg-stone-950/40 shrink-0">
    <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">{children}</span>
    {direita}
  </div>
);
