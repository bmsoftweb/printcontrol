import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Inbox,
  Loader2,
  Map as IconeMapa,
  MapPin,
  MessageSquareText,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  User,
  X,
} from 'lucide-react';
import type { Tela, TelaProps } from './tipos';
import { api, deleteRecord, invalidateOptions, updateRecord } from '../services/api';
import { BotaoAcao, MenuAcoes, SeparadorAcoes } from '../components/MenuAcoes';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from '../components/Janela';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AvisoErro } from '../components/AvisoErro';
import { INPUT_CLASS } from '../utils/formStyles';
import { formatDateBR } from '../utils/formatters';
import { FormCliente } from './clientes/FormCliente';
import { ContratoCliente } from './clientes/ContratoCliente';
import { MapaClientes } from './clientes/MapaClientes';
import { formataCnpj } from './clientes/contrato';
import { consultaFiltro, type Cliente, type FiltroClientes, type OpcoesClientes } from './clientes/tipos';

const POR_PAGINA = 100;
const FILTRO_VAZIO: FiltroClientes = { id: '', nome: '', cpf: '', regiao: '' };

/** Badget do Delphi: etiqueta colorida (sem cor: "ligado" verde, desligado cinza claro) */
const Badge: React.FC<{ texto: string; cor: string; ligado: boolean }> = ({ texto, cor, ligado }) => (
  <span
    className="inline-block rounded-[3px] px-1.5 py-0.5 text-[11px] font-semibold leading-none tracking-wide"
    style={{ background: ligado ? cor : '#E5E5E5', color: ligado ? '#FFF' : '#9CA3AF' }}
  >
    {texto}
  </span>
);

