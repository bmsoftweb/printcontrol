import React from 'react';
import { GradeLista, type ColunaLista } from '../../components/GradeLista';
import { lerSessao } from '../../utils/session';
import { formatarNumero } from './regras';
import { INPUT_CLASS } from '../../utils/formStyles';

/** Classe dos campos (DateField, NumberField, SelectBusca), como no RecordForm */
export const CAMPO = `${INPUT_CLASS} w-full`;

/** BadGet do Delphi: selo com fundo na cor indicada e texto branco */
export const Badge: React.FC<{ texto: React.ReactNode; cor?: string; escuro?: boolean }> = ({ texto, cor, escuro }) =>
  texto === '' || texto === null || texto === undefined ? null : (
    <span
      className="inline-block rounded-[3px] text-[11px] font-semibold px-1.5 py-0.5 whitespace-nowrap leading-tight"
      style={{ background: cor ?? (texto === 'SIM' ? '#2E8B57' : '#9CA3AF'), color: escuro ? '#111' : '#fff' }}
    >
      {texto}
    </span>
  );

export const dataBR = (v: unknown) => {
  const s = String(v ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split('-').reverse().join('/') : s;
};
export const dataHoraBR = (v: unknown) => {
  const s = String(v ?? '');
  return s.length >= 16 ? `${dataBR(s)} ${s.slice(11, 16)}` : dataBR(s);
};
export const valorBR = (v: unknown, formato = ',0.00') => formatarNumero(v, formato);

/** Coluna das grades de OS/Requisições/Consultas: a da GradeLista com `chave` (campo e id da configuração) */
export type ColunaGrade<T> = Omit<ColunaLista<T>, 'id' | 'campo'> & { chave: string };

/**
 * Grade das telas de OS/Requisições/Consultas (a edição é por formulário em janela): adaptador da GradeLista
 * (menu ☰, colunas configuráveis e salvas em usuarios.config_listas com a chave `nome`).
 */
export function Grade<T extends Record<string, any>>({
  colunas,
  ...props
}: {
  nome: string;
  colunas: ColunaGrade<T>[];
  linhas: T[];
  chave?: string;
  selecionado?: unknown;
  onSelecionar?: (row: T) => void;
  onDuploClique?: (row: T) => void;
  carregando?: boolean;
  vazio?: React.ReactNode;
  acoes?: (row: T) => React.ReactNode;
  larguraAcoes?: string;
  classeLinha?: (row: T) => string;
  onToast?: (msg: string) => void;
}) {
  return <GradeLista {...props} colunas={colunas.map((c) => ({ ...c, id: c.chave, campo: c.chave }))} />;
}

/** Barra de ferramentas das telas próprias */
export const Barra: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 ${className}`}>{children}</div>
);

/** PDF de rota autenticada aberto numa nova aba (como o window.open do Delphi) */
export async function abrirPdf(url: string, corpo?: unknown) {
  // A aba é aberta já no clique: depois do await o navegador bloquearia como pop-up
  const aba = window.open('', '_blank');
  try {
    const res = await fetch(url, {
      method: corpo === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${lerSessao()?.token ?? ''}`, ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Falha ao gerar o PDF (HTTP ${res.status}).`);
    const link = URL.createObjectURL(await res.blob());
    if (aba) aba.location.href = link;
    else {
      // Pop-up bloqueado: baixa o arquivo em vez de sair do sistema
      const a = document.createElement('a');
      a.href = link;
      a.download = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'documento.pdf';
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(link), 60_000);
  } catch (e) {
    aba?.close();
    throw e;
  }
}

/** Seletor de status (filtro do Delphi: combo na coluna Status) */
export const FiltroStatus: React.FC<{ valor: string; opcoes: [string, string][]; onChange: (v: string) => void }> = ({ valor, opcoes, onChange }) => (
  <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-600 dark:text-stone-300">
    Status
    <select value={valor} onChange={(e) => onChange(e.target.value)} className="bg-stone-50 dark:bg-stone-800/80 h-[38px] px-3 text-xs font-medium text-stone-800 dark:text-stone-100 cursor-pointer">
      {opcoes.map(([v, l]) => (
        <option key={v} value={v}>
          {v}-{l}
        </option>
      ))}
    </select>
  </label>
);
