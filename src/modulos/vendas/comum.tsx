import React, { useEffect, useState } from 'react';
import { Inbox, Loader2, Search } from 'lucide-react';
import { api } from '../../services/api';
import { lerSessao } from '../../utils/session';
import { Janela } from '../../components/Janela';
import { AvisoErro } from '../../components/AvisoErro';
import { INPUT_CLASS } from '../../utils/formStyles';

export type Linha = Record<string, any>;

export const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
export const moeda = (v: unknown) => num(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const qtd = (v: unknown) => num(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
export const dataBR = (v: unknown) => {
  const s = String(v ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split('-').reverse().join('/') : s;
};
export const dataHoraBR = (v: unknown) => {
  const s = String(v ?? '');
  return s.length >= 16 ? `${dataBR(s)} ${s.slice(11, 16)}` : dataBR(s);
};
/** NUMERO com zeros à esquerda (9 dígitos) quando ≠ 0 */
export const numero9 = (v: unknown) => (num(v) ? String(v).padStart(9, '0') : '');
export const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/** BadGet do Delphi: chip com fundo colorido e texto branco */
export const Badge: React.FC<{ texto: React.ReactNode; cor?: string; escuro?: boolean; title?: string }> = ({ texto, cor, escuro, title }) =>
  texto === '' || texto == null ? null : (
    <span title={title} className="inline-block rounded-[3px] text-[11px] font-semibold px-1.5 py-0.5 whitespace-nowrap leading-tight" style={{ background: cor || '#9CA3AF', color: escuro ? '#111' : '#fff' }}>
      {texto}
    </span>
  );

/** Status da venda (§1) */
export const STATUS: Record<string, [string, string]> = {
  A: ['EDITANDO', '#FFD700'],
  F: ['FINALIZADO', '#20B2AA'],
  R: ['NÃO CONFIRMADO', '#FA8072'],
  C: ['CONFIRMADO', '#20B2AA'],
  P: ['CAPTURADO', '#20B2AA'],
};
export const BadgeStatus: React.FC<{ status: string }> = ({ status }) => {
  const [t, c] = STATUS[status] ?? [status, '#9CA3AF'];
  return <Badge texto={t} cor={c} escuro={status === 'A'} />;
};

export const Carregando: React.FC<{ texto?: string }> = ({ texto }) => (
  <div className="py-10 flex items-center justify-center gap-2 text-xs text-stone-400">
    <Loader2 className="w-5 h-5 animate-spin" />
    {texto}
  </div>
);

export interface Coluna<T> {
  chave: string;
  titulo: React.ReactNode;
  largura?: number;
  alinhar?: 'esq' | 'centro' | 'dir';
  render?: (row: T) => React.ReactNode;
  dica?: string;
}

/** Grade somente leitura: cabeçalho fixo, linha selecionada e duplo clique */
export function Grade<T extends Linha>({
  colunas,
  linhas,
  chave = 'id',
  selecionado,
  onSelecionar,
  onDuploClique,
  carregando,
  vazio = 'Nenhum registro.',
  rodape,
  agrupar,
  classeLinha,
}: {
  colunas: Coluna<T>[];
  linhas: T[];
  chave?: string;
  selecionado?: unknown;
  onSelecionar?: (row: T) => void;
  onDuploClique?: (row: T) => void;
  carregando?: boolean;
  vazio?: string;
  rodape?: React.ReactNode;
  /** Agrupa as linhas pelo valor do campo (cabeçalho de grupo e, opcionalmente, um resumo) */
  agrupar?: { campo: string; resumo?: (linhas: T[]) => React.ReactNode };
  classeLinha?: (row: T) => string;
}) {
  const alinhar = (a?: string) => (a === 'centro' ? 'text-center' : a === 'dir' ? 'text-right' : 'text-left');
  const linhaTr = (row: T) => {
    const sel = selecionado !== undefined && String(row[chave]) === String(selecionado);
    return (
      <tr
        key={String(row[chave])}
        data-id={String(row[chave])}
        onClick={() => onSelecionar?.(row)}
        onDoubleClick={() => onDuploClique?.(row)}
        className={`cursor-default ${sel ? 'bg-blue-100/80 dark:bg-blue-950/60' : 'hover:bg-stone-100/70 dark:hover:bg-stone-800/50'} ${classeLinha?.(row) ?? ''}`}
      >
        {colunas.map((c) => (
          <td key={c.chave} className={`px-2.5 py-1.5 whitespace-nowrap border-b border-stone-100 dark:border-stone-800/70 text-stone-700 dark:text-stone-200 ${alinhar(c.alinhar)}`}>
            {c.render ? c.render(row) : String(row[c.chave] ?? '')}
          </td>
        ))}
      </tr>
    );
  };
  let corpo: React.ReactNode;
  if (agrupar) {
    const grupos = new Map<string, T[]>();
    for (const l of linhas) {
      const g = String(l[agrupar.campo] ?? '');
      grupos.set(g, [...(grupos.get(g) ?? []), l]);
    }
    corpo = [...grupos].map(([g, ls]) => (
      <React.Fragment key={g}>
        <tr>
          <td colSpan={colunas.length} className="px-2.5 py-1 text-[11px] font-bold text-stone-600 dark:text-stone-300 bg-stone-100 dark:bg-stone-800/70">
            {g}
          </td>
        </tr>
        {ls.map(linhaTr)}
        {agrupar.resumo && (
          <tr>
            <td colSpan={colunas.length} className="px-2.5 py-1 text-right text-[11px] font-bold text-blue-900 dark:text-blue-300 border-b border-stone-200 dark:border-stone-700">
              {agrupar.resumo(ls)}
            </td>
          </tr>
        )}
      </React.Fragment>
    ));
  } else corpo = linhas.map(linhaTr);
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <table className="text-xs border-separate border-spacing-0 min-w-full">
        <thead className="sticky top-0 z-10">
          <tr>
            {colunas.map((c) => (
              <th
                key={c.chave}
                title={c.dica}
                style={c.largura ? { minWidth: c.largura } : undefined}
                className="px-2.5 py-2 text-center font-semibold text-stone-600 dark:text-stone-300 whitespace-nowrap border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950"
              >
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={carregando && linhas.length ? 'opacity-60' : undefined}>{corpo}</tbody>
        {rodape && <tfoot className="sticky bottom-0">{rodape}</tfoot>}
      </table>
      {!linhas.length &&
        (carregando ? (
          <Carregando />
        ) : (
          <div className="py-8 flex flex-col items-center gap-1 text-xs text-stone-400">
            <Inbox className="w-5 h-5" />
            {vazio}
          </div>
        ))}
    </div>
  );
}

/** PDF de rota autenticada mostrado numa janela (preview do Delphi) */
export const PreviewPdf: React.FC<{ url: string; titulo: string; onFechar: () => void; metodo?: 'GET' | 'POST' }> = ({ url, titulo, onFechar }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let link = '';
    fetch(url, { headers: { Authorization: `Bearer ${lerSessao()?.token ?? ''}` } })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `Falha ao gerar o PDF (HTTP ${r.status}).`);
        link = URL.createObjectURL(await r.blob());
        setSrc(link);
      })
      .catch((e) => setErro(e.message));
    return () => {
      if (link) URL.revokeObjectURL(link);
    };
  }, [url]);
  return (
    <Janela titulo={titulo} onFechar={onFechar} largura="max-w-5xl">
      {erro && <AvisoErro mensagem={erro} onFechar={onFechar} />}
      {src ? <iframe title={titulo} src={src} className="w-full h-[75vh] border-0 rounded-lg bg-white" /> : !erro && <Carregando texto="Gerando PDF..." />}
    </Janela>
  );
};

