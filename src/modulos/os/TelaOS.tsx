import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCheck,
  ClipboardList,
  Cylinder,
  Eraser,
  Inbox,
  Loader2,
  Package,
  Pencil,
  Play,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  Tag,
  Trash2,
  Wrench,
  CircleCheck,
} from 'lucide-react';
import type { TelaProps } from '../tipos';
import type { OpcaoRef, RegistroCrud } from '../../types';
import { api, createRecord, deleteRecord, updateRecord } from '../../services/api';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from '../../components/Janela';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { BotaoAcao, MenuAcoes, SeparadorAcoes } from '../../components/MenuAcoes';
import { SelectBusca } from '../../components/SelectBusca';
import { DateField } from '../../components/DateField';
import { NumberField } from '../../components/NumberField';
import { AvisoErro } from '../../components/AvisoErro';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../../utils/formStyles';
import { Badge, Barra, CAMPO, ColunaGrade, FiltroStatus, Grade, abrirPdf, dataBR, dataHoraBR, valorBR } from './comum';
import { iconeTipoOs } from './regras';

export interface Apoio {
  tipos: { id: string; descricao: string }[];
  clientes: { id: number; nome: string; cpf_cnpj: string; endereco_cidade: string }[];
  produtos: { id: number; descricao: string; descricao_curta: string; preco_venda: string }[];
}

const STATUS: Record<string, [string, string, boolean?]> = { A: ['ABERTO', '#DC143C'], E: ['EXECUTANDO', '#FFD700', true], F: ['FECHADO', '#4169E1'] };
const ICONES = { cartucho: Package, cilindro: Cylinder, requisicao: ClipboardList, servico: Wrench, recarga: RefreshCw };
const TITULO_ICONE = { cartucho: 'Requisição de cartucho', cilindro: 'Requisição de cilindro', requisicao: 'Requisição', servico: 'Serviço', recarga: 'Recarga' };

export const Campo: React.FC<{ rotulo: string; span?: string; dica?: string; children: React.ReactNode }> = ({ rotulo, span = '', dica, children }) => (
  <label className={`${FIELD_CLASS} ${span}`}>
    <span className={LABEL_CLASS}>{rotulo}</span>
    {children}
    {dica && <span className={HINT_CLASS}>{dica}</span>}
  </label>
);

const selecionarTudo = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();
const hojeIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

export const opcoesClientes = (a: Apoio | null): OpcaoRef[] => (a?.clientes ?? []).map((c) => ({ value: String(c.id), label: `${c.nome} (${c.id})` }));
export const opcoesProdutos = (a: Apoio | null): OpcaoRef[] => (a?.produtos ?? []).map((p) => ({ value: String(p.id), label: `${p.descricao} (${p.id})` }));

/** Contratos do cliente (pesquisa CON do Delphi) num select */
export const SelectContrato: React.FC<{ cliente: string; valor: string; onChange: (v: string) => void }> = ({ cliente, valor, onChange }) => {
  const [lista, setLista] = useState<any[]>([]);
  useEffect(() => {
    if (!cliente) return setLista([]);
    api.get(`/api/os/contratos?cliente=${encodeURIComponent(cliente)}`).then(setLista).catch(() => setLista([]));
  }, [cliente]);
  return (
    <select className={`${INPUT_CLASS} w-full`} value={valor} onChange={(e) => onChange(e.target.value)} disabled={!cliente} title={cliente ? undefined : 'OS tem que ter um cliente!'}>
      <option value="">{cliente ? '— Sem contrato —' : 'Escolha o cliente primeiro'}</option>
      {lista.map((c) => (
        <option key={c.id} value={String(c.id)}>
          #{c.id} · Equip. {c.id_equip ?? '—'} · {[c.marca, c.modelo].filter(Boolean).join(' ')}
          {c.setor ? ` · ${c.setor}` : ''}
          {c.nr_serie ? ` · Série ${c.nr_serie}` : ''}
        </option>
      ))}
    </select>
  );
};

const CAMPOS_TEXTO = ['nome_req', 'obs', 'defeito_cliente', 'defeito_constatado', 'servico_realizado', 'obs_interna'] as const;
const VALORES: [string, string][] = [
  ['valor_servicos', 'Vlr. Serviços'],
  ['valor_pecas', 'Vlr. Peças'],
  ['valor_terceiros', 'Vlr. Terceiros'],
  ['valor_total_bruto', 'Total Bruto'],
  ['valor_acrescimos', '+ Acresc.'],
  ['valor_descontos', '- Desc.'],
  ['valor_total_liquido', 'Total Líquido'],
];

