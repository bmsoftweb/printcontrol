import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, FileText, FolderPlus, FolderTree, Loader2, Pencil, Plus, Save, Search, Ticket, Trash2, Wand2 } from 'lucide-react';
import type { GanchosCrud, Tela, TelaProps } from './tipos';
import type { OpcaoRef, RegistroCrud } from '../types';
import { api, createRecord, deleteRecord, fetchOptions, invalidateOptions, updateRecord } from '../services/api';
import { lerSessao } from '../utils/session';
import { CrudView } from '../components/CrudView';
import { BotaoAcao, MenuAcoes, SeparadorAcoes } from '../components/MenuAcoes';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from '../components/Janela';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AvisoErro } from '../components/AvisoErro';
import { NumberField } from '../components/NumberField';
import { SelectBusca } from '../components/SelectBusca';
import { FIELD_CLASS, HINT_CLASS, INPUT_CLASS, LABEL_CLASS } from '../utils/formStyles';

const selecionar = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();
const Carregando = () => (
  <div className="py-10 flex justify-center">
    <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
  </div>
);

// ============================================================ Tela com abas (os botões que trocavam a aba oculta no Delphi)

interface Aba {
  id: string;
  rotulo: string;
  recurso?: string;
  ganchos?: GanchosCrud;
  conteudo?: React.ReactNode;
}

const TelaAbas: React.FC<{ p: TelaProps; abas: Aba[] }> = ({ p, abas }) => {
  const [ativa, setAtiva] = useState(abas[0].id);
  const aba = abas.find((a) => a.id === ativa) ?? abas[0];
  const recurso = aba.recurso ? p.resources.find((r) => r.name === aba.recurso) : null;
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex gap-1 px-4 pt-2 bg-stone-100 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800 overflow-x-auto shrink-0">
        {abas.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAtiva(a.id)}
            className={`px-4 py-2 text-xs font-semibold whitespace-nowrap rounded-t-lg border-b-2 cursor-pointer transition-colors ${
              a.id === aba.id
                ? 'bg-white dark:bg-stone-900 text-blue-700 dark:text-blue-400 border-blue-600'
                : 'border-transparent text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
            }`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>
      {aba.conteudo ??
        (recurso ? (
          <CrudView
            key={recurso.name}
            resource={recurso}
            allResources={p.resources}
            refreshToken={p.refreshToken}
            createToken={0}
            onToast={p.onToast}
            onCountChange={p.onCountChange}
            onNavigate={p.onNavigate}
            usuario={p.usuario}
            {...aba.ganchos}
          />
        ) : (
          <Carregando />
        ))}
    </div>
  );
};

// ============================================================ Visualizador de PDF (frmPreviewRelat do Delphi)

const PreviewPdf: React.FC<{ url: string; titulo: string; onFechar: () => void }> = ({ url, titulo, onFechar }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let link = '';
    fetch(url, { headers: { Authorization: `Bearer ${lerSessao()?.token ?? ''}` } })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `Falha ao gerar o relatório (HTTP ${r.status}).`);
        link = URL.createObjectURL(await r.blob());
        setSrc(link);
      })
      .catch((e) => setErro(e.message));
    return () => link && URL.revokeObjectURL(link);
  }, [url]);
  return (
    <Janela titulo={titulo} onFechar={onFechar} largura="max-w-5xl">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      {src ? <iframe title={titulo} src={src} className="w-full h-[75vh] border-0 rounded-lg bg-white" /> : !erro && <Carregando />}
    </Janela>
  );
};

// ============================================================ Equipamentos

const BotaoInventario: React.FC = () => {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setAberto(true)} title="Relatório Inventário de Equipamentos (PDF)">
        <FileText className="w-4 h-4" />
        Inventário
      </button>
      {aberto && <PreviewPdf url="/api/equipamentos/inventario.pdf" titulo="Inventário de equipamentos" onFechar={() => setAberto(false)} />}
    </>
  );
};

const GerarNs: React.FC<{ row: RegistroCrud; recarregar: () => void; onToast: (m: string) => void }> = ({ row, recarregar, onToast }) => {
  const [gerando, setGerando] = useState(false);
  if (String(row.nr_serie ?? '').trim()) return null;
  const gerar = async () => {
    setGerando(true);
    try {
      const r = await api.post(`/api/equipamentos/${row.id}/gerar-ns`);
      onToast(`Número de série ${r.nr_serie} gerado.`);
      recarregar();
    } catch (e: any) {
      onToast(e.message);
    } finally {
      setGerando(false);
    }
  };
  return <BotaoAcao icone={Wand2} titulo="Gerar NS" descricao='Gera o número de série "PC" + 8 caracteres' carregando={gerando} onClick={gerar} />;
};

