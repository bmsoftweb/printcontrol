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
import { GradeLista, type ColunaLista } from '../components/GradeLista';
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

/** Texto da célula com dica quando é longo (a grade corta com reticências) */
const texto = (v: unknown) => {
  const t = String(v ?? '');
  return <span title={t.length > 25 ? t : undefined}>{t}</span>;
};

/** Colunas de texto da grade de clientes (as primeiras, com ícones e etiquetas, ficam na tela) */
const COLUNAS_TEXTO: ColunaLista<Cliente>[] = (
  [
    { id: 'id', titulo: 'ID', alinhar: 'dir', classe: () => 'font-mono' },
    { id: 'banco', titulo: 'Banco' },
    { id: 'plano', titulo: 'Cobrança' },
    { id: 'nome', titulo: 'Nome', largura: 260, fixa: true },
    { id: 'fantasia', titulo: 'Fantasia', largura: 200 },
    { id: 'endereco_cidade', titulo: 'Cidade' },
    { id: 'cpf_cnpj', titulo: 'CPF/CNPJ', render: (c) => formataCnpj(c.cpf_cnpj) },
    { id: 'endereco', titulo: 'Endereço', largura: 220 },
    { id: 'endereco_nr', titulo: 'Nr.' },
    { id: 'endereco_complemento', titulo: 'Complemento', largura: 160 },
    { id: 'endereco_bairro', titulo: 'Bairro' },
    { id: 'endereco_uf', titulo: 'UF', alinhar: 'centro' },
    { id: 'endereco_cep', titulo: 'CEP' },
    { id: 'endereco_id_cidade', titulo: 'ID Cidade', alinhar: 'dir', oculta: true },
    { id: 'regiao', titulo: 'Região' },
    { id: 'rg', titulo: 'RG/IE' },
    { id: 'fone_fixo', titulo: 'Fone (1)' },
    { id: 'fone_celular1', titulo: 'Fone (2)' },
    { id: 'fone_celular2', titulo: 'Fone (3)' },
    { id: 'email', titulo: 'e-Mail', largura: 220 },
    { id: 'tem_senha', titulo: 'Senha', render: (c) => (c.tem_senha === 'S' ? '••••••' : ''), oculta: true },
    { id: 'id_integracao', titulo: 'Integração', oculta: true },
    { id: 'representante_legal_nome', titulo: 'Nome Repres. Legal', largura: 200, oculta: true },
    { id: 'representante_legal_cpf', titulo: 'CPF Repres. Legal', oculta: true },
    { id: 'obs_nf', titulo: 'Observação para NF', largura: 260, oculta: true },
  ] as ColunaLista<Cliente>[]
).map((c) => ({ render: (r: Cliente) => texto(r[c.id]), ...c }));

const data = (v: unknown) => (v ? formatDateBR(v as string) : '');

/** Grade "Lista de Equipamentos": contratos de locação do cliente selecionado (somente leitura) */
const COLUNAS_CONTRATOS: ColunaLista<Cliente>[] = (
  [
    { id: 'ativo', titulo: 'Ativo', alinhar: 'centro', render: (c) => <Badge texto={c.ativo === 'S' ? 'SIM' : 'NÃO'} cor="#2E8B57" ligado={c.ativo === 'S'} /> },
    { id: 'marca_descricao', titulo: 'Marca', campo: 'marca_descricao' },
    { id: 'modelo', titulo: 'Modelo', campo: 'modelo' },
    { id: 'setor', titulo: 'Setor', campo: 'setor' },
    { id: 'nr_serie', titulo: 'Série', campo: 'nr_serie' },
    { id: 'valor_contrato', titulo: 'Valor Contrato R$', alinhar: 'dir', render: (c) => moeda(c.valor_contrato, 2) },
    { id: 'valor_copia', titulo: 'Valor Cópia R$', alinhar: 'dir', render: (c) => moeda(c.valor_copia, 5) },
    { id: 'valor_excedente', titulo: 'Valor Excedente R$', alinhar: 'dir', render: (c) => moeda(c.valor_excedente, 5) },
    { id: 'data_contrato', titulo: 'Data Contrato', alinhar: 'centro', render: (c) => data(c.data_contrato) },
    { id: 'data_vencimento', titulo: 'Validade', alinhar: 'centro', render: (c) => data(c.data_vencimento) },
    { id: 'obs', titulo: 'Observações', largura: 300, render: (c) => <span title={c.obs ?? ''}>{c.obs}</span> },
  ] as ColunaLista<Cliente>[]
).map((c) => ({ ...c, classe: (r: Cliente) => `${c.alinhar === 'dir' ? 'font-mono' : ''} ${r.ativo === 'S' ? '' : '!text-stone-400'}` }));