/** Inclusão/edição da OS (a edição na grade do Delphi), com as pesquisas de cliente e de contrato */
const FormOS: React.FC<{ os: RegistroCrud | null; apoio: Apoio | null; onFechar: () => void; onGravado: (id: number) => void }> = ({ os, apoio, onFechar, onGravado }) => {
  const [v, setV] = useState<Record<string, string>>(() => {
    const ini: Record<string, string> = {};
    const campos = ['os_tipo', 'id_cliente', 'id_contrato', 'data_os', 'data_execucao', ...CAMPOS_TEXTO, ...VALORES.map(([c]) => c)];
    for (const c of campos) ini[c] = os?.[c] === null || os?.[c] === undefined ? '' : String(os[c]);
    if (!os) Object.assign(ini, { os_tipo: 'C', data_os: hojeIso() });
    return ini;
  });
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const muda = (c: string, valor: string) => setV((x) => ({ ...x, [c]: valor }));

  useEffect(() => {
    if (os) return;
    const id = requestAnimationFrame(() => document.getElementById('os-cliente')?.focus());
    return () => cancelAnimationFrame(id);
  }, [os]);

  const gravar = async (e: React.FormEvent) => {
    e.preventDefault();
    setGravando(true);
    setErro(null);
    try {
      const payload: RegistroCrud = { ...v, id_contrato: v.id_contrato || null };
      if (os) {
        await updateRecord('os', os.id, payload);
        onGravado(Number(os.id));
      } else onGravado(Number((await createRecord('os', payload)).id));
    } catch (err: any) {
      setErro(err.message);
      setGravando(false);
    }
  };

  const texto = (c: string, rotulo: string, span = 'sm:col-span-2', max = 255) => (
    <Campo rotulo={rotulo} span={span}>
      <input className={INPUT_CLASS} value={v[c]} maxLength={max} onChange={(e) => muda(c, e.target.value)} onFocus={selecionarTudo} />
    </Campo>
  );
  const area = (c: string, rotulo: string) => (
    <Campo rotulo={rotulo} span="sm:col-span-4">
      <textarea className={`${INPUT_CLASS} min-h-[56px]`} value={v[c]} maxLength={255} onChange={(e) => muda(c, e.target.value)} />
    </Campo>
  );

  return (
    <Janela
      titulo={os ? `OS nº ${os.id}` : 'Nova OS'}
      subtitulo={os ? `${os.cliente_nome ?? ''} — ${STATUS[os.status]?.[0] ?? os.status}` : 'Ordem de serviço da empresa ativa'}
      onFechar={onFechar}
      largura="max-w-4xl"
      ocupado={gravando}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={gravando}>
            Cancelar
          </button>
          <button type="submit" form="form-os" className={BOTAO_PRIMARIO} disabled={gravando}>
            {gravando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Gravar
          </button>
        </>
      }
    >
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <form id="form-os" onSubmit={gravar} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Campo rotulo="Tipo">
          <select className={INPUT_CLASS} required value={v.os_tipo} onChange={(e) => muda('os_tipo', e.target.value)}>
            {(apoio?.tipos ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} - {t.descricao}
              </option>
            ))}
            {!apoio?.tipos.some((t) => t.id === v.os_tipo) && <option value={v.os_tipo}>{v.os_tipo}</option>}
          </select>
        </Campo>
        <Campo rotulo="Cliente" span="sm:col-span-3">
          <SelectBusca
            id="os-cliente"
            required
            value={v.id_cliente}
            options={opcoesClientes(apoio)}
            onChange={(x) => setV((s) => ({ ...s, id_cliente: x, id_contrato: '' }))}
            vazioLabel="Pesquise pelo nome ou código"
          />
        </Campo>
        <Campo rotulo="Contrato / equipamento" span="sm:col-span-4">
          <SelectContrato cliente={v.id_cliente} valor={v.id_contrato} onChange={(x) => muda('id_contrato', x)} />
        </Campo>
        {texto('nome_req', 'Requisitado por', 'sm:col-span-2', 50)}
        <Campo rotulo="Data OS">
          <DateField className={CAMPO} value={v.data_os} onChange={(x) => muda('data_os', x)} />
        </Campo>
        <Campo rotulo="Execução">
          <DateField className={CAMPO} value={v.data_execucao} onChange={(x) => muda('data_execucao', x)} />
        </Campo>
        {texto('obs', 'Observação', 'sm:col-span-4')}
        {area('defeito_cliente', 'Relatado pelo cliente')}
        {area('defeito_constatado', 'Constatado')}
        {area('servico_realizado', 'Serviço realizado')}
        {area('obs_interna', 'Observação interna')}
        {VALORES.map(([c, rotulo]) => (
          <Campo key={c} rotulo={rotulo}>
            <NumberField className={CAMPO} value={v[c]} scale={2} onChange={(x) => muda(c, x)} />
          </Campo>
        ))}
      </form>
    </Janela>
  );
};