/** Id + nome com lupa (F2/lupa do Delphi): digita o id ou pesquisa por texto */
export const CampoPesquisa: React.FC<{
  tipo: 'clientes' | 'produtos';
  id: number | string | null | undefined;
  nome: string;
  onEscolher: (id: number, linha: Linha | null) => void;
  obrigatorio?: boolean;
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  desabilitado?: boolean;
}> = ({ tipo, id, nome, onEscolher, obrigatorio, autoFocus, inputRef, desabilitado }) => {
  const [texto, setTexto] = useState(id ? String(id) : '');
  const [aberto, setAberto] = useState(false);
  useEffect(() => setTexto(id ? String(id) : ''), [id]);

  const sair = async () => {
    const n = Number(texto) || 0;
    if (n === (Number(id) || 0)) return;
    if (!n) return onEscolher(0, null);
    try {
      const r: Linha[] = await api.get(`/api/vendas/pesquisa/${tipo}?q=${n}`);
      onEscolher(n, r.find((x) => Number(x.id) === n) ?? null);
    } catch {
      onEscolher(n, null);
    }
  };
  return (
    <div className="flex gap-1.5 items-stretch">
      <input
        ref={inputRef}
        className={`${INPUT_CLASS} w-24 text-right font-mono`}
        value={texto}
        required={obrigatorio}
        autoFocus={autoFocus}
        disabled={desabilitado}
        inputMode="numeric"
        onChange={(e) => setTexto(e.target.value.replace(/\D/g, ''))}
        onBlur={sair}
        onKeyDown={(e) => {
          if (e.key === 'F2') {
            e.preventDefault();
            setAberto(true);
          }
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        title="F2 ou a lupa: pesquisar"
      />
      <button
        type="button"
        disabled={desabilitado}
        onClick={() => setAberto(true)}
        title="Pesquisar (F2)"
        className="h-[38px] px-2.5 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40"
      >
        <Search className="w-4 h-4" />
      </button>
      <input className={`${INPUT_CLASS} flex-1 min-w-0`} value={nome} readOnly tabIndex={-1} />
      {aberto && (
        <JanelaPesquisa
          tipo={tipo}
          onFechar={() => setAberto(false)}
          onEscolher={(l) => {
            setAberto(false);
            setTexto(String(l.id));
            onEscolher(Number(l.id), l);
          }}
        />
      )}
    </div>
  );
};

const JanelaPesquisa: React.FC<{ tipo: 'clientes' | 'produtos'; onFechar: () => void; onEscolher: (l: Linha) => void }> = ({ tipo, onFechar, onEscolher }) => {
  const [q, setQ] = useState('');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    setCarregando(true);
    const t = setTimeout(() => {
      api
        .get(`/api/vendas/pesquisa/${tipo}?q=${encodeURIComponent(q)}`)
        .then((r) => setLinhas(r))
        .catch((e) => setErro(e.message))
        .finally(() => setCarregando(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, tipo]);
  const colunas: Coluna<Linha>[] =
    tipo === 'clientes'
      ? [
          { chave: 'id', titulo: 'ID', alinhar: 'dir' },
          { chave: 'nome', titulo: 'Nome' },
          { chave: 'fantasia', titulo: 'Fantasia' },
          { chave: 'cpf_cnpj', titulo: 'CPF/CNPJ' },
          { chave: 'endereco_cidade', titulo: 'Cidade', render: (r) => `${r.endereco_cidade ?? ''}${r.endereco_uf ? `/${r.endereco_uf}` : ''}` },
        ]
      : [
          { chave: 'id', titulo: 'ID', alinhar: 'dir' },
          { chave: 'referencia', titulo: 'Referência' },
          { chave: 'descricao', titulo: 'Produto' },
          { chave: 'un_venda', titulo: 'Un', alinhar: 'centro' },
          { chave: 'preco_venda', titulo: 'Preço', alinhar: 'dir', render: (r) => moeda(r.preco_venda) },
          { chave: 'qtd_estoque', titulo: 'Estoque', alinhar: 'dir', render: (r) => qtd(r.qtd_estoque) },
        ];
  return (
    <Janela titulo={tipo === 'clientes' ? 'Pesquisar cliente' : 'Pesquisar produto'} onFechar={onFechar} largura="max-w-3xl">
      <input autoFocus className={`${INPUT_CLASS} w-full mb-3`} placeholder="Digite parte do nome, referência ou o código" value={q} onChange={(e) => setQ(e.target.value)} />
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-2" />}
      <div className="h-[50vh] flex flex-col border border-stone-200 dark:border-stone-800 rounded-lg overflow-hidden">
        <Grade colunas={colunas} linhas={linhas} carregando={carregando} onDuploClique={onEscolher} onSelecionar={undefined} vazio="Nada encontrado." />
      </div>
      <p className="mt-2 text-[11px] text-stone-400">Duplo clique escolhe.</p>
    </Janela>
  );
};

/** Botão de barra (mesma altura dos campos) */
export const Botao: React.FC<{ icone?: React.ComponentType<{ className?: string }>; children?: React.ReactNode; onClick: () => void; titulo?: string; desabilitado?: boolean; tom?: 'normal' | 'primario' | 'perigo'; carregando?: boolean }> = ({
  icone: Icone,
  children,
  onClick,
  titulo,
  desabilitado,
  tom = 'normal',
  carregando,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={desabilitado || carregando}
    title={titulo}
    className={`inline-flex items-center gap-1.5 h-[38px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
      tom === 'primario'
        ? 'text-white bg-blue-600 hover:bg-blue-700'
        : tom === 'perigo'
          ? 'text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/40'
          : 'text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800'
    }`}
  >
    {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : Icone && <Icone className="w-4 h-4" />}
    {children}
  </button>
);