const ContratosDoCliente: React.FC<{ cliente: Cliente; versao: number; onToast: (m: string) => void }> = ({ cliente, versao, onToast }) => {
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
      <GradeLista nome="clientes.contratos" colunas={COLUNAS_CONTRATOS} linhas={lista ?? []} carregando={!lista && !erro} vazio="Nenhum contrato de locação." onToast={onToast} />
    </div>
  );
};

/** Aba Inventário: produtos em posse do cliente */
const COLUNAS_INVENTARIO: ColunaLista<Cliente>[] = [
  { id: 'apelido_grupo', titulo: 'Grupo', campo: 'apelido_grupo' },
  { id: 'apelido_empresa', titulo: 'Empresa', campo: 'apelido_empresa' },
  { id: 'id_produto', titulo: 'ID Prod', campo: 'id_produto', alinhar: 'dir', classe: () => 'font-mono' },
  { id: 'descricao', titulo: 'Produto', campo: 'descricao' },
  { id: 'marca_descricao', titulo: 'Marca', campo: 'marca_descricao' },
  { id: 'modelo_descricao', titulo: 'Modelo', campo: 'modelo_descricao' },
  { id: 'setor', titulo: 'Setor', campo: 'setor' },
  { id: 'qtdade', titulo: 'Qtdade', alinhar: 'dir', classe: () => 'font-mono', render: (p) => Number(p.qtdade ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 }) },
];