/** Peça / produto / serviço da OS */
const FormPeca: React.FC<{ os: RegistroCrud; peca: RegistroCrud | null; apoio: Apoio | null; tecnico: boolean; onFechar: () => void; onGravado: () => void }> = ({
  os,
  peca,
  apoio,
  tecnico,
  onFechar,
  onGravado,
}) => {
  const qtdPadrao = Math.trunc(Number(os.qtdade_os) || 0) > 0 ? String(Math.trunc(Number(os.qtdade_os))) : '1';
  const [v, setV] = useState<Record<string, string>>(() => ({
    id_produto: peca?.id_produto ? String(peca.id_produto) : '',
    qtdade: peca ? String(peca.qtdade ?? '') : qtdPadrao,
    qtdade_entregue: peca ? String(peca.qtdade_entregue ?? '0') : '0',
    valor_unit: peca ? String(peca.valor_unit ?? '0') : '0',
    obs: peca?.obs ?? '',
    nr_serie: peca?.nr_serie ?? '',
  }));
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const muda = (c: string, valor: string) => setV((x) => ({ ...x, [c]: valor }));
  const total = Math.round((Number(v.qtdade_entregue) || 0) * (Number(v.valor_unit) || 0) * 100) / 100;

  // Novo: abre já na pesquisa do produto (como o Delphi)
  useEffect(() => {
    if (peca) return;
    const id = requestAnimationFrame(() => document.getElementById('peca-produto')?.focus());
    return () => cancelAnimationFrame(id);
  }, [peca]);

  const gravar = async (e: React.FormEvent) => {
    e.preventDefault();
    setGravando(true);
    setErro(null);
    try {
      const payload: RegistroCrud = { ...v, nr_serie: v.nr_serie || null, obs: v.obs || null };
      if (peca) await updateRecord('os_pecas', peca.id, payload);
      else await createRecord('os_pecas', { ...payload, id_os: os.id });
      onGravado();
    } catch (err: any) {
      setErro(err.message);
      setGravando(false);
    }
  };

  return (
    <Janela
      titulo={peca ? `Peça nº ${peca.id}` : 'Nova peça / produto / serviço'}
      subtitulo={`OS nº ${os.id} — ${os.cliente_nome ?? ''}${Number(os.qtdade_os) > 0 ? ` — solicitado: ${valorBR(os.qtdade_os, ',0.##')}` : ''}`}
      onFechar={onFechar}
      largura="max-w-2xl"
      ocupado={gravando}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={gravando}>
            Cancelar
          </button>
          <button type="submit" form="form-peca" className={BOTAO_PRIMARIO} disabled={gravando}>
            {gravando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Gravar
          </button>
        </>
      }
    >
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <form id="form-peca" onSubmit={gravar} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Campo rotulo="Produto" span="sm:col-span-4">
          <SelectBusca
            id="peca-produto"
            value={v.id_produto}
            options={opcoesProdutos(apoio)}
            onChange={(x) => {
              const p = apoio?.produtos.find((p) => String(p.id) === x);
              setV((s) => ({ ...s, id_produto: x, valor_unit: p ? String(p.preco_venda ?? '0') : s.valor_unit }));
            }}
            vazioLabel="Pesquise pelo nome ou código"
          />
        </Campo>
        <Campo rotulo="Qtd.">
          <NumberField className={CAMPO} value={v.qtdade} scale={2} required onChange={(x) => muda('qtdade', x)} />
        </Campo>
        <Campo rotulo="Qtd. Entregue" dica={tecnico ? 'Técnico: igual à quantidade' : undefined}>
          <NumberField className={CAMPO} value={v.qtdade_entregue} scale={2} onChange={(x) => muda('qtdade_entregue', x)} />
        </Campo>
        <Campo rotulo="Vlr. Unit.">
          <NumberField className={CAMPO} value={v.valor_unit} scale={4} onChange={(x) => muda('valor_unit', x)} />
        </Campo>
        <Campo rotulo="Vlr. Total" dica="Qtd. entregue × unitário">
          <input className={`${INPUT_CLASS} text-right`} readOnly value={valorBR(total)} />
        </Campo>
        <Campo rotulo="Observação" span="sm:col-span-3">
          <input className={INPUT_CLASS} value={v.obs} maxLength={255} onChange={(e) => muda('obs', e.target.value)} onFocus={selecionarTudo} />
        </Campo>
        <Campo rotulo="Nr. Série" dica="Normalmente pelo VOID">
          <input className={INPUT_CLASS} value={v.nr_serie} maxLength={25} onChange={(e) => muda('nr_serie', e.target.value)} onFocus={selecionarTudo} />
        </Campo>
      </form>
    </Janela>
  );
};

/** OS - Finalização */
const Finalizar: React.FC<{ os: RegistroCrud; onFechar: () => void; onGravado: () => void }> = ({ os, onFechar, onGravado }) => {
  const [v, setV] = useState({ data_execucao: hojeIso(), defeito_constatado: os.defeito_constatado ?? '', servico_realizado: os.servico_realizado ?? '' });
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const gravar = async () => {
    setGravando(true);
    setErro(null);
    try {
      await api.post(`/api/os/${os.id}/finalizar`, v);
      onGravado();
    } catch (e: any) {
      setErro(e.message);
      setGravando(false);
    }
  };
  return (
    <Janela
      titulo="OS - Finalização"
      subtitulo={`OS nº ${os.id} — ${os.cliente_nome ?? ''}`}
      onFechar={onFechar}
      ocupado={gravando}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={gravando}>
            Cancelar
          </button>
          <button type="button" className={BOTAO_PRIMARIO} onClick={gravar} disabled={gravando}>
            {gravando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CircleCheck className="w-4 h-4" />}
            Gravar
          </button>
        </>
      }
    >
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <div className="grid gap-3">
        <Campo rotulo="Data Execução">
          <DateField className={CAMPO} value={v.data_execucao} required onChange={(x) => setV({ ...v, data_execucao: x })} />
        </Campo>
        <Campo rotulo="Defeito Constatado">
          <textarea className={`${INPUT_CLASS} min-h-[70px]`} maxLength={255} value={v.defeito_constatado} onChange={(e) => setV({ ...v, defeito_constatado: e.target.value })} />
        </Campo>
        <Campo rotulo="Serviço Realizado">
          <textarea className={`${INPUT_CLASS} min-h-[70px]`} maxLength={255} value={v.servico_realizado} onChange={(e) => setV({ ...v, servico_realizado: e.target.value })} />
        </Campo>
      </div>
    </Janela>
  );
};