const TelaEquipamentos: React.FC<TelaProps> = (p) => (
  <TelaAbas
    p={p}
    abas={[
      {
        id: 'equip',
        rotulo: 'Equipamentos',
        recurso: 'equipamentos',
        ganchos: {
          acoesLista: () => <BotaoInventario />,
          acoesLinha: (row, { recarregar }) => <GerarNs row={row} recarregar={recarregar} onToast={p.onToast} />,
        },
      },
      { id: 'marcas', rotulo: 'Marcas', recurso: 'equipamentos_marcas' },
      { id: 'tipos', rotulo: 'Tipos', recurso: 'equipamentos_tipos' },
    ]}
  />
);

// ============================================================ Produtos: árvore Família > Grupo > Subgrupo

interface NoGrupo {
  id: number;
  id_familia: number | null;
  familia: string | null;
  id_pai: number;
  descricao: string;
  caminho: string | null;
  nivel: number;
  filhos: number;
  produtos: number;
}

interface GrupoEdicao {
  id: number;
  descricao: string;
  id_familia: string;
  id_produtos_grupos: number;
  /** Delphi: pai fixo em "+ Grupo"/"+ Subgrupo"; editável em "Editar" (permite mover) */
  paiLivre: boolean;
}

/** Modal "cad. grupo" (pan_cad_grupo) */
const GrupoModal: React.FC<{ inicial: GrupoEdicao; nos: NoGrupo[]; familias: OpcaoRef[]; onFechar: () => void; onGravado: (id: number) => void }> = ({
  inicial,
  nos,
  familias,
  onFechar,
  onGravado,
}) => {
  const [g, setG] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const pai = nos.find((n) => n.id === g.id_produtos_grupos);
  const opcoesPai = useMemo(
    () => [{ value: '0', label: '— Nenhum (grupo raiz da família) —' }, ...nos.filter((n) => n.id !== g.id).map((n) => ({ value: String(n.id), label: `${n.caminho ?? n.descricao} (#${n.id})` }))],
    [nos, g.id],
  );

  const gravar = async () => {
    setGravando(true);
    setErro(null);
    try {
      const dados = { descricao: g.descricao, id_familia: pai ? pai.id_familia : g.id_familia || null, id_produtos_grupos: g.id_produtos_grupos };
      const id = g.id ? (await updateRecord('produtos_grupos', g.id, dados), g.id) : Number((await createRecord('produtos_grupos', dados)).id);
      invalidateOptions('produtos_arvore_grupos');
      onGravado(id);
    } catch (e: any) {
      setErro(e.message);
      setGravando(false);
    }
  };

  return (
    <Janela
      titulo={g.id ? `Grupo #${g.id}` : 'Novo grupo'}
      subtitulo={pai ? `Subgrupo de ${pai.caminho ?? pai.descricao}` : 'Grupo raiz da família'}
      onFechar={onFechar}
      largura="max-w-lg"
      ocupado={gravando}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={gravando}>
            Cancelar
          </button>
          <button type="button" className={BOTAO_PRIMARIO} onClick={gravar} disabled={gravando || !g.descricao.trim()}>
            {gravando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Gravar
          </button>
        </>
      }
    >
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <div className="flex flex-col gap-3">
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Descrição do grupo/subgrupo</span>
          <input
            autoFocus
            required
            maxLength={50}
            className={INPUT_CLASS}
            value={g.descricao}
            onFocus={selecionar}
            onChange={(e) => setG({ ...g, descricao: e.target.value.toUpperCase() })}
            onKeyDown={(e) => e.key === 'Enter' && g.descricao.trim() && gravar()}
          />
        </label>
        <div className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Grupo pai</span>
          {g.paiLivre ? (
            <SelectBusca value={String(g.id_produtos_grupos)} options={opcoesPai} onChange={(v) => setG({ ...g, id_produtos_grupos: Number(v) || 0 })} />
          ) : (
            <input className={INPUT_CLASS} disabled value={pai ? `${pai.caminho ?? pai.descricao} (#${pai.id})` : '— Nenhum (grupo raiz da família) —'} />
          )}
        </div>
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>A qual família pertence?</span>
          <select
            required
            className={INPUT_CLASS}
            disabled={Boolean(pai)}
            value={pai ? String(pai.id_familia ?? '') : g.id_familia}
            onChange={(e) => setG({ ...g, id_familia: e.target.value })}
          >
            <option value="">— Escolha —</option>
            {familias.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          {pai && <span className={HINT_CLASS}>O subgrupo fica na família do grupo pai.</span>}
        </label>
      </div>
    </Janela>
  );
};

/**
 * Aba "Grupos" de Produtos: árvore agrupada por família. Modo cadastro (+ Grupo, + Subgrupo, Editar, Excluir)
 * ou pesquisa ("..." da linha do produto: escolhe um grupo do último nível).
 */
const ArvoreGrupos: React.FC<{ onToast: (m: string) => void; refreshToken?: number; onEscolher?: (no: NoGrupo) => void }> = ({ onToast, refreshToken, onEscolher }) => {
  const [nos, setNos] = useState<NoGrupo[] | null>(null);
  const [familias, setFamilias] = useState<OpcaoRef[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const [editando, setEditando] = useState<GrupoEdicao | null>(null);
  const [excluindo, setExcluindo] = useState<NoGrupo | null>(null);
  const [marcado, setMarcado] = useState<number | null>(null);

  const carregar = useCallback(() => {
    api.get<NoGrupo[]>('/api/produtos-grupos/arvore').then(setNos).catch((e) => setErro(e.message));
    invalidateOptions('produtos_familias');
    fetchOptions('produtos_familias', 'descricao').then(setFamilias).catch(() => setFamilias([]));
  }, []);
  useEffect(carregar, [carregar, refreshToken]);

  const visiveis = useMemo(() => {
    const f = filtro.trim().toUpperCase();
    return (nos ?? []).filter((n) => !f || `${n.familia ?? ''}/${n.caminho ?? n.descricao}`.toUpperCase().includes(f) || String(n.id) === f);
  }, [nos, filtro]);

  const familiasDaLista = [...new Set(visiveis.map((n) => n.familia ?? '(sem família)'))];

  const escolher = (n: NoGrupo) => {
    if (!onEscolher) return;
    if (n.filhos > 0) return setErro('Você deve escolher o último nível na hierarquia de grupos.');
    onEscolher(n);
  };

  const novo = (pai: NoGrupo | null, familia?: number | null) =>
    setEditando({ id: 0, descricao: '', id_familia: String(familia ?? pai?.id_familia ?? ''), id_produtos_grupos: pai?.id ?? 0, paiLivre: false });

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-stone-200 dark:border-stone-800">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input className={`${INPUT_CLASS} pl-8 w-72`} placeholder="Filtrar família / grupo / Id" value={filtro} onFocus={selecionar} onChange={(e) => setFiltro(e.target.value)} />
        </div>
        {!onEscolher && (
          <button type="button" className={BOTAO_PRIMARIO} onClick={() => novo(null)}>
            <Plus className="w-4 h-4" />
            Novo grupo
          </button>
        )}
        {onEscolher && <span className={HINT_CLASS}>Clique num grupo do último nível (sem subgrupos) para ligar ao produto.</span>}
      </div>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3" />}
      <div className="flex-1 overflow-auto">
        {!nos ? (
          <Carregando />
        ) : !visiveis.length ? (
          <div className="py-16 text-center text-xs text-stone-500">Nenhum grupo cadastrado.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-stone-50 dark:bg-stone-950 z-10">
              <tr className="text-left text-stone-500 dark:text-stone-400 border-b border-stone-200 dark:border-stone-800">
                <th className="py-2 px-4 font-semibold">Grupos</th>
                <th className="py-2 px-3 font-semibold text-right w-20">Id</th>
                <th className="py-2 px-3 font-semibold text-right w-24">Subgrupos</th>
                <th className="py-2 px-3 font-semibold text-right w-24">Produtos</th>
                {!onEscolher && <th className="py-2 px-3 font-semibold w-px">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {familiasDaLista.map((fam) => (
                <React.Fragment key={fam}>
                  <tr className="bg-stone-100/80 dark:bg-stone-800/60">
                    <td colSpan={onEscolher ? 4 : 5} className="py-1.5 px-4 font-bold text-stone-700 dark:text-stone-200">
                      <FolderTree className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5 text-amber-600" />
                      {fam}
                    </td>
                  </tr>
                  {visiveis
                    .filter((n) => (n.familia ?? '(sem família)') === fam)
                    .map((n) => (
                      <tr
                        key={n.id}
                        onClick={() => (onEscolher ? escolher(n) : setMarcado(n.id))}
                        onDoubleClick={() => !onEscolher && setEditando({ id: n.id, descricao: n.descricao, id_familia: String(n.id_familia ?? ''), id_produtos_grupos: n.id_pai || 0, paiLivre: true })}
                        className={`border-b border-stone-100 dark:border-stone-800/70 cursor-pointer ${
                          marcado === n.id ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-stone-50 dark:hover:bg-stone-800/40'
                        } ${onEscolher && n.filhos > 0 ? 'text-stone-400' : ''}`}
                      >
                        <td className="py-1.5 px-4" style={{ paddingLeft: 16 + n.nivel * 22 }}>
                          <span className={n.nivel === 0 ? 'font-bold' : ''}>{n.descricao}</span>
                        </td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{n.id}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{n.filhos || ''}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{n.produtos || ''}</td>
                        {!onEscolher && (
                          <td className="py-1 px-3" onClick={(e) => e.stopPropagation()}>
                            <MenuAcoes>
                              <BotaoAcao icone={Plus} titulo="+ Grupo" descricao="Novo grupo no mesmo nível" onClick={() => novo(nos.find((x) => x.id === n.id_pai) ?? null, n.id_familia)} />
                              <BotaoAcao icone={FolderPlus} titulo="+ Subgrupo" descricao="Novo subgrupo dentro deste grupo" onClick={() => novo(n)} />
                              <SeparadorAcoes />
                              <BotaoAcao
                                icone={Pencil}
                                titulo="Editar"
                                descricao="Altera descrição, família ou grupo pai"
                                onClick={() => setEditando({ id: n.id, descricao: n.descricao, id_familia: String(n.id_familia ?? ''), id_produtos_grupos: n.id_pai || 0, paiLivre: true })}
                              />
                              <BotaoAcao icone={Trash2} titulo="Excluir" descricao="Exclui o grupo" tom="perigo" onClick={() => setExcluindo(n)} />
                            </MenuAcoes>
                          </td>
                        )}
                      </tr>
                    ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editando && nos && (
        <GrupoModal
          inicial={editando}
          nos={nos}
          familias={familias}
          onFechar={() => setEditando(null)}
          onGravado={(id) => {
            setEditando(null);
            setMarcado(id);
            onToast('Grupo gravado.');
            carregar();
          }}
        />
      )}
      {excluindo && (
        <ConfirmDialog
          titulo="Excluir grupo"
          mensagem={`Confirma excluir o grupo ${excluindo.caminho ?? excluindo.descricao}?`}
          onCancelar={() => setExcluindo(null)}
          onConfirmar={async () => {
            await deleteRecord('produtos_grupos', excluindo.id);
            invalidateOptions('produtos_arvore_grupos');
            setExcluindo(null);
            onToast('Grupo excluído.');
            carregar();
          }}
        />
      )}
    </div>
  );
};

/** "..." da linha do produto: escolhe a família/grupo na árvore (modo pesquisa) */
const EscolherGrupo: React.FC<{ row: RegistroCrud; recarregar: () => void; onToast: (m: string) => void }> = ({ row, recarregar, onToast }) => {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <BotaoAcao icone={FolderTree} titulo="Família / Grupo" descricao="Escolhe o grupo do produto na árvore" onClick={() => setAberto(true)} />
      {aberto && (
        <Janela titulo="Escolher família / grupo" subtitulo={String(row.descricao ?? '')} onFechar={() => setAberto(false)} largura="max-w-3xl">
          <div className="h-[65vh] flex flex-col -mx-5 -my-4">
            <ArvoreGrupos
              onToast={onToast}
              onEscolher={async (n) => {
                try {
                  await updateRecord('produtos', row.id as string | number, { id_familia_grupo: n.id });
                  setAberto(false);
                  onToast(`Produto ligado a ${n.caminho ?? n.descricao}.`);
                  recarregar();
                } catch (e: any) {
                  onToast(e.message);
                }
              }}
            />
          </div>
        </Janela>
      )}
    </>
  );
};

const TelaProdutos: React.FC<TelaProps> = (p) => (
  <TelaAbas
    p={p}
    abas={[
      {
        id: 'produtos',
        rotulo: 'Produtos',
        recurso: 'produtos',
        ganchos: { acoesLinha: (row, { recarregar }) => <EscolherGrupo row={row} recarregar={recarregar} onToast={p.onToast} /> },
      },
      { id: 'marcas', rotulo: 'Marcas', recurso: 'produtos_marcas' },
      { id: 'grupos', rotulo: 'Famílias e Grupos', conteudo: <ArvoreGrupos onToast={p.onToast} refreshToken={p.refreshToken} /> },
      { id: 'familias', rotulo: 'Famílias', recurso: 'produtos_familias' },
    ]}
  />
);

// ============================================================ Tabelas › Etiquetas VOID

interface Etiqueta {
  nr_serie: string;
  id_cliente: number | null;
  cliente: string | null;
  id_produto: number | null;
  produto: string | null;
}

const GerarEtiquetas: React.FC<{ onFechar: () => void; onGeradas: (msg: string) => void }> = ({ onFechar, onGeradas }) => {
  const [formato, setFormato] = useState('[NNNNNN]');
  const [inicial, setInicial] = useState('');
  const [final, setFinal] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const qtd = inicial === '' || final === '' ? 0 : Number(final) - Number(inicial) + 1;
  return (
    <Janela
      titulo="Gerar etiquetas VOID"
      onFechar={onFechar}
      largura="max-w-md"
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>
            Cancelar
          </button>
          <button type="button" className={BOTAO_PRIMARIO} disabled={!formato.trim() || qtd < 1} onClick={() => setConfirmar(true)}>
            <Save className="w-4 h-4" />
            Gravar
          </button>
        </>
      }
    >
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <div className="flex flex-col gap-3">
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Formato da etiqueta VOID</span>
          <input required className={INPUT_CLASS} value={formato} onFocus={selecionar} onChange={(e) => setFormato(e.target.value.toUpperCase())} maxLength={40} />
          <span className={HINT_CLASS}>[NNNNNN] = número com zeros à esquerda (de [N] a [NNNNNNNNN]), [MM] = mês atual, [AAAA] = ano atual.</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={FIELD_CLASS}>
            <span className={LABEL_CLASS}>Nr. etiqueta inicial</span>
            <NumberField required scale={0} value={inicial} onChange={setInicial} />
          </label>
          <label className={FIELD_CLASS}>
            <span className={LABEL_CLASS}>Nr. etiqueta final</span>
            <NumberField required scale={0} value={final} onChange={setFinal} />
          </label>
        </div>
        {qtd > 0 && <span className={HINT_CLASS}>{qtd} etiqueta(s); as que já existem são ignoradas.</span>}
      </div>
      {confirmar && (
        <ConfirmDialog
          titulo="Gerar etiquetas"
          mensagem={`Confirma gerar as ${qtd} etiquetas?`}
          confirmar="Gerar"
          tom="normal"
          onCancelar={() => setConfirmar(false)}
          onConfirmar={async () => {
            const r = await api.post('/api/etiquetas-void/gerar', { formato, inicial: Number(inicial), final: Number(final) });
            onGeradas(`${r.geradas} etiqueta(s) gerada(s)${r.ignoradas ? `; ${r.ignoradas} já existia(m)` : ''}.`);
          }}
        />
      )}
    </Janela>
  );
};

const EtiquetasVoid: React.FC<{ onToast: (m: string) => void; refreshToken: number }> = ({ onToast, refreshToken }) => {
  const [dados, setDados] = useState<{ linhas: Etiqueta[]; mais: boolean } | null>(null);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [gerar, setGerar] = useState(false);
  const [excluir, setExcluir] = useState<Etiqueta | null>(null);

  const carregar = useCallback(() => {
    api.get(`/api/etiquetas-void?busca=${encodeURIComponent(busca)}`).then(setDados).catch((e) => setErro(e.message));
  }, [busca]);
  useEffect(() => {
    const t = setTimeout(carregar, 400);
    return () => clearTimeout(t);
  }, [carregar, refreshToken]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-stone-200 dark:border-stone-800">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input className={`${INPUT_CLASS} pl-8 w-72`} placeholder="Etiqueta, cliente ou produto" value={busca} onFocus={selecionar} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <button type="button" className={BOTAO_PRIMARIO} onClick={() => setGerar(true)}>
          <Ticket className="w-4 h-4" />
          Gerar etiquetas
        </button>
        {dados && (
          <span className={HINT_CLASS}>
            {dados.linhas.length}
            {dados.mais ? '+ (refine a busca)' : ''} etiqueta(s) da empresa ativa
          </span>
        )}
      </div>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3" />}
      <div className="flex-1 overflow-auto">
        {!dados ? (
          <Carregando />
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-stone-50 dark:bg-stone-950">
              <tr className="text-stone-500 dark:text-stone-400 border-b border-stone-200 dark:border-stone-800">
                <th className="py-2 px-4 font-semibold text-center">Nr. Série / Etiqueta</th>
                <th className="py-2 px-3 font-semibold text-right">Id Cliente</th>
                <th className="py-2 px-3 font-semibold text-left">Cliente</th>
                <th className="py-2 px-3 font-semibold text-right">Id Produto</th>
                <th className="py-2 px-3 font-semibold text-left">Produto</th>
                <th className="py-2 px-3 font-semibold w-px">Ações</th>
              </tr>
            </thead>
            <tbody>
              {dados.linhas.map((e) => (
                <tr key={e.nr_serie} className="border-b border-stone-100 dark:border-stone-800/70 hover:bg-stone-50 dark:hover:bg-stone-800/40">
                  <td className="py-1.5 px-4 text-center font-mono">{e.nr_serie}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{e.id_cliente ?? ''}</td>
                  <td className="py-1.5 px-3">{e.cliente ?? ''}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{e.id_produto ?? ''}</td>
                  <td className="py-1.5 px-3">{e.produto ?? ''}</td>
                  <td className="py-1 px-3">
                    <BotaoAcao icone={Trash2} titulo="Excluir" descricao="Exclui a etiqueta (só sem cliente)" tom="perigo" onClick={() => setExcluir(e)} />
                  </td>
                </tr>
              ))}
              {!dados.linhas.length && (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-stone-500">
                    Nenhuma etiqueta.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {gerar && (
        <GerarEtiquetas
          onFechar={() => setGerar(false)}
          onGeradas={(msg) => {
            setGerar(false);
            onToast(msg);
            carregar();
          }}
        />
      )}
      {excluir && (
        <ConfirmDialog
          titulo="Excluir etiqueta"
          mensagem={`Confirma excluir a etiqueta ${excluir.nr_serie}?`}
          onCancelar={() => setExcluir(null)}
          onConfirmar={async () => {
            await api.delete(`/api/etiquetas-void?nr_serie=${encodeURIComponent(excluir.nr_serie)}`);
            setExcluir(null);
            onToast('Etiqueta excluída.');
            carregar();
          }}
        />
      )}
    </div>
  );
};

const TelaTabelas: React.FC<TelaProps> = (p) => (
  <TelaAbas
    p={p}
    abas={[
      { id: 'planos', rotulo: 'Planos', recurso: 'fatur_planos' },
      { id: 'series', rotulo: 'Séries', recurso: 'fatur_series' },
      { id: 'bancos', rotulo: 'Bancos', recurso: 'bancos' },
      { id: 'cidades', rotulo: 'Cidades', recurso: 'cidades' },
      { id: 'void', rotulo: 'Etiq. VOID', conteudo: <EtiquetasVoid onToast={p.onToast} refreshToken={p.refreshToken} /> },
    ]}
  />
);

// ============================================================ Estoque (Kardex)

const RecalcularSaldos: React.FC<{ recarregar: () => void; onToast: (m: string) => void }> = ({ recarregar, onToast }) => {
  const [confirmar, setConfirmar] = useState(false);
  return (
    <>
      <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setConfirmar(true)} title="Refaz saldo e custo médio de todos os movimentos do grupo">
        <Calculator className="w-4 h-4" />
        Recalcular saldos
      </button>
      {confirmar && (
        <ConfirmDialog
          titulo="Recalcular saldos"
          mensagem="Refaz saldo, custo médio e valor das saídas de todos os movimentos do grupo, na ordem de data/hora. Confirma?"
          confirmar="Recalcular"
          tom="normal"
          onCancelar={() => setConfirmar(false)}
          onConfirmar={async () => {
            const r = await api.post('/api/estoque/recalcular');
            setConfirmar(false);
            onToast(`Saldos recalculados: ${r.produtos} produto(s), ${r.movimentos} movimento(s).`);
            recarregar();
          }}
        />
      )}
    </>
  );
};

/** Telas do módulo cadastros (ids das opções do menu em src/utils/menu.ts) */
export const TELAS_CADASTROS: Record<string, Tela> = {
  equipamentos: { componente: TelaEquipamentos },
  produtos: { componente: TelaProdutos },
  tabelas: { componente: TelaTabelas },
  estoque: {
    recurso: 'produtos_cardex',
    ganchos: ({ onToast }) => ({ acoesLista: (recarregar) => <RecalcularSaldos recarregar={recarregar} onToast={onToast} /> }),
  },
};