const Inventario: React.FC<{ cliente: Cliente; onVoltar: () => void; onToast: (m: string) => void }> = ({ cliente, onVoltar, onToast }) => {
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
      <GradeLista nome="clientes.inventario" colunas={COLUNAS_INVENTARIO} linhas={lista ?? []} carregando={!lista && !erro} vazio="Nenhum produto em posse do cliente." onToast={onToast} />
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

  if (aba === 'inventario' && sel) return <Inventario cliente={sel} onVoltar={() => setAba('lista')} onToast={onToast} />;
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
  /** Clique que grava na hora: não seleciona nem abre a linha */
  const clique = (fn: () => void) => ({
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      fn();
    },
    onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
  });
  const ALVO = 'flex items-center justify-center w-full cursor-pointer';

  const colunas: ColunaLista<Cliente>[] = [
    {
      id: 'fj',
      titulo: '.',
      rotulo: 'Física/Jurídica',
      dica: 'Pessoa física / jurídica (clique para alternar)',
      alinhar: 'centro',
      render: (c) => (
        <span {...clique(() => alternar(c, 'fj'))} className={ALVO} title={c.fj === 'F' ? 'Pessoa física (clique: jurídica)' : 'Pessoa jurídica (clique: física)'}>
          {carregandoToggle(c, 'fj') ? (
            <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
          ) : c.fj === 'F' ? (
            <User className="w-4 h-4 text-sky-600" />
          ) : (
            <Building2 className="w-4 h-4 text-amber-600" />
          )}
        </span>
      ),
    },
    {
      id: 'cliente_flag',
      titulo: 'CLI',
      dica: 'Cliente (clique para alternar)',
      alinhar: 'centro',
      render: (c) => (
        <span {...clique(() => alternar(c, 'cliente_flag'))} className={ALVO}>
          <Badge texto="CLI" cor="#708090" ligado={c.cliente_flag === 'S'} />
        </span>
      ),
    },
    {
      id: 'fornec_flag',
      titulo: 'FOR',
      dica: 'Fornecedor (clique para alternar)',
      alinhar: 'centro',
      render: (c) => (
        <span {...clique(() => alternar(c, 'fornec_flag'))} className={ALVO}>
          <Badge texto="FOR" cor="#708090" ligado={c.fornec_flag === 'S'} />
        </span>
      ),
    },
    {
      id: 'tem_contrato',
      titulo: 'Contrato',
      alinhar: 'centro',
      render: (c) => <Badge texto={c.tem_contrato === 'S' ? 'SIM' : 'NÃO'} cor="#2E8B57" ligado={c.tem_contrato === 'S'} />,
    },
    {
      id: 'coordenadas',
      titulo: '',
      rotulo: 'Coordenadas',
      dica: 'Coordenadas (duplo clique: acertar no mapa)',
      alinhar: 'centro',
      render: (c) => (
        <span
          className={ALVO}
          title="Duplo clique: acertar as coordenadas no mapa"
          onDoubleClick={(e) => {
            e.stopPropagation();
            abrirMapaUnico(c);
          }}
        >
          {c.tem_coordenadas === 'S' ? <MapPin className="w-4 h-4 text-emerald-600" /> : <span className="inline-block w-4 h-4" />}
        </span>
      ),
    },
    {
      id: 'obs',
      titulo: 'Obs.',
      alinhar: 'centro',
      render: (c) => (
        <button
          type="button"
          title={c.obs ? String(c.obs).slice(0, 300) : 'Observações'}
          {...clique(() => {
            setSelId(c.id);
            setObs(c);
          })}
          className={`px-1.5 rounded border text-[11px] font-bold leading-4 cursor-pointer ${
            c.obs ? 'border-blue-300 text-blue-700 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800' : 'border-stone-300 text-stone-500 dark:border-stone-700'
          }`}
        >
          …
        </button>
      ),
    },
    ...COLUNAS_TEXTO,
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
      {/* Barra: Novo, filtros (linha de filtro da grade do Delphi) e ações */}
      <div className="px-4 py-2.5 border-b border-stone-200 dark:border-stone-800 flex flex-wrap items-center gap-2">
        <button type="button" className={BOTAO_PRIMARIO} onClick={() => setEditando({ registro: null })}>
          <Plus className="w-4 h-4" />
          Novo
        </button>
        <input
          className={`${INPUT_CLASS} w-20 font-mono`}
          placeholder="ID"
          inputMode="numeric"
          value={filtro.id}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setFiltro({ ...filtro, id: e.target.value.replace(/\D/g, '').slice(0, 9) })}
          aria-label="Filtrar por ID"
        />
        <input
          className={`${INPUT_CLASS} w-56 uppercase`}
          placeholder="Nome (começa com)"
          value={filtro.nome}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setFiltro({ ...filtro, nome: e.target.value.toUpperCase() })}
          aria-label="Filtrar por nome"
        />
        <input
          className={`${INPUT_CLASS} w-40 font-mono`}
          placeholder="CPF/CNPJ"
          inputMode="numeric"
          value={filtro.cpf}
          onFocus={(e) => e.target.select()}
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
          <button type="button" title="Limpar os filtros" onClick={() => setFiltro(FILTRO_VAZIO)} className="h-[38px] px-2 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
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
        </div>
      </div>

      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3" />}

      <GradeLista
        nome="clientes.lista"
        colunas={colunas}
        linhas={rows}
        selecionado={selId}
        onSelecionar={(c) => setSelId(c.id)}
        onDuploClique={(c) => setEditando({ registro: c })}
        carregando={carregando}
        onToast={onToast}
        vazio={
          <span className="text-stone-400">
            <Inbox className="w-8 h-8 mx-auto mb-2" />
            {temFiltro ? 'Nenhum cliente corresponde aos filtros.' : 'Nenhum cliente cadastrado.'}
          </span>
        }
        acoes={(c) => (
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
        )}
      />

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

      {sel && <ContratosDoCliente cliente={sel} versao={versaoDetalhe} onToast={onToast} />}

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
