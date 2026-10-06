import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, Inbox, Loader2, Pencil, Plus, Printer, Save, Search, Trash2 } from 'lucide-react';
import type { TelaProps } from '../tipos';
import type { RegistroCrud } from '../../types';
import { api, createRecord, deleteRecord, updateRecord } from '../../services/api';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from '../../components/Janela';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { BotaoAcao, MenuAcoes, SeparadorAcoes } from '../../components/MenuAcoes';
import { SelectBusca } from '../../components/SelectBusca';
import { DateField } from '../../components/DateField';
import { NumberField } from '../../components/NumberField';
import { AvisoErro } from '../../components/AvisoErro';
import { INPUT_CLASS } from '../../utils/formStyles';
import { Badge, Barra, CAMPO, ColunaGrade, FiltroStatus, Grade, abrirPdf, dataBR, dataHoraBR, valorBR } from './comum';
import { Apoio, Campo, SelectContrato, opcoesClientes, opcoesProdutos } from './TelaOS';

const STATUS: Record<string, [string, string]> = { A: ['PENDENTE', '#DC143C'], I: ['ENTREGANDO', '#FFD700'], E: ['ENTREGUE', '#2E8B57'] };
const hojeIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const selecionarTudo = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

function Rodape({ gravando, onFechar, form }: { gravando: boolean; onFechar: () => void; form: string }) {
  return (
    <>
      <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={gravando}>
        Cancelar
      </button>
      <button type="submit" form={form} className={BOTAO_PRIMARIO} disabled={gravando}>
        {gravando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Gravar
      </button>
    </>
  );
}

/** Formulário em janela: grava pelo CRUD genérico (as regras do Delphi estão no servidor) */
function useGravacao(fn: () => Promise<void>) {
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const gravar = async (e: React.FormEvent) => {
    e.preventDefault();
    setGravando(true);
    setErro(null);
    try {
      await fn();
    } catch (err: any) {
      setErro(err.message);
      setGravando(false);
    }
  };
  return { gravando, erro, setErro, gravar };
}

const FormReq: React.FC<{ req: RegistroCrud | null; apoio: Apoio | null; onFechar: () => void; onGravado: (id: number) => void }> = ({ req, apoio, onFechar, onGravado }) => {
  const [v, setV] = useState({
    status: req?.status ?? 'A',
    data_req: req?.data_req ?? hojeIso(),
    data_entrega: req?.data_entrega ?? '',
    id_cliente: req?.id_cliente ? String(req.id_cliente) : '',
    obs: req?.obs ?? '',
  });
  const { gravando, erro, setErro, gravar } = useGravacao(async () => {
    const payload = { ...v, data_entrega: v.data_entrega || null, id_cliente: v.id_cliente || null };
    if (req) {
      await updateRecord('req', req.id, payload);
      onGravado(Number(req.id));
    } else onGravado(Number((await createRecord('req', payload)).id));
  });
  useEffect(() => {
    if (req) return;
    const id = requestAnimationFrame(() => document.getElementById('req-cliente')?.focus());
    return () => cancelAnimationFrame(id);
  }, [req]);
  return (
    <Janela titulo={req ? `Requisição nº ${req.id}` : 'Nova requisição'} onFechar={onFechar} largura="max-w-3xl" ocupado={gravando} rodape={<Rodape gravando={gravando} onFechar={onFechar} form="form-req" />}>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <form id="form-req" onSubmit={gravar} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Campo rotulo="Cliente" span="sm:col-span-4">
          <SelectBusca className={CAMPO} id="req-cliente" value={v.id_cliente} options={opcoesClientes(apoio)} onChange={(x) => setV({ ...v, id_cliente: x })} vazioLabel="Pesquise pelo nome ou código" />
        </Campo>
        <Campo rotulo="Status" dica="Com data de entrega vira Entregue">
          <select className={INPUT_CLASS} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
            {Object.entries(STATUS).map(([k, [l]]) => (
              <option key={k} value={k}>
                {k}-{l}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Requisitado em">
          <DateField className={CAMPO} value={v.data_req} onChange={(x) => setV({ ...v, data_req: x })} />
        </Campo>
        <Campo rotulo="Entrega">
          <DateField className={CAMPO} value={v.data_entrega} onChange={(x) => setV({ ...v, data_entrega: x })} />
        </Campo>
        <Campo rotulo="Observação" span="sm:col-span-4">
          <input className={INPUT_CLASS} maxLength={255} value={v.obs} onChange={(e) => setV({ ...v, obs: e.target.value })} onFocus={selecionarTudo} />
        </Campo>
      </form>
    </Janela>
  );
};

const FormProduto: React.FC<{ req: RegistroCrud; item: RegistroCrud | null; apoio: Apoio | null; onFechar: () => void; onGravado: () => void }> = ({ req, item, apoio, onFechar, onGravado }) => {
  const [v, setV] = useState({
    id_contrato: item?.id_contrato ? String(item.id_contrato) : '',
    id_produto: item?.id_produto ? String(item.id_produto) : '',
    qtdade_req: item ? String(item.qtdade_req ?? '') : '1',
    nome_req: item?.nome_req ?? '',
    datahora_entrega: item?.datahora_entrega ? String(item.datahora_entrega).replace(' ', 'T').slice(0, 16) : '',
    qtdade_entregue: item?.qtdade_entregue === null || item?.qtdade_entregue === undefined ? '' : String(item.qtdade_entregue),
    obs: item?.obs ?? '',
  });
  const { gravando, erro, setErro, gravar } = useGravacao(async () => {
    const payload = { ...v, id_contrato: v.id_contrato || null, id_produto: v.id_produto || null, datahora_entrega: v.datahora_entrega || null, qtdade_entregue: v.qtdade_entregue || null };
    if (item) await updateRecord('req_produtos', item.id, payload);
    else await createRecord('req_produtos', { ...payload, id_req: req.id });
    onGravado();
  });
  return (
    <Janela titulo={item ? `Produto nº ${item.id}` : 'Novo produto'} subtitulo={`Requisição nº ${req.id} — ${req.cliente_nome ?? ''}`} onFechar={onFechar} largura="max-w-3xl" ocupado={gravando} rodape={<Rodape gravando={gravando} onFechar={onFechar} form="form-req-produto" />}>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <form id="form-req-produto" onSubmit={gravar} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Campo rotulo="Contrato / equipamento" span="sm:col-span-4" dica={req.id_cliente ? undefined : 'Requisição tem que ter um cliente!'}>
          <SelectContrato cliente={req.id_cliente ? String(req.id_cliente) : ''} valor={v.id_contrato} onChange={(x) => setV({ ...v, id_contrato: x })} />
        </Campo>
        <Campo rotulo="Produto" span="sm:col-span-4">
          <SelectBusca className={CAMPO} value={v.id_produto} options={opcoesProdutos(apoio)} onChange={(x) => setV({ ...v, id_produto: x })} vazioLabel="Pesquise pelo nome ou código" />
        </Campo>
        <Campo rotulo="Qtd. Req.">
          <NumberField className={CAMPO} value={v.qtdade_req} scale={2} required onChange={(x) => setV({ ...v, qtdade_req: x })} />
        </Campo>
        <Campo rotulo="Requisitado por" span="sm:col-span-3">
          <input className={INPUT_CLASS} maxLength={50} value={v.nome_req} onChange={(e) => setV({ ...v, nome_req: e.target.value })} onFocus={selecionarTudo} />
        </Campo>
        <Campo rotulo="Entregue em" span="sm:col-span-2">
          <DateField className={CAMPO} withTime value={v.datahora_entrega} onChange={(x) => setV({ ...v, datahora_entrega: x })} />
        </Campo>
        <Campo rotulo="Qtd. Entregue">
          <NumberField className={CAMPO} value={v.qtdade_entregue} scale={2} onChange={(x) => setV({ ...v, qtdade_entregue: x })} />
        </Campo>
        <Campo rotulo="Observação" span="sm:col-span-4">
          <input className={INPUT_CLASS} maxLength={255} value={v.obs} onChange={(e) => setV({ ...v, obs: e.target.value })} onFocus={selecionarTudo} />
        </Campo>
      </form>
    </Janela>
  );
};

/** Requisições Pendentes → Gerar Requisições (o modal continua aberto, como no Delphi) */
const Pendentes: React.FC<{ onFechar: () => void; onGerado: (ultima: number | null, msg: string) => void; onToast: (msg: string) => void }> = ({ onFechar, onGerado, onToast }) => {
  const [lista, setLista] = useState<any[] | null>(null);
  const [desmarcados, setDesmarcados] = useState<Set<number>>(new Set());
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const buscar = useCallback(() => {
    setLista(null);
    setDesmarcados(new Set());
    api.get('/api/req/pendentes').then(setLista).catch((e) => {
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
      const r = await api.post('/api/req/gerar', { ids: marcados });
      onGerado(r.geradas.length ? r.geradas[r.geradas.length - 1] : null, `${r.geradas.length} requisição(ões) gerada(s).${r.avisos?.length ? ` ${r.avisos.join(' ')}` : ''}`);
      buscar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setGerando(false);
    }
  };
  const colunas: ColunaGrade<any>[] = [
    {
      chave: 'flag_gerar',
      titulo: 'Gerar',
      largura: 58,
      alinhar: 'centro',
      render: (r) => <input type="checkbox" className="cursor-pointer accent-blue-600" checked={!desmarcados.has(r.id)} onChange={() => alternar(r.id)} />,
    },
    { chave: 'id_cliente', titulo: 'ID#', largura: 60, alinhar: 'dir' },
    { chave: 'cliente_nome', titulo: 'Cliente', largura: 200 },
    { chave: 'nome_req', titulo: 'Requerente', largura: 120 },
    { chave: 'equip_descricao', titulo: 'Impressora', largura: 180, render: (r) => r.equip_descricao || [r.marca_desc, r.equip_modelo].filter(Boolean).join(' ') },
    { chave: 'datahora_req', titulo: 'Requisitado em:', largura: 130, alinhar: 'centro', render: (r) => dataHoraBR(r.datahora_req) },
    { chave: 'qtdade_req', titulo: 'Qtdade.', largura: 70, alinhar: 'dir', render: (r) => valorBR(r.qtdade_req, ',0.##') },
    { chave: 'obs', titulo: 'Observação', largura: 200 },
  ];
  return (
    <Janela
      titulo="Requisições Pendentes"
      subtitulo="Pedidos de cartucho feitos pelos clientes: uma requisição por cliente com os itens marcados"
      onFechar={onFechar}
      largura="max-w-5xl"
      ocupado={gerando}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={buscar} disabled={gerando}>
            <Search className="w-4 h-4" /> Buscar Requisições Pendentes
          </button>
          <button type="button" className={BOTAO_PRIMARIO} onClick={gerar} disabled={gerando || !marcados.length}>
            {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Gerar Requisições
          </button>
        </>
      }
    >
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <div className="h-[50vh] flex flex-col border border-stone-200 dark:border-stone-800 rounded-lg">
        <Grade nome="req.pendentes" onToast={onToast} colunas={colunas} linhas={lista ?? []} carregando={!lista} vazio="Nenhuma requisição pendente." />
      </div>
    </Janela>
  );
};

type Confirmacao = { titulo: string; mensagem: React.ReactNode; acao: () => Promise<void> };

/** Requisições (ufrmRequisicoes): no Delphi o menu ficava sempre oculto; aqui só no menu de desenvolvimento */
export const TelaRequisicoes: React.FC<TelaProps> = ({ onToast, refreshToken }) => {
  const [status, setStatus] = useState('A');
  const [lista, setLista] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [selId, setSelId] = useState<number | null>(null);
  const [produtos, setProdutos] = useState<any[]>([]);
  const [carregandoProd, setCarregandoProd] = useState(false);
  const [apoio, setApoio] = useState<Apoio | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [formReq, setFormReq] = useState<{ req: RegistroCrud | null } | null>(null);
  const [formItem, setFormItem] = useState<{ item: RegistroCrud | null } | null>(null);
  const [pendentes, setPendentes] = useState(false);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const irPara = useRef<number | 'ultimo' | null>('ultimo');

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const rows = await api.get<any[]>(`/api/req/lista?status=${status}`);
      setLista(rows);
      const alvo = irPara.current;
      irPara.current = null;
      setSelId((atual) => {
        if (alvo && alvo !== 'ultimo' && rows.some((r) => r.id === alvo)) return alvo;
        if (alvo !== 'ultimo' && atual && rows.some((r) => r.id === atual)) return atual;
        return rows.length ? rows[rows.length - 1].id : null;
      });
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

  const req = useMemo(() => lista.find((r) => r.id === selId) ?? null, [lista, selId]);
  const carregarProdutos = useCallback(async () => {
    if (!selId) return setProdutos([]);
    setCarregandoProd(true);
    try {
      setProdutos(await api.get(`/api/req/${selId}/produtos`));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregandoProd(false);
    }
  }, [selId]);
  useEffect(() => {
    carregarProdutos();
  }, [carregarProdutos, refreshToken]);

  const executar = async (rotulo: string, fn: () => Promise<unknown>, msg?: string) => {
    setOcupado(rotulo);
    setErro(null);
    try {
      await fn();
      if (msg) onToast(msg);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setOcupado(null);
    }
  };
  const entregue = (r: RegistroCrud) => executar('entregue', () => api.post(`/api/req/${r.id}/entregue`), `Requisição ${r.id} entregue.`);
  const imprimir = (r: RegistroCrud) => executar('imprimir', () => abrirPdf(`/api/req/${r.id}/imprimir`));
  const excluir = (r: RegistroCrud) =>
    setConfirmacao({
      titulo: 'Excluir requisição',
      mensagem: (
        <>
          Excluir a requisição nº <b>{r.id}</b> de {r.cliente_nome ?? 'cliente não informado'} e os produtos dela?
        </>
      ),
      acao: async () => {
        await deleteRecord('req', r.id);
        setConfirmacao(null);
        onToast(`Requisição ${r.id} excluída.`);
        await carregar();
      },
    });

  const colunas: ColunaGrade<any>[] = [
    { chave: 'status', titulo: 'S', largura: 100, alinhar: 'centro', render: (r) => (STATUS[r.status] ? <Badge texto={STATUS[r.status][0]} cor={STATUS[r.status][1]} escuro={r.status === 'I'} /> : r.status) },
    { chave: 'status_impressao', titulo: 'Imp.', largura: 60, alinhar: 'centro', render: (r) => (r.status_impressao === 'S' ? <Badge texto="SIM" /> : '') },
    { chave: 'id', titulo: 'ID#', largura: 60, alinhar: 'dir' },
    { chave: 'data_req', titulo: 'Requisitado em:', largura: 110, alinhar: 'centro', render: (r) => dataBR(r.data_req) },
    { chave: 'data_entrega', titulo: 'Entrega', largura: 100, alinhar: 'centro', render: (r) => dataBR(r.data_entrega) },
    { chave: 'id_cliente', titulo: 'ID Cli.', largura: 70, alinhar: 'dir' },
    { chave: 'cliente_nome', titulo: 'Cliente', largura: 220 },
    { chave: 'obs', titulo: 'Observação', largura: 220 },
    { chave: 'id_usuario_inclusao', titulo: 'Incluído por:', largura: 110, oculta: true, render: (r) => r.usuario_nome || r.id_usuario_inclusao },
    { chave: 'datahora_inclusao', titulo: 'Incluído em:', largura: 130, alinhar: 'centro', render: (r) => dataHoraBR(r.datahora_inclusao) },
  ];
  const acoesReq = (r: any) => (
        <MenuAcoes>
          <BotaoAcao icone={Printer} titulo="Imprimir" descricao="PDF da requisição" onClick={() => imprimir(r)} />
          <BotaoAcao icone={CheckCheck} titulo="Marcar Entregue" descricao="Status Entregue com data de hoje" tom="verde" onClick={() => entregue(r)} />
          <SeparadorAcoes />
          <BotaoAcao icone={Pencil} titulo="Editar" descricao="Alterar a requisição" onClick={() => setFormReq({ req: r })} />
          <BotaoAcao icone={Trash2} titulo="Excluir" descricao="Excluir a requisição" tom="perigo" onClick={() => excluir(r)} />
        </MenuAcoes>
  );

  const colunasProd: ColunaGrade<any>[] = [
    { chave: 'id_equip', titulo: 'ID Equip', largura: 60, alinhar: 'dir' },
    { chave: 'marca_descricao', titulo: 'Marca', largura: 100 },
    { chave: 'modelo', titulo: 'Modelo', largura: 100 },
    { chave: 'id_produto', titulo: 'ID Produto', largura: 70, alinhar: 'dir' },
    { chave: 'produto_descricao', titulo: 'Produto', largura: 200 },
    { chave: 'qtdade_req', titulo: 'Qtd. Req.', largura: 80, alinhar: 'dir', render: (r) => valorBR(r.qtdade_req) },
    { chave: 'nome_req', titulo: 'Requisitado por:', largura: 120 },
    { chave: 'datahora_req', titulo: 'Requisitado em:', largura: 130, alinhar: 'centro', render: (r) => dataHoraBR(r.datahora_req) },
    { chave: 'datahora_entrega', titulo: 'Entregue em:', largura: 130, alinhar: 'centro', render: (r) => dataHoraBR(r.datahora_entrega) },
    { chave: 'qtdade_entregue', titulo: 'Qtd. Entregue', largura: 90, alinhar: 'dir', render: (r) => valorBR(r.qtdade_entregue) },
    { chave: 'obs', titulo: 'Observação', largura: 200 },
  ];
  const acoesProd = (p: any) => (
        <span className="inline-flex gap-0.5">
          <BotaoAcao icone={Pencil} titulo="Editar" descricao="Alterar o produto" onClick={() => setFormItem({ item: p })} />
          <BotaoAcao
            icone={Trash2}
            titulo="Excluir"
            descricao="Excluir o produto"
            tom="perigo"
            onClick={() =>
              setConfirmacao({
                titulo: 'Excluir produto',
                mensagem: (
                  <>
                    Excluir <b>{p.produto_descricao ?? `o item ${p.id}`}</b> da requisição nº {selId}?
                  </>
                ),
                acao: async () => {
                  await deleteRecord('req_produtos', p.id);
                  setConfirmacao(null);
                  await carregarProdutos();
                },
              })
            }
          />
        </span>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Barra>
        <FiltroStatus valor={status} opcoes={[['A', 'Pendente'], ['I', 'Entregando'], ['E', 'Entregue'], ['T', 'Todos']]} onChange={(v) => { irPara.current = 'ultimo'; setStatus(v); }} />
        <span className="text-xs text-stone-500">{lista.length} requisição(ões)</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button className={BOTAO_SECUNDARIO} onClick={() => setPendentes(true)}>
            <Inbox className="w-4 h-4" /> Requisições Pendentes
          </button>
          <button className={BOTAO_SECUNDARIO} disabled={!req || !!ocupado} onClick={() => req && entregue(req)}>
            {ocupado === 'entregue' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />} Marcar Entregue
          </button>
          <button className={BOTAO_SECUNDARIO} disabled={!req || !!ocupado} onClick={() => req && imprimir(req)}>
            {ocupado === 'imprimir' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />} Imprimir
          </button>
          <button className={BOTAO_PRIMARIO} onClick={() => setFormReq({ req: null })}>
            <Plus className="w-4 h-4" /> Nova requisição
          </button>
        </div>
      </Barra>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3" />}
      <div className="flex-1 min-h-0 flex flex-col bg-white dark:bg-stone-900">
        <Grade nome="req.lista" onToast={onToast} acoes={acoesReq} larguraAcoes="w-16 min-w-16 max-w-16" colunas={colunas} linhas={lista} carregando={carregando} selecionado={selId ?? undefined} onSelecionar={(r) => setSelId(r.id)} onDuploClique={(r) => setFormReq({ req: r })} vazio="Nenhuma requisição neste status." />
      </div>
      <div className="h-[240px] shrink-0 flex flex-col border-t-2 border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-stone-100 dark:border-stone-800">
          <span className="text-xs font-bold text-stone-700 dark:text-stone-200">Produtos</span>
          {req && <span className="text-xs text-stone-500">Requisição nº {req.id} — {req.cliente_nome}</span>}
          <button className={`${BOTAO_PRIMARIO} ml-auto`} disabled={!req} onClick={() => setFormItem({ item: null })}>
            <Plus className="w-4 h-4" /> Novo produto
          </button>
        </div>
        <Grade nome="req.itens" onToast={onToast} acoes={acoesProd} larguraAcoes="w-20 min-w-20 max-w-20" colunas={colunasProd} linhas={produtos} carregando={carregandoProd} onDuploClique={(p) => setFormItem({ item: p })} vazio={req ? 'Nenhum produto nesta requisição.' : 'Selecione uma requisição.'} />
      </div>

      {formReq && (
        <FormReq
          req={formReq.req}
          apoio={apoio}
          onFechar={() => setFormReq(null)}
          onGravado={(id) => {
            onToast(`Requisição ${id} gravada.`);
            setFormReq(null);
            irPara.current = id;
            carregar();
          }}
        />
      )}
      {formItem && req && (
        <FormProduto
          req={req}
          item={formItem.item}
          apoio={apoio}
          onFechar={() => setFormItem(null)}
          onGravado={() => {
            setFormItem(null);
            carregarProdutos();
          }}
        />
      )}
      {pendentes && (
        <Pendentes
          onToast={onToast}
          onFechar={() => setPendentes(false)}
          onGerado={(ultima, msg) => {
            onToast(msg);
            irPara.current = ultima ?? 'ultimo';
            carregar();
          }}
        />
      )}
      {confirmacao && <ConfirmDialog titulo={confirmacao.titulo} mensagem={confirmacao.mensagem} onConfirmar={confirmacao.acao} onCancelar={() => setConfirmacao(null)} />}
    </div>
  );
};
