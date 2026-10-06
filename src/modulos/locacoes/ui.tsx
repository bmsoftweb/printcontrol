import React from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import type { OpcaoRef, RegistroCrud, ResourceDef } from '../../types';
import { RecordForm } from '../../components/RecordForm';
import { ColunaLista, GradeLista } from '../../components/GradeLista';

// ---------------------------------------------------------------------------------------------
// Formatação (padrão das grades do Delphi)
// ---------------------------------------------------------------------------------------------

export const moeda = (v: unknown, casas = 2) =>
  v === null || v === undefined || v === '' ? '' : `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;
export const inteiro = (v: unknown) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('pt-BR'));
export const dataBr = (v: unknown) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
export const dataHoraBr = (v: unknown) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(v ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : dataBr(v);
};
export const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/** Selo colorido (BadGet do Delphi): fundo da cor, texto branco (escuro nas cores claras) */
export const Selo: React.FC<{ texto: string; cor?: string; onClick?: () => void; title?: string }> = ({ texto, cor, onClick, title }) => {
  const fundo = cor ?? (texto === 'SIM' ? '#2E8B57' : '#E5E5E5');
  const claro = ['#E5E5E5', '#FFD700', '#FFDAB9', '#FFA07A'].includes(fundo.toUpperCase());
  return (
    <span
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
      title={title}
      style={{ background: fundo, color: claro ? '#44403c' : '#fff' }}
      className={`inline-block px-1.5 py-0.5 rounded-[3px] text-[11px] font-semibold leading-tight whitespace-nowrap ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
    >
      {texto}
    </span>
  );
};

// ---------------------------------------------------------------------------------------------
// Grade do módulo: adaptador para a GradeLista compartilhada (mesmos nomes de props das telas antigas)
// ---------------------------------------------------------------------------------------------

export interface Coluna<T> {
  /** Id estável na configuração salva (padrão: o título) */
  id?: string;
  titulo: React.ReactNode;
  /** Nome no menu Colunas quando o título não é texto */
  rotulo?: string;
  /** Campo exibido como texto (sem render) */
  campo?: keyof T & string;
  render?: (row: T) => React.ReactNode;
  alinhar?: 'e' | 'c' | 'd';
  largura?: number;
  /** Estilo próprio da célula (ex.: cor condicional) */
  estilo?: (row: T) => React.CSSProperties | undefined;
  negrito?: boolean;
  /** Linha de totais */
  total?: (rows: T[]) => React.ReactNode;
  oculta?: boolean;
  fixa?: boolean;
  grupo?: string;
}

const ALINHAR = { e: 'esq', c: 'centro', d: 'dir' } as const;

export function Grade<T extends Record<string, any>>({
  nome,
  colunas,
  linhas,
  chave = 'id',
  selecionada,
  onSelecionar,
  onDuploClique,
  carregando,
  vazio = 'Nenhum registro.',
  rolarParaSelecionada,
  acoes,
  larguraAcoes,
  onToast,
}: {
  /** Chave da configuração da grade em usuarios.config_listas (ex.: 'locacoes.contratos') */
  nome: string;
  colunas: Coluna<T>[];
  linhas: T[];
  chave?: string;
  selecionada?: unknown;
  onSelecionar?: (row: T) => void;
  onDuploClique?: (row: T) => void;
  carregando?: boolean;
  vazio?: string;
  rolarParaSelecionada?: boolean;
  acoes?: (row: T) => React.ReactNode;
  larguraAcoes?: string;
  onToast?: (m: string) => void;
}) {
  const cols: ColunaLista<T>[] = colunas.map((c, i) => ({
    id: c.id ?? (typeof c.titulo === 'string' && c.titulo ? c.titulo : (c.campo ?? `c${i}`)),
    titulo: c.titulo,
    rotulo: c.rotulo,
    render: c.render ?? (c.campo ? (row: T) => <span title={String(row[c.campo!] ?? '')}>{String(row[c.campo!] ?? '')}</span> : undefined),
    alinhar: ALINHAR[c.alinhar ?? 'e'],
    largura: c.largura,
    estilo: c.estilo,
    classe: c.negrito ? () => 'font-bold' : undefined,
    rodape: c.total ? <span className="whitespace-nowrap">{linhas.length ? c.total(linhas) : ''}</span> : undefined,
    oculta: c.oculta,
    fixa: c.fixa,
    grupo: c.grupo,
  }));
  return (
      <GradeLista
        nome={nome}
        colunas={cols}
        linhas={linhas}
        chave={chave}
        selecionado={selecionada}
        onSelecionar={onSelecionar}
        onDuploClique={onDuploClique}
        carregando={carregando}
        vazio={vazio}
        acoes={acoes}
        larguraAcoes={larguraAcoes}
        onToast={onToast}
        rolarParaSelecionado={rolarParaSelecionada}
      />
  );
}

/** Botão das barras de ferramentas (38px, ícone + texto) */
export const BotaoBarra: React.FC<{ icone: React.ElementType; texto: string; onClick: () => void; disabled?: boolean; title?: string; primario?: boolean; carregando?: boolean }> = ({
  icone: Icone,
  texto,
  onClick,
  disabled,
  title,
  primario,
  carregando,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled || carregando}
    title={title}
    className={`inline-flex items-center gap-1.5 h-[38px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
      primario
        ? 'text-white bg-blue-600 hover:bg-blue-700'
        : 'text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 hover:bg-stone-100 dark:hover:bg-stone-800'
    }`}
  >
    {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icone className="w-4 h-4" />}
    {texto}
  </button>
);

/** Formulário genérico (RecordForm) numa janela modal */
export const JanelaForm: React.FC<{
  titulo: string;
  resource: ResourceDef;
  record: RegistroCrud | null;
  refOptions: Record<string, OpcaoRef[]>;
  onCancel: () => void;
  onSave: (payload: RegistroCrud) => Promise<void>;
}> = ({ titulo, ...form }) =>
  createPortal(
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" aria-hidden="true" />
      <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden border border-stone-200 dark:border-stone-800 shadow-2xl bg-white dark:bg-stone-900">
        <div className="px-5 py-3 border-b border-stone-200 dark:border-stone-800 text-sm font-bold text-stone-900 dark:text-stone-100 shrink-0">{titulo}</div>
        <RecordForm {...form} />
      </div>
    </div>,
    document.body,
  );