/** Etiqueta VOID (nº de série do cartucho) */
const Void: React.FC<{ peca: RegistroCrud; onFechar: () => void; onGravado: () => void }> = ({ peca, onFechar, onGravado }) => {
  const [nr, setNr] = useState('');
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const gravar = async (e: React.FormEvent) => {
    e.preventDefault();
    setGravando(true);
    setErro(null);
    try {
      await api.post(`/api/os/pecas/${peca.id}/void`, { nr_serie: nr });
      onGravado();
    } catch (err: any) {
      setErro(err.message);
      setGravando(false);
    }
  };
  return (
    <Janela
      titulo="Etiqueta VOID"
      subtitulo={peca.produto_descricao}
      onFechar={onFechar}
      largura="max-w-md"
      ocupado={gravando}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={gravando}>
            Cancelar
          </button>
          <button type="submit" form="form-void" className={BOTAO_PRIMARIO} disabled={gravando || !nr.trim()}>
            {gravando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Gravar
          </button>
        </>
      }
    >
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <form id="form-void" onSubmit={gravar}>
        <Campo rotulo="Digite o Nr. da Etiqueta VOID:">
          <input autoFocus required className={`${INPUT_CLASS} text-center text-base`} maxLength={25} value={nr} onChange={(e) => setNr(e.target.value)} onFocus={selecionarTudo} />
        </Campo>
      </form>
    </Janela>
  );
};

/** OS Pendentes: pedidos dos clientes (Área do Cliente) → Gerar OS */
const Pendentes: React.FC<{ onFechar: () => void; onGerado: (ultima: number | null, msg: string) => void }> = ({ onFechar, onGerado }) => {
  const [lista, setLista] = useState<any[] | null>(null);
  const [desmarcados, setDesmarcados] = useState<Set<number>>(new Set());
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);

  const buscar = useCallback(() => {
    setLista(null);
    setDesmarcados(new Set());
    api.get('/api/os/pendentes').then(setLista).catch((e) => {
      setErro(e.message);
      setLista([]);
    });
  }, []);
  useEffect(buscar, [buscar]);

  const alternar = (id: number) =>
    setDesmarcados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const marcados = (lista ?? []).filter((r) => !desmarcados.has(r.id)).map((r) => r.id);

  const gerar = async () => {
    setGerando(true);
    setErro(null);
    try {
      const r = await api.post('/api/os/gerar', { ids: marcados });
      const msg = `${r.geradas.length} OS gerada(s) de ${r.pedidos} pedido(s).${r.avisos?.length ? ` ${r.avisos.join(' ')}` : ''}`;
      onGerado(r.geradas.length ? r.geradas[r.geradas.length - 1] : null, msg);
    } catch (e: any) {
      setErro(e.message);
      setGerando(false);
    }
  };

  const colunas: ColunaGrade<any>[] = [
    {
      chave: 'flag_gerar',
      titulo: 'Gerar',
      largura: 58,
      alinhar: 'centro',
      dica: 'Clique para marcar/desmarcar',
      render: (r) => (
        <button type="button" className="cursor-pointer" onClick={() => alternar(r.id)}>
          {desmarcados.has(r.id) ? <Badge texto="NÃO" /> : <Badge texto="SIM" />}
        </button>
      ),
    },
    { chave: 'tipo_os', titulo: 'Tipo OS', largura: 114, render: (r) => (r.tipo_os === 'R' ? <Badge texto="Req. Cartucho" cor="#DC143C" /> : r.tipo_os === 'C' ? <Badge texto="Serviço" cor="#4169E1" /> : '') },
    { chave: 'id_cliente', titulo: 'ID Cli', largura: 70, alinhar: 'dir' },
    { chave: 'cliente_nome', titulo: 'Cliente', largura: 200 },
    { chave: 'equip_descricao', titulo: 'Equipamento', largura: 200 },
    { chave: 'qtdade', titulo: 'Qtd.Cart.', largura: 81, alinhar: 'centro', render: (r) => valorBR(r.qtdade, ',0.##') },
    { chave: 'qtdade_cil', titulo: 'Qtd.Cil.', largura: 81, alinhar: 'centro', render: (r) => valorBR(r.qtdade_cil, ',0.##') },
    { chave: 'nome_req', titulo: 'Requisitado por:', largura: 100 },
    { chave: 'datahora_os', titulo: 'Incluído em:', largura: 150, alinhar: 'centro', render: (r) => dataHoraBR(r.datahora_os) },
    { chave: 'obs', titulo: 'Observação', largura: 200 },
  ];

  return (
    <Janela
      titulo="OS Pendentes"
      subtitulo="Pedidos de OS feitos pelos clientes; duplo clique ou clique em Gerar para marcar/desmarcar"
      onFechar={onFechar}
      largura="max-w-6xl"
      ocupado={gerando}
      rodape={
        <>
          <span className="mr-auto text-xs text-stone-500">
            {lista ? `${lista.length} pendente(s), ${marcados.length} marcado(s)` : ''}
          </span>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={buscar} disabled={gerando}>
            <Search className="w-4 h-4" />
            Buscar OS pendentes
          </button>
          <button type="button" className={BOTAO_PRIMARIO} onClick={gerar} disabled={gerando || !marcados.length}>
            {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Gerar OS
          </button>
        </>
      }
    >
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <div className="h-[55vh] flex flex-col border border-stone-200 dark:border-stone-800 rounded-lg">
        <Grade colunas={colunas} linhas={lista ?? []} carregando={!lista} selecionado={sel ?? undefined} onSelecionar={(r) => setSel(r.id)} onDuploClique={(r) => alternar(r.id)} vazio="Nenhuma OS pendente." />
      </div>
    </Janela>
  );
};