const moeda = (v: unknown, casas: number) =>
  `R$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;
const th = 'px-2.5 py-2 text-center font-semibold text-stone-600 dark:text-stone-300 whitespace-nowrap border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950';
const td = 'px-2.5 py-1.5 border-b border-stone-100 dark:border-stone-800/60 whitespace-nowrap';

/** Colunas de texto da grade (as primeiras, com ícones e etiquetas, ficam no corpo da tabela) */
const COLUNAS_TEXTO: { campo: string; titulo: string; largura?: string; valor?: (c: Cliente) => string }[] = [
  { campo: 'id', titulo: 'ID' },
  { campo: 'banco', titulo: 'Banco' },
  { campo: 'plano', titulo: 'Cobrança' },
  { campo: 'nome', titulo: 'Nome', largura: 'max-w-[260px]' },
  { campo: 'fantasia', titulo: 'Fantasia', largura: 'max-w-[200px]' },
  { campo: 'endereco_cidade', titulo: 'Cidade' },
  { campo: 'cpf_cnpj', titulo: 'CPF/CNPJ', valor: (c) => formataCnpj(c.cpf_cnpj) },
  { campo: 'endereco', titulo: 'Endereço', largura: 'max-w-[220px]' },
  { campo: 'endereco_nr', titulo: 'Nr.' },
  { campo: 'endereco_complemento', titulo: 'Complemento', largura: 'max-w-[160px]' },
  { campo: 'endereco_bairro', titulo: 'Bairro' },
  { campo: 'endereco_uf', titulo: 'UF' },
  { campo: 'endereco_cep', titulo: 'CEP' },
  { campo: 'endereco_id_cidade', titulo: 'ID Cidade' },
  { campo: 'regiao', titulo: 'Região' },
  { campo: 'rg', titulo: 'RG/IE' },
  { campo: 'fone_fixo', titulo: 'Fone (1)' },
  { campo: 'fone_celular1', titulo: 'Fone (2)' },
  { campo: 'fone_celular2', titulo: 'Fone (3)' },
  { campo: 'email', titulo: 'e-Mail', largura: 'max-w-[220px]' },
  { campo: 'tem_senha', titulo: 'Senha', valor: (c) => (c.tem_senha === 'S' ? '••••••' : '') },
  { campo: 'id_integracao', titulo: 'Integração' },
  { campo: 'representante_legal_nome', titulo: 'Nome Repres. Legal', largura: 'max-w-[200px]' },
  { campo: 'representante_legal_cpf', titulo: 'CPF Repres. Legal' },
  { campo: 'obs_nf', titulo: 'Observação para NF', largura: 'max-w-[260px]' },
];

/** Grade "Lista de Equipamentos": contratos de locação do cliente selecionado (somente leitura) */
const ContratosDoCliente: React.FC<{ cliente: Cliente; versao: number }> = ({ cliente, versao }) => {
  const [lista, setLista] = useState<Cliente[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    setLista(null);
    api.get<Cliente[]>(`/api/clientes/${cliente.id}/contratos`).then(setLista).catch((e) => setErro(e.message));
  }, [cliente.id, versao]);

  return (
    <div className="h-52 shrink-0 flex flex-col border-t-2 border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
      <div className="px-4 py-1.5 text-[11px] font-semibold text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-stone-950/40 border-b border-stone-200 dark:border-stone-800 truncate">
        Lista de Equipamentos — <span className="text-stone-700 dark:text-stone-200">{cliente.nome}</span>
        {lista && <span className="font-normal"> · {lista.length} contrato(s)</span>}
      </div>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="m-2" />}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead className="sticky top-0">
            <tr>
              {['Ativo', 'Marca', 'Modelo', 'Setor', 'Série', 'Valor Contrato R$', 'Valor Cópia R$', 'Valor Excedente R$', 'Data Contrato', 'Validade', 'Observações'].map((t) => (
                <th key={t} className={th}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!lista ? (
              <tr>
                <td colSpan={11} className="py-6 text-center">
                  <Loader2 className="w-4 h-4 animate-spin inline text-stone-400" />
                </td>
              </tr>
            ) : !lista.length ? (
              <tr>
                <td colSpan={11} className="py-6 text-center text-stone-400">
                  Nenhum contrato de locação.
                </td>
              </tr>
            ) : (
              lista.map((c) => (
                <tr key={c.id} className={c.ativo === 'S' ? '' : 'text-stone-400'}>
                  <td className={`${td} text-center`}>
                    <Badge texto={c.ativo === 'S' ? 'SIM' : 'NÃO'} cor="#2E8B57" ligado={c.ativo === 'S'} />
                  </td>
                  <td className={td}>{c.marca_descricao}</td>
                  <td className={td}>{c.modelo}</td>
                  <td className={td}>{c.setor}</td>
                  <td className={td}>{c.nr_serie}</td>
                  <td className={`${td} text-right font-mono`}>{moeda(c.valor_contrato, 2)}</td>
                  <td className={`${td} text-right font-mono`}>{moeda(c.valor_copia, 5)}</td>
                  <td className={`${td} text-right font-mono`}>{moeda(c.valor_excedente, 5)}</td>
                  <td className={`${td} text-center`}>{c.data_contrato ? formatDateBR(c.data_contrato) : ''}</td>
                  <td className={`${td} text-center`}>{c.data_vencimento ? formatDateBR(c.data_vencimento) : ''}</td>
                  <td className={`${td} max-w-[300px] truncate`} title={c.obs ?? ''}>
                    {c.obs}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** Aba Inventário: produtos em posse do cliente */
const Inventario: React.FC<{ cliente: Cliente; onVoltar: () => void }> = ({ cliente, onVoltar }) => {
  const [lista, setLista] = useState<Cliente[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(() => {
    setLista(null);
    setErro(null);
    api.get<Cliente[]>(`/api/clientes/${cliente.id}/inventario`).then(setLista).catch((e) => setErro(e.message));
  }, [cliente.id]);
  useEffect(carregar, [carregar]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
      <div className="px-4 py-2.5 border-b border-stone-200 dark:border-stone-800 flex items-center gap-2">
        <button type="button" className={BOTAO_SECUNDARIO} onClick={onVoltar}>
          <ArrowLeft className="w-4 h-4" />
          Voltar
        </button>
        <button type="button" className={BOTAO_SECUNDARIO} onClick={carregar}>
          <RefreshCw className="w-4 h-4" />
          Atualizar
        </button>
        <div className="ml-auto text-xs font-semibold text-stone-700 dark:text-stone-200 truncate">
          Produtos em Posse do Cliente: <span className="text-blue-700 dark:text-blue-400">{cliente.nome}</span>
        </div>
      </div>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3" />}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead className="sticky top-0">
            <tr>
              {['Grupo', 'Empresa', 'ID Prod', 'Produto', 'Marca', 'Modelo', 'Setor', 'Qtdade'].map((t) => (
                <th key={t} className={th}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!lista ? (
              !erro && (
                <tr>
                  <td colSpan={8} className="py-10 text-center">
                    <Loader2 className="w-4 h-4 animate-spin inline text-stone-400" />
                  </td>
                </tr>
              )
            ) : !lista.length ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-stone-400">
                  Nenhum produto em posse do cliente.
                </td>
              </tr>
            ) : (
              lista.map((p, i) => (
                <tr key={i}>
                  <td className={td}>{p.apelido_grupo}</td>
                  <td className={td}>{p.apelido_empresa}</td>
                  <td className={`${td} text-right font-mono`}>{p.id_produto}</td>
                  <td className={td}>{p.descricao}</td>
                  <td className={td}>{p.marca_descricao}</td>
                  <td className={td}>{p.modelo_descricao}</td>
                  <td className={td}>{p.setor}</td>
                  <td className={`${td} text-right font-mono`}>{Number(p.qtdade ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** Modal Observações (pan_obs): memo de pessoas.obs do cliente */
const Observacoes: React.FC<{ cliente: Cliente; onFechar: () => void; onGravou: () => void }> = ({ cliente, onFechar, onGravou }) => {
  const [texto, setTexto] = useState(String(cliente.obs ?? ''));
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const gravar = async () => {
    if (texto === String(cliente.obs ?? '')) return onFechar();
    setGravando(true);
    try {
      await updateRecord('pessoas', cliente.id, { obs: texto });
      onGravou();
    } catch (e: any) {
      setErro(e.message);
      setGravando(false);
    }
  };
  return (
    <Janela
      titulo="Observações"
      subtitulo={cliente.nome}
      onFechar={onFechar}
      ocupado={gravando}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={gravando}>
            Cancelar
          </button>
          <button type="button" className={BOTAO_PRIMARIO} onClick={gravar} disabled={gravando}>
            {gravando && <Loader2 className="w-4 h-4 animate-spin" />}
            Gravar
          </button>
        </>
      }
    >
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <textarea autoFocus className={`${INPUT_CLASS} w-full min-h-[180px] resize-y`} value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Observações" />
    </Janela>
  );
};

type Aba = 'lista' | 'inventario' | 'contrato' | 'mapa';

/** Clientes / Fornecedores (ufrmClientes) */
const TelaClientes: React.FC<TelaProps> = ({ onToast, refreshToken, onCountChange }) => {
  const [aba, setAba] = useState<Aba>('lista');
  const [modoMapa, setModoMapa] = useState<'multiplo' | 'unico'>('multiplo');
  const [filtro, setFiltro] = useState<FiltroClientes>(FILTRO_VAZIO);
  const [aplicado, setAplicado] = useState<FiltroClientes>(FILTRO_VAZIO);
  const [pagina, setPagina] = useState(1);
  const [rows, setRows] = useState<Cliente[]>([]);
  const [total, setTotal] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const [opcoes, setOpcoes] = useState<OpcoesClientes | null>(null);
  const [editando, setEditando] = useState<{ registro: Cliente | null } | null>(null);
  const [excluindo, setExcluindo] = useState<Cliente | null>(null);
  const [obs, setObs] = useState<Cliente | null>(null);
  const [alternando, setAlternando] = useState<string | null>(null);
  const [versaoDetalhe, setVersaoDetalhe] = useState(0);

  const sel = rows.find((r) => r.id === selId) ?? null;

  useEffect(() => {
    api.get<OpcoesClientes>('/api/clientes/opcoes').then(setOpcoes).catch((e) => setErro(e.message));
  }, [refreshToken]);

  // Filtros da grade: aplicam meio segundo depois da digitação (ChangeDelay 500 ms do Delphi)
  useEffect(() => {
    const t = window.setTimeout(() => {
      setAplicado(filtro);
      setPagina(1);
    }, 500);
    return () => window.clearTimeout(t);
  }, [filtro]);

  const carregar = useCallback(
    async (manterSelecao?: number) => {
      setCarregando(true);
      setErro(null);
      try {
        const r = await api.get<{ data: Cliente[]; total: number }>(`/api/clientes/lista?pagina=${pagina}&limite=${POR_PAGINA}&${consultaFiltro(aplicado)}`);
        setRows(r.data);
        setTotal(r.total);
        onCountChange('clientes', r.total);
        setSelId((atual) => {
          const quer = manterSelecao ?? atual;
          return r.data.some((c) => c.id === quer) ? quer! : r.data[0]?.id ?? null;
        });
      } catch (e: any) {
        setErro(e.message);
      } finally {
        setCarregando(false);
      }
    },
    [pagina, aplicado, onCountChange],
  );

  useEffect(() => {
    carregar();
  }, [carregar, refreshToken]);

  /** Clique nas colunas ".", CLI e FOR: inverte e grava na hora */
  const alternar = async (c: Cliente, campo: 'fj' | 'cliente_flag' | 'fornec_flag') => {
    setSelId(c.id);
    setAlternando(`${c.id}:${campo}`);
    try {
      const r = await api.post<{ valor: string }>(`/api/clientes/${c.id}/alternar`, { campo });
      setRows((l) => l.map((x) => (x.id === c.id ? { ...x, [campo]: r.valor } : x)));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setAlternando(null);
    }
  };

  const exigirCliente = (fn: (c: Cliente) => void) => () => (sel ? fn(sel) : onToast('Escolha um cliente!'));
  const abrirMapaUnico = (c: Cliente) => {
    setSelId(c.id);
    setModoMapa('unico');
    setAba('mapa');
  };
  const voltar = () => {
    setAba('lista');
    carregar();
    setVersaoDetalhe((v) => v + 1);
  };

  if (aba === 'inventario' && sel) return <Inventario cliente={sel} onVoltar={() => setAba('lista')} />;
  if (aba === 'contrato' && sel) return <ContratoCliente cliente={sel} onVoltar={voltar} onToast={onToast} />;
  if (aba === 'mapa')
    return (
      <MapaClientes
        key={`${modoMapa}:${modoMapa === 'unico' ? sel?.id : ''}`}
        modo={modoMapa}
        cliente={sel}
        filtro={aplicado}
        opcoes={opcoes}
        onVoltar={voltar}
        onGravou={() => carregar()}
        onToast={onToast}
      />
    );

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const temFiltro = Object.values(filtro).some(Boolean);
  const carregandoToggle = (c: Cliente, campo: string) => alternando === `${c.id}:${campo}`;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
      {/* Barra: filtros (linha de filtro da grade do Delphi) e botões */}
      <div className="px-4 py-2.5 border-b border-stone-200 dark:border-stone-800 flex flex-wrap items-center gap-2">
        <input
          className={`${INPUT_CLASS} w-20 font-mono`}
          placeholder="ID"
          inputMode="numeric"
          value={filtro.id}
          onChange={(e) => setFiltro({ ...filtro, id: e.target.value.replace(/\D/g, '').slice(0, 9) })}
          aria-label="Filtrar por ID"
        />
        <input
          className={`${INPUT_CLASS} w-56 uppercase`}
          placeholder="Nome (começa com)"
          value={filtro.nome}
          onChange={(e) => setFiltro({ ...filtro, nome: e.target.value.toUpperCase() })}
          aria-label="Filtrar por nome"
        />
        <input
          className={`${INPUT_CLASS} w-40 font-mono`}
          placeholder="CPF/CNPJ"
          inputMode="numeric"
          value={filtro.cpf}
          onChange={(e) => setFiltro({ ...filtro, cpf: e.target.value.replace(/[^\d./-]/g, '').slice(0, 18) })}
          aria-label="Filtrar por CPF/CNPJ"
        />
        <select className={`${INPUT_CLASS} w-40 cursor-pointer`} value={filtro.regiao} onChange={(e) => setFiltro({ ...filtro, regiao: e.target.value })} aria-label="Filtrar por região">
          <option value="">Todas as regiões</option>
          {opcoes?.regioes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.descricao ? `${r.id} - ${r.descricao}` : r.id}
            </option>
          ))}
        </select>
        {temFiltro && (
          <button type="button" title="Limpar os filtros" onClick={() => setFiltro(FILTRO_VAZIO)} className="p-2 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" className={BOTAO_SECUNDARIO} onClick={exigirCliente(() => setAba('contrato'))} title="Contrato HTML do cliente selecionado">
            <FileText className="w-4 h-4" />
            Contrato
          </button>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={exigirCliente(() => setAba('inventario'))} title="Produtos em posse do cliente selecionado">
            <Package className="w-4 h-4" />
            Inventário
          </button>
          <button
            type="button"
            className={BOTAO_SECUNDARIO}
            onClick={() => {
              setModoMapa('multiplo');
              setAba('mapa');
            }}
            title="Mapa de todos os clientes filtrados"
          >
            <IconeMapa className="w-4 h-4" />
            Mapa
          </button>
          <button type="button" className={BOTAO_PRIMARIO} onClick={() => setEditando({ registro: null })}>
            <Plus className="w-4 h-4" />
            Novo
          </button>
        </div>
      </div>

      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3" />}

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={`${th} sticky left-0 z-20 w-[30px] px-0`} />
              <th className={th} title="Pessoa física / jurídica (clique para alternar)">.</th>
              <th className={th} title="Cliente (clique para alternar)">CLI</th>
              <th className={th} title="Fornecedor (clique para alternar)">FOR</th>
              <th className={th}>Contrato</th>
              <th className={th} title="Coordenadas (duplo clique: acertar no mapa)" />
              <th className={th}>Obs.</th>
              {COLUNAS_TEXTO.map((c) => (
                <th key={c.campo} className={th}>
                  {c.titulo}
                </th>
              ))}
              <th className={`${th} w-full`} />
              <th className={`${th} sticky right-0 z-20 border-l`}>Ações</th>
            </tr>
          </thead>
          <tbody className={carregando && rows.length ? 'opacity-60' : undefined}>
            {carregando && !rows.length && (
              <tr>
                <td colSpan={COLUNAS_TEXTO.length + 9} className="py-12 text-center text-stone-500">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                  Carregando registros…
                </td>
              </tr>
            )}
            {!carregando && !rows.length && (
              <tr>
                <td colSpan={COLUNAS_TEXTO.length + 9} className="py-14 text-center text-stone-400">
                  <Inbox className="w-8 h-8 mx-auto mb-2" />
                  {temFiltro ? 'Nenhum cliente corresponde aos filtros.' : 'Nenhum cliente cadastrado.'}
                </td>
              </tr>
            )}
            {rows.map((c) => {
              const s = c.id === selId;
              return (
                <tr
                  key={c.id}
                  onClick={() => setSelId(c.id)}
                  onDoubleClick={() => setEditando({ registro: c })}
                  className={`group cursor-pointer ${s ? 'bg-blue-100 dark:bg-blue-950' : 'bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800'}`}
                >
                  <td className={`${td} sticky left-0 z-[5] bg-inherit px-0 text-center border-r border-stone-200 dark:border-stone-800`}>
                    <ChevronRight className={`w-3.5 h-3.5 mx-auto ${s ? 'text-blue-600' : 'text-stone-300 opacity-0 group-hover:opacity-100'}`} />
                  </td>
                  <td className={`${td} text-center`} onClick={() => alternar(c, 'fj')} onDoubleClick={(e) => e.stopPropagation()} title={c.fj === 'F' ? 'Pessoa física (clique: jurídica)' : 'Pessoa jurídica (clique: física)'}>
                    {carregandoToggle(c, 'fj') ? (
                      <Loader2 className="w-4 h-4 animate-spin inline text-stone-400" />
                    ) : c.fj === 'F' ? (
                      <User className="w-4 h-4 inline text-sky-600" />
                    ) : (
                      <Building2 className="w-4 h-4 inline text-amber-600" />
                    )}
                  </td>
                  <td className={`${td} text-center`} onClick={() => alternar(c, 'cliente_flag')} onDoubleClick={(e) => e.stopPropagation()}>
                    <Badge texto="CLI" cor="#708090" ligado={c.cliente_flag === 'S'} />
                  </td>
                  <td className={`${td} text-center`} onClick={() => alternar(c, 'fornec_flag')} onDoubleClick={(e) => e.stopPropagation()}>
                    <Badge texto="FOR" cor="#708090" ligado={c.fornec_flag === 'S'} />
                  </td>
                  <td className={`${td} text-center`}>
                    <Badge texto={c.tem_contrato === 'S' ? 'SIM' : 'NÃO'} cor="#2E8B57" ligado={c.tem_contrato === 'S'} />
                  </td>
                  <td
                    className={`${td} text-center`}
                    title="Duplo clique: acertar as coordenadas no mapa"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      abrirMapaUnico(c);
                    }}
                  >
                    {c.tem_coordenadas === 'S' ? <MapPin className="w-4 h-4 inline text-emerald-600" /> : <span className="inline-block w-4" />}
                  </td>
                  <td className={`${td} text-center`} onDoubleClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      title={c.obs ? String(c.obs).slice(0, 300) : 'Observações'}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelId(c.id);
                        setObs(c);
                      }}
                      className={`px-1.5 rounded border text-[11px] font-bold leading-4 cursor-pointer ${
                        c.obs ? 'border-blue-300 text-blue-700 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800' : 'border-stone-300 text-stone-500 dark:border-stone-700'
                      }`}
                    >
                      …
                    </button>
                  </td>
                  {COLUNAS_TEXTO.map((col) => {
                    const v = col.valor ? col.valor(c) : String(c[col.campo] ?? '');
                    return (
                      <td key={col.campo} className={`${td} ${col.campo === 'id' ? 'text-right font-mono' : ''} ${col.largura ?? ''} truncate`} title={v.length > 25 ? v : undefined}>
                        {v}
                      </td>
                    );
                  })}
                  <td className={td} />
                  <td className={`${td} sticky right-0 z-[5] bg-inherit text-center border-l border-stone-200 dark:border-stone-800`} onDoubleClick={(e) => e.stopPropagation()}>
                    <MenuAcoes>
                      <BotaoAcao icone={MessageSquareText} titulo="Observações" descricao="Observações do cliente" onClick={() => setObs(c)} />
                      <BotaoAcao
                        icone={FileText}
                        titulo="Contrato"
                        descricao="Contrato HTML do cliente"
                        onClick={() => {
                          setSelId(c.id);
                          setAba('contrato');
                        }}
                      />
                      <BotaoAcao
                        icone={Package}
                        titulo="Inventário"
                        descricao="Produtos em posse do cliente"
                        onClick={() => {
                          setSelId(c.id);
                          setAba('inventario');
                        }}
                      />
                      <BotaoAcao icone={MapPin} titulo="Acertar coordenadas" descricao="Posição do cliente no mapa" onClick={() => abrirMapaUnico(c)} />
                      <SeparadorAcoes />
                      <BotaoAcao icone={Pencil} titulo="Editar" descricao="Abre o cadastro do cliente" onClick={() => setEditando({ registro: c })} />
                      <BotaoAcao icone={Trash2} titulo="Excluir" descricao="Exclui o cliente (pede confirmação)" tom="perigo" onClick={() => setExcluindo(c)} />
                    </MenuAcoes>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/40 flex items-center justify-between gap-3 shrink-0 text-[11px] text-stone-500 dark:text-stone-400">
        <span>
          {total ? `${(pagina - 1) * POR_PAGINA + 1}–${Math.min(pagina * POR_PAGINA, total)} de ${total} cliente(s)` : 'Nenhum registro'} · clique em ".", CLI ou FOR para alternar
        </span>
        {totalPaginas > 1 && (
          <div className="flex items-center gap-1.5">
            <span>
              Página {pagina} de {totalPaginas}
            </span>
            <button type="button" onClick={() => setPagina((p) => p - 1)} disabled={pagina <= 1} className="p-1 rounded border border-stone-300 dark:border-stone-700 disabled:opacity-40 cursor-pointer">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => setPagina((p) => p + 1)} disabled={pagina >= totalPaginas} className="p-1 rounded border border-stone-300 dark:border-stone-700 disabled:opacity-40 cursor-pointer">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {sel && <ContratosDoCliente cliente={sel} versao={versaoDetalhe} />}

      {editando && (
        <FormCliente
          registro={editando.registro}
          opcoes={opcoes}
          onFechar={() => setEditando(null)}
          onGravou={(id) => {
            onToast(editando.registro ? 'Cliente atualizado.' : 'Cliente incluído.');
            setEditando(null);
            invalidateOptions('pessoas');
            carregar(id);
          }}
        />
      )}
      {obs && (
        <Observacoes
          cliente={obs}
          onFechar={() => setObs(null)}
          onGravou={() => {
            setObs(null);
            carregar();
          }}
        />
      )}
      {excluindo && (
        <ConfirmDialog
          titulo="Excluir cliente?"
          mensagem={
            <>
              <strong className="text-stone-700 dark:text-stone-200">{excluindo.nome}</strong> (nº {excluindo.id}) será removido definitivamente.
            </>
          }
          onConfirmar={async () => {
            await deleteRecord('pessoas', excluindo.id);
            invalidateOptions('pessoas');
            onToast('Cliente excluído.');
            setExcluindo(null);
            carregar();
          }}
          onCancelar={() => setExcluindo(null)}
        />
      )}
    </div>
  );
};

export const TELAS_CLIENTES: Record<string, Tela> = {
  clientes: { componente: TelaClientes, titulo: ['Clientes / Fornecedores', 'Clientes e fornecedores, contrato, mapa e inventário'] },
};