type Confirmacao = { titulo: string; mensagem: React.ReactNode; confirmar: string; tom?: 'perigo' | 'normal'; acao: () => Promise<void> };

/** Ordens de Serviço (ufrmOS): grade mestre com as OS e, embaixo, as peças da OS selecionada */
export const TelaOS: React.FC<TelaProps> = ({ usuario, onToast, refreshToken }) => {
  const tecnico = String(usuario.nivel || 'Z').toUpperCase() >= 'T';
  const [status, setStatus] = useState('A');
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [selId, setSelId] = useState<number | null>(null);
  const [marcadas, setMarcadas] = useState<Set<number>>(new Set());
  const [pecas, setPecas] = useState<any[]>([]);
  const [carregandoPecas, setCarregandoPecas] = useState(false);
  const [selPeca, setSelPeca] = useState<number | null>(null);
  const [apoio, setApoio] = useState<Apoio | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [formOs, setFormOs] = useState<{ os: RegistroCrud | null } | null>(null);
  const [formPeca, setFormPeca] = useState<{ peca: RegistroCrud | null } | null>(null);
  const [finalizando, setFinalizando] = useState<RegistroCrud | null>(null);
  const [voidPeca, setVoidPeca] = useState<RegistroCrud | null>(null);
  const [pendentes, setPendentes] = useState(false);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  /** Depois de gravar/gerar, posiciona nesta OS (o Delphi ia para o último registro) */
  const irPara = useRef<number | 'ultimo' | null>('ultimo');

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const rows = await api.get<any[]>(`/api/os/lista?status=${status}`);
      setLista(rows);
      const alvo = irPara.current;
      irPara.current = null;
      setSelId((atual) => {
        if (alvo === 'ultimo') return rows.length ? rows[rows.length - 1].id : null;
        if (alvo && rows.some((r) => r.id === alvo)) return alvo;
        return atual && rows.some((r) => r.id === atual) ? atual : rows.length ? rows[rows.length - 1].id : null;
      });
      setMarcadas((m) => new Set([...m].filter((id) => rows.some((r) => r.id === id))));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [status]);

  useEffect(() => {
    carregar();
  }, [carregar, refreshToken]);

  useEffect(() => {
    api.get<Apoio>('/api/os/apoio').then(setApoio).catch((e) => setErro(e.message));
  }, [refreshToken]);

  const os = useMemo(() => lista.find((r) => r.id === selId) ?? null, [lista, selId]);

  const carregarPecas = useCallback(async () => {
    if (!selId) return setPecas([]);
    setCarregandoPecas(true);
    try {
      setPecas(await api.get(`/api/os/${selId}/pecas`));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregandoPecas(false);
    }
  }, [selId]);
  useEffect(() => {
    carregarPecas();
  }, [carregarPecas, refreshToken]);

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return lista;
    return lista.filter((r) =>
      [r.id, r.cliente_nome, r.obs, r.nome_req, r.marca_descricao, r.modelo, r.setor, r.defeito_cliente, r.tipo_descricao].some((x) => String(x ?? '').toLowerCase().includes(t)),
    );
  }, [lista, busca]);

  /** Ação que grava e recarrega, com o erro na tela */
  const executar = async (rotulo: string, fn: () => Promise<unknown>, msg?: string) => {
    setOcupado(rotulo);
    setErro(null);
    try {
      await fn();
      if (msg) onToast(msg);
      await carregar();
      await carregarPecas();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setOcupado(null);
    }
  };

  const executarOs = (o: RegistroCrud) => executar('executar', () => api.post(`/api/os/${o.id}/executar`), `OS ${o.id} em execução.`);
  const imprimir = (o: RegistroCrud) => {
    const lista = [...marcadas];
    executar('imprimir', () => abrirPdf(`/api/os/${o.id}/imprimir${lista.length ? `?marcadas=${lista.join(',')}` : ''}`));
  };
  const excluirOs = (o: RegistroCrud) =>
    setConfirmacao({
      titulo: 'Excluir OS',
      mensagem: (
        <>
          Excluir a OS nº <b>{o.id}</b> de {o.cliente_nome ?? 'cliente não informado'}
          {o.id === selId && pecas.length ? ` e as ${pecas.length} peça(s) dela` : ' e as peças dela'}?
        </>
      ),
      confirmar: 'Excluir',
      acao: async () => {
        await deleteRecord('os', o.id);
        onToast(`OS ${o.id} excluída.`);
        setConfirmacao(null);
        await carregar();
      },
    });

  const alternarMarca = (id: number) =>
    setMarcadas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const colunas: ColunaGrade<any>[] = [
    {
      chave: 'flag_impressao',
      titulo: <Printer className="w-3.5 h-3.5 inline" />,
      dica: 'Marque para Imprimir',
      largura: 48,
      alinhar: 'centro',
      render: (r) => <input type="checkbox" className="cursor-pointer accent-blue-600" checked={marcadas.has(r.id)} onChange={() => alternarMarca(r.id)} onClick={(e) => e.stopPropagation()} />,
    },
    { chave: 'status', titulo: 'Status', largura: 110, alinhar: 'centro', render: (r) => (STATUS[r.status] ? <Badge texto={STATUS[r.status][0]} cor={STATUS[r.status][1]} escuro={STATUS[r.status][2]} /> : r.status) },
    { chave: 'status_impressao', titulo: 'Impressão', largura: 83, alinhar: 'centro', render: (r) => (r.status_impressao === 'S' ? <Badge texto="SIM" /> : '') },
    { chave: 'id', titulo: 'ID#', largura: 70, alinhar: 'dir' },
    { chave: 'datahora_inclusao', titulo: 'Incluído em:', largura: 130, alinhar: 'centro', render: (r) => dataHoraBR(r.datahora_inclusao) },
    { chave: 'tipo_descricao', titulo: 'Tipo', largura: 100, render: (r) => r.tipo_descricao ?? r.os_tipo },
    {
      chave: 'os_tipo',
      titulo: '',
      largura: 60,
      alinhar: 'centro',
      render: (r) => {
        const ic = iconeTipoOs(r.os_tipo, r.obs);
        const Icone = ICONES[ic];
        return (
          <span className="inline-flex items-center gap-1" title={TITULO_ICONE[ic]}>
            <Icone className="w-4 h-4 text-stone-500" />
            {(ic === 'cartucho' || ic === 'cilindro') && <Badge texto={valorBR(r.qtdade_os, ',0.###')} />}
          </span>
        );
      },
    },
    { chave: 'id_cliente', titulo: 'ID cli', largura: 70, alinhar: 'dir' },
    { chave: 'cliente_nome', titulo: 'Cliente', largura: 180 },
    { chave: 'id_equip', titulo: 'ID Equip', largura: 70, alinhar: 'dir' },
    { chave: 'marca_descricao', titulo: 'Marca', largura: 100 },
    { chave: 'modelo', titulo: 'Modelo', largura: 100 },
    { chave: 'setor', titulo: 'Setor', largura: 100 },
    { chave: 'obs', titulo: 'Observação', largura: 150 },
    { chave: 'nome_req', titulo: 'Requisitado por:', largura: 120 },
    { chave: 'data_os', titulo: 'Data OS', largura: 95, alinhar: 'centro', render: (r) => dataBR(r.data_os) },
    { chave: 'data_execucao', titulo: 'Execução', largura: 95, alinhar: 'centro', render: (r) => dataBR(r.data_execucao) },
    { chave: 'defeito_cliente', titulo: 'Relatado pelo Cliente:', largura: 300 },
    { chave: 'defeito_constatado', titulo: 'Constatado', largura: 300 },
    { chave: 'servico_realizado', titulo: 'Serviço Realizado', largura: 300 },
    { chave: 'obs_interna', titulo: 'Observação Interna', largura: 300 },
    { chave: 'id_usuario_inclusao', titulo: 'Incluído por:', largura: 90, render: (r) => r.usuario_nome || r.id_usuario_inclusao },
    ...VALORES.map(([c, t]): ColunaGrade<any> => ({ chave: c, titulo: t, largura: 110, alinhar: 'dir', render: (r) => valorBR(r[c]) })),
    {
      chave: 'acoes',
      fixa: true,
      titulo: 'Ações',
      largura: 60,
      alinhar: 'centro',
      render: (r) => (
        <MenuAcoes>
          <BotaoAcao icone={Play} titulo="Executar" descricao="Passa a OS para Executando" onClick={() => executarOs(r)} />
          <BotaoAcao icone={CircleCheck} titulo="Finalizar" descricao="Data de execução, defeito constatado e serviço realizado" tom="verde" onClick={() => setFinalizando(r)} />
          <BotaoAcao icone={Printer} titulo="Imprimir OS" descricao="PDF da OS (ou das OS marcadas)" onClick={() => imprimir(r)} />
          <SeparadorAcoes />
          <BotaoAcao icone={Pencil} titulo="Editar" descricao="Alterar a OS" onClick={() => setFormOs({ os: r })} />
          <BotaoAcao icone={Trash2} titulo="Excluir" descricao="Excluir a OS e as peças" tom="perigo" onClick={() => excluirOs(r)} />
        </MenuAcoes>
      ),
    },
  ];

  const colunasPecas: ColunaGrade<any>[] = [
    { chave: 'id_produto', titulo: 'ID Pro', largura: 70, alinhar: 'dir' },
    { chave: 'produto_descricao', titulo: 'Produto', largura: 260 },
    { chave: 'qtdade', titulo: 'Qtd.', largura: 90, alinhar: 'dir', render: (r) => valorBR(r.qtdade) },
    { chave: 'qtdade_entregue', titulo: 'Qtd.Entregue', largura: 100, alinhar: 'dir', render: (r) => valorBR(r.qtdade_entregue) },
    { chave: 'valor_unit', titulo: 'Vlr. Unit.', largura: 100, alinhar: 'dir', render: (r) => valorBR(r.valor_unit, ',0.0000') },
    { chave: 'valor_total', titulo: 'Vlr. Total', largura: 100, alinhar: 'dir', render: (r) => valorBR(r.valor_total) },
    { chave: 'obs', titulo: 'Observação', largura: 300 },
    { chave: 'nr_serie', titulo: 'Nr. Série', largura: 120 },
    {
      chave: 'acoes',
      fixa: true,
      titulo: 'Ações',
      largura: 60,
      alinhar: 'centro',
      render: (p) => (
        <MenuAcoes>
          <BotaoAcao icone={Tag} titulo="VOID" descricao="Atribuir a etiqueta VOID (nº de série)" onClick={() => (p.nr_serie ? setErro('Nr. série já atribuido!') : setVoidPeca(p))} />
          <BotaoAcao
            icone={Eraser}
            titulo="Limpar VOID"
            descricao="Tira o nº de série da peça e libera a etiqueta"
            onClick={() =>
              p.nr_serie &&
              setConfirmacao({
                titulo: 'Limpar VOID',
                mensagem: (
                  <>
                    Tirar a etiqueta <b>{p.nr_serie}</b> da peça {p.produto_descricao}? A etiqueta fica livre (sem cliente e produto).
                  </>
                ),
                confirmar: 'Limpar',
                acao: async () => {
                  await api.post(`/api/os/pecas/${p.id}/limpar-void`);
                  setConfirmacao(null);
                  onToast('VOID removido.');
                  await carregarPecas();
                },
              })
            }
          />
          <SeparadorAcoes />
          <BotaoAcao icone={Pencil} titulo="Editar" descricao="Alterar a peça" onClick={() => setFormPeca({ peca: p })} />
          <BotaoAcao
            icone={Trash2}
            titulo="Excluir"
            descricao="Excluir a peça"
            tom="perigo"
            onClick={() =>
              setConfirmacao({
                titulo: 'Excluir peça',
                mensagem: (
                  <>
                    Excluir <b>{p.produto_descricao ?? `a peça ${p.id}`}</b> da OS nº {selId}?
                  </>
                ),
                confirmar: 'Excluir',
                acao: async () => {
                  await deleteRecord('os_pecas', p.id);
                  setConfirmacao(null);
                  await carregarPecas();
                },
              })
            }
          />
        </MenuAcoes>
      ),
    },
  ];

  const totalPecas = pecas.reduce((s, p) => s + (Number(p.valor_total) || 0), 0);
  const precisaOs = (fn: (o: RegistroCrud) => void) => () => (os ? fn(os) : setErro('Selecione uma OS.'));
  const statusOs = os?.status;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Barra>
        <FiltroStatus valor={status} opcoes={[['A', 'Aberto'], ['E', 'Executando'], ['F', 'Fechado'], ['T', 'Todos']]} onChange={(v) => { irPara.current = 'ultimo'; setStatus(v); }} />
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} onFocus={(e) => e.target.select()} placeholder="Filtrar nesta lista…" className={`${INPUT_CLASS} h-[38px] pl-8 w-56`} />
        </div>
        <span className="text-xs text-stone-500">{filtradas.length} OS{marcadas.size ? ` · ${marcadas.size} marcada(s) p/ imprimir` : ''}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button className={BOTAO_SECUNDARIO} onClick={() => setPendentes(true)}>
            <Inbox className="w-4 h-4" /> OS Pendentes
          </button>
          <button className={BOTAO_SECUNDARIO} disabled={!os || statusOs !== 'A' || !!ocupado} onClick={precisaOs(executarOs)} title="Passa a OS selecionada para Executando">
            {ocupado === 'executar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Executar
          </button>
          <button className={BOTAO_SECUNDARIO} disabled={!os || statusOs === 'F'} onClick={precisaOs(setFinalizando)} title="Finaliza a OS selecionada">
            <CircleCheck className="w-4 h-4" /> Finalizar
          </button>
          <button className={BOTAO_SECUNDARIO} disabled={!os || !!ocupado} onClick={precisaOs(imprimir)} title="PDF da OS selecionada; com OS marcadas, a entrega de cartuchos/cilindros das marcadas">
            {ocupado === 'imprimir' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />} Imprimir OS
          </button>
          <button className={BOTAO_PRIMARIO} onClick={() => setFormOs({ os: null })}>
            <Plus className="w-4 h-4" /> Nova OS
          </button>
        </div>
      </Barra>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3" />}

      <div className="flex-1 min-h-0 flex flex-col bg-white dark:bg-stone-900">
        <Grade colunas={colunas} linhas={filtradas} carregando={carregando} selecionado={selId ?? undefined} onSelecionar={(r) => setSelId(r.id)} onDuploClique={(r) => setFormOs({ os: r })} vazio="Nenhuma OS neste status." />
      </div>

      <div className="h-[260px] shrink-0 flex flex-col border-t-2 border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-stone-100 dark:border-stone-800">
          <span className="text-xs font-bold text-stone-700 dark:text-stone-200">Peças / Produtos / Serviços</span>
          {os && <span className="text-xs text-stone-500">OS nº {os.id} — {os.cliente_nome}</span>}
          <div className="ml-auto flex gap-2">
            <button
              className={BOTAO_SECUNDARIO}
              disabled={!os || !pecas.length || !!ocupado}
              onClick={precisaOs((o) => executar('entregar', () => api.post(`/api/os/${o.id}/entregar-todos`), 'Peças entregues.'))}
              title="Qtd. entregue = quantidade em todas as peças"
            >
              {ocupado === 'entregar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />} Entregar Todos
            </button>
            <button className={BOTAO_PRIMARIO} disabled={!os} onClick={() => setFormPeca({ peca: null })}>
              <Plus className="w-4 h-4" /> Nova peça
            </button>
          </div>
        </div>
        <Grade
          colunas={colunasPecas}
          linhas={pecas}
          carregando={carregandoPecas}
          selecionado={selPeca ?? undefined}
          onSelecionar={(p) => setSelPeca(p.id)}
          onDuploClique={(p) => setFormPeca({ peca: p })}
          vazio={os ? 'Nenhuma peça nesta OS.' : 'Selecione uma OS.'}
          rodape={
            pecas.length ? (
              <tr>
                <td colSpan={5} className="px-2.5 py-1.5 text-right text-xs font-semibold text-stone-500 border-t border-stone-200 dark:border-stone-800">
                  Total
                </td>
                <td className="px-2.5 py-1.5 text-right text-xs font-bold text-blue-900 dark:text-blue-300 border-t border-stone-200 dark:border-stone-800 whitespace-nowrap">R$ {valorBR(totalPecas)}</td>
                <td colSpan={3} className="border-t border-stone-200 dark:border-stone-800" />
              </tr>
            ) : undefined
          }
        />
      </div>

      {formOs && (
        <FormOS
          os={formOs.os}
          apoio={apoio}
          onFechar={() => setFormOs(null)}
          onGravado={(id) => {
            onToast(formOs.os ? `OS ${id} gravada.` : `OS ${id} incluída.`);
            setFormOs(null);
            irPara.current = id;
            carregar();
          }}
        />
      )}
      {formPeca && os && (
        <FormPeca
          os={os}
          peca={formPeca.peca}
          apoio={apoio}
          tecnico={tecnico}
          onFechar={() => setFormPeca(null)}
          onGravado={() => {
            setFormPeca(null);
            carregarPecas();
          }}
        />
      )}
      {finalizando && (
        <Finalizar
          os={finalizando}
          onFechar={() => setFinalizando(null)}
          onGravado={() => {
            onToast(`OS ${finalizando.id} finalizada.`);
            setFinalizando(null);
            irPara.current = Number(finalizando.id);
            carregar();
          }}
        />
      )}
      {voidPeca && (
        <Void
          peca={voidPeca}
          onFechar={() => setVoidPeca(null)}
          onGravado={() => {
            onToast('Etiqueta VOID gravada.');
            setVoidPeca(null);
            carregarPecas();
          }}
        />
      )}
      {pendentes && (
        <Pendentes
          onFechar={() => setPendentes(false)}
          onGerado={(ultima, msg) => {
            onToast(msg);
            setPendentes(false);
            irPara.current = ultima ?? 'ultimo';
            carregar();
          }}
        />
      )}
      {confirmacao && (
        <ConfirmDialog
          titulo={confirmacao.titulo}
          mensagem={confirmacao.mensagem}
          confirmar={confirmacao.confirmar}
          tom={confirmacao.tom}
          onConfirmar={confirmacao.acao}
          onCancelar={() => setConfirmacao(null)}
        />
      )}
    </div>
  );
};
