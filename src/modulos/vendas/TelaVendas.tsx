import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calculator, CheckCircle2, Copy, Edit3, FileCheck, MoreHorizontal, Pencil, Plus, Printer, Receipt, RefreshCw, RotateCcw, Settings2, Sigma, Trash2, Truck, XCircle,
} from 'lucide-react';
import type { TelaProps } from '../tipos';
import { api } from '../../services/api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { MaisAcoes } from '../../components/MaisAcoes';
import { AvisoErro } from '../../components/AvisoErro';
import { DateField } from '../../components/DateField';
import { INPUT_CLASS } from '../../utils/formStyles';
import { BoletosAreceber } from '../faturamento';
import { Badge, BadgeStatus, Botao, Grade, PreviewPdf, dataBR, dataHoraBR, hoje, moeda, num, numero9, qtd, type Coluna, type Linha } from './comum';
import { FormItem, FormObs, FormSaida, FormVenda, type Apoio } from './formularios';
import { Fechamento, type Preparo } from './fechamento';
import { CapturaPedidos, Devolucao } from './capturas';
import { GerenciadorNFe } from './nfe';
import { TabelasVendas } from './tabelas';

// ============================================================ filtro de data (combo do cabeçalho "Data Venda")

type Periodo = '' | 'H' | 'S' | 'M' | 'A' | 'T' | 'P';
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Hoje, Semana (segunda a domingo, StartOfTheWeek do Delphi), Mês, Ano, Todos; vazio = sem filtro */
export function periodo(p: Periodo, base = hoje()): [string, string] | null {
  const [a, m, d] = base.split('-').map(Number);
  const dt = new Date(a, m - 1, d);
  switch (p) {
    case 'H':
      return [base, base];
    case 'S': {
      const ini = new Date(dt);
      ini.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
      const fim = new Date(ini);
      fim.setDate(ini.getDate() + 6);
      return [iso(ini), iso(fim)];
    }
    case 'M':
      return [iso(new Date(a, m - 1, 1)), iso(new Date(a, m, 0))];
    case 'A':
      return [`${a}-01-01`, `${a}-12-31`];
    case 'T':
      return ['1902-01-01', '2099-12-31'];
    default:
      return null;
  }
}

type Dialogo =
  | null
  | { t: 'venda'; venda: Linha | null }
  | { t: 'item'; item: Linha | null }
  | { t: 'obs' | 'saida'; venda: Linha }
  | { t: 'fechamento'; preparo: Preparo }
  | { t: 'devolucao' | 'pedidos' | 'nfe' | 'boletos' | 'tabelas' }
  | { t: 'pdf'; url: string; titulo: string }
  | { t: 'excluirVenda' | 'excluirItem' | 'descartar' }
  | { t: 'duplicar'; venda: Linha; orcamento: boolean };

export const TelaVendas: React.FC<TelaProps> = (p) => {
  const { onToast, refreshToken, createToken } = p;
  const [apoio, setApoio] = useState<Apoio>({ operacoes: [], series: [], condicoes: [], vendedores: [], bancos: [] });
  const [filtro, setFiltro] = useState({ operacao: '', status: '', periodo: 'H' as Periodo, d1: hoje(), d2: hoje(), cliente: '' });
  const [vendas, setVendas] = useState<Linha[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [venda, setVenda] = useState<Linha | null>(null);
  const [itemSel, setItemSel] = useState<number | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [opDestino, setOpDestino] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    api.get('/api/vendas/apoio').then(setApoio).catch((e) => setErro(e.message));
  }, [refreshToken]);

  const carregarVenda = useCallback(async (id: number | null) => {
    if (!id) return setVenda(null);
    try {
      setVenda(await api.get(`/api/vendas/${id}`));
    } catch (e: any) {
      setVenda(null);
      setErro(e.message);
    }
  }, []);

  /** Reabre a lista (atraso de 800 ms nos filtros, como no Delphi) e relocaliza a venda */
  const carregar = useCallback(
    async (manter?: number | null) => {
      const meu = ++seq.current;
      setCarregando(true);
      const per = filtro.periodo === 'P' ? [filtro.d1, filtro.d2] : periodo(filtro.periodo);
      const qs = new URLSearchParams({ operacao: filtro.operacao, status: filtro.status, cliente: filtro.cliente, ...(per ? { d1: per[0], d2: per[1] } : {}) });
      try {
        const l: Linha[] = await api.get(`/api/vendas?${qs}`);
        if (meu !== seq.current) return;
        setVendas(l);
        const alvo = manter && l.some((v) => v.id === manter) ? manter : l.length ? l[l.length - 1].id : null;
        setSelId(alvo);
        await carregarVenda(alvo);
      } catch (e: any) {
        setErro(e.message);
      } finally {
        if (meu === seq.current) setCarregando(false);
      }
    },
    [filtro, carregarVenda],
  );
  const selRef = useRef(selId);
  selRef.current = selId;
  useEffect(() => {
    const t = setTimeout(() => carregar(selRef.current), 800);
    return () => clearTimeout(t);
  }, [carregar, refreshToken]);
  useEffect(() => {
    if (createToken) setDialogo({ t: 'venda', venda: null });
  }, [createToken]);

  const selecionar = (v: Linha) => {
    if (v.id === selId) return;
    setSelId(v.id);
    setItemSel(null);
    carregarVenda(v.id);
  };
  const recarregar = () => carregar(selId);

  // ---------------------------------------------------------------- ações

  const FINALIZADA = 'A edição já foi finalizada!';
  const exigir = (cond: boolean, msg: string) => {
    if (!cond) setErro(msg);
    return cond;
  };
  const executar = async (rotulo: string, fn: () => Promise<any>, ok?: string) => {
    setOcupado(rotulo);
    setErro(null);
    try {
      const r = await fn();
      if (ok) onToast(ok);
      return r ?? true;
    } catch (e: any) {
      setErro(e.message);
      return null;
    } finally {
      setOcupado(null);
    }
  };

  const editarVenda = () => venda && exigir(venda.status !== 'F', FINALIZADA) && setDialogo({ t: 'venda', venda });
  const excluirVenda = () => venda && exigir(venda.status !== 'F', FINALIZADA) && setDialogo({ t: 'excluirVenda' });

  const finalizar = async () => {
    if (!venda) return;
    if (!exigir(venda.status === 'A', FINALIZADA)) return;
    if (!exigir(num(venda.valor_total_liquido) > 0, 'Valor da venda zerado!')) return;
    if (!exigir(!!String(venda.serie ?? '').trim(), 'Série não definida!')) return;
    const preparo = await executar('finalizar', () => api.post(`/api/vendas/${venda.id}/finalizar/preparar`));
    if (preparo) {
      setDialogo({ t: 'fechamento', preparo });
      carregarVenda(venda.id);
    }
  };

  const imprimir = () => venda && exigir(venda.status !== 'A', 'Esta venda ainda está aberta (imprimir somente fechados)!') && setDialogo({ t: 'pdf', url: `/api/vendas/${venda.id}/imprimir`, titulo: `DAV ${venda.serie}/${numero9(venda.numero)}` });

  const abrirNFe = async () => {
    // Como o Delphi: antes de abrir, se ainda não tem protocolo, calcula os impostos de todos os itens
    if (venda && !venda.nfe_protocolo && venda.serie_modelo === '55' && venda.status === 'F') await executar('nfe', () => api.post(`/api/vendas/${venda.id}/impostos`));
    setDialogo({ t: 'nfe' });
  };

  const boletos = () => {
    if (!venda) return;
    if (!exigir(venda.status !== 'A', 'Esta venda ainda está aberta!')) return;
    if (!exigir(venda.tipo === 'V', 'Para emissão de boletos somente série tipo "V" (venda)!')) return;
    setDialogo({ t: 'boletos' });
  };

  const noItem = (fn: () => void) => () => {
    if (!venda) return;
    if (!exigir(venda.status !== 'F', FINALIZADA)) return;
    fn();
  };
  const item = venda?.itens?.find((i: Linha) => i.id === itemSel) ?? null;

  const opsDestino = apoio.operacoes.filter((o) => ['VEN', 'PED'].includes(o.codigo));

  // ---------------------------------------------------------------- grades

  const colunasVendas: Coluna<Linha>[] = [
    { chave: 'apelido_operacao', titulo: 'Operação', alinhar: 'centro', fixa: true, render: (r) => <Badge texto={r.apelido_operacao} cor={r.operacao_cor} /> },
    { chave: 'status', titulo: 'Status', alinhar: 'centro', render: (r) => <BadgeStatus status={r.status} /> },
    {
      chave: 'obs',
      titulo: 'Obs.',
      rotulo: 'Observação',
      alinhar: 'centro',
      render: (r) => (
        <button
          type="button"
          title={r.tem_obs ? 'Observação (preenchida)' : 'Observação'}
          className={`p-0.5 rounded hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer ${Number(r.tem_obs) ? 'text-blue-600' : 'text-stone-400'}`}
          onClick={(e) => {
            e.stopPropagation();
            if (r.status === 'F') return setErro(FINALIZADA);
            setDialogo({ t: 'obs', venda: r });
          }}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      ),
    },
    {
      chave: 'dup',
      titulo: 'Dup.',
      alinhar: 'centro',
      dica: 'Transformar em nota fiscal (duplicar)',
      render: (r) => (
        <button
          type="button"
          title="Transformar em nota fiscal"
          className="p-0.5 rounded text-stone-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            setOpDestino(String(opsDestino[0]?.id ?? ''));
            setDialogo({ t: 'duplicar', venda: r, orcamento: false });
          }}
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      ),
    },
    { chave: 'id', titulo: 'ID', alinhar: 'dir' },
    {
      chave: 'data_venda',
      titulo: 'Data Venda',
      alinhar: 'centro',
      render: (r) => {
        const d = String(r.data_venda ?? '').slice(0, 10);
        const [a, m, dd] = hoje().split('-').map(Number);
        const ontem = iso(new Date(a, m - 1, dd - 1));
        return d === hoje() ? 'HOJE' : d === ontem ? 'ONTEM' : dataBR(d);
      },
    },
    { chave: 'serie', titulo: 'Série', alinhar: 'centro' },
    { chave: 'numero', titulo: 'Número', alinhar: 'dir', render: (r) => numero9(r.numero) },
    { chave: 'id_cliente', titulo: 'Id Cliente', alinhar: 'dir' },
    { chave: 'nome', titulo: 'Cliente' },
    { chave: 'valor_total_liquido', titulo: 'Total Líquido', alinhar: 'dir', render: (r) => <b>{moeda(r.valor_total_liquido)}</b> },
    { chave: 'id_condicao', titulo: 'Id Condição', alinhar: 'dir', oculta: true },
    { chave: 'apelido_plano', titulo: 'Condição' },
    { chave: 'id_vendedor1', titulo: 'Id Vend (1)', alinhar: 'dir', oculta: true },
    { chave: 'nome_1', titulo: 'Nome Vend (1)' },
    { chave: 'id_vendedor2', titulo: 'Id Vend (2)', alinhar: 'dir', oculta: true, render: (r) => (num(r.id_vendedor2) ? r.id_vendedor2 : '') },
    { chave: 'nome_2', titulo: 'Nome Vend (2)', oculta: true },
    { chave: 'valor_total_liquido_antes_desconto_nf', titulo: 'Total Produtos', alinhar: 'dir', oculta: true, render: (r) => moeda(r.valor_total_liquido_antes_desconto_nf) },
    { chave: 'valor_acrescimo_nf', titulo: 'R$ Acresc.', alinhar: 'dir', oculta: true, render: (r) => moeda(r.valor_acrescimo_nf) },
    { chave: 'valor_desconto_nf', titulo: 'R$ Desc.', alinhar: 'dir', oculta: true, render: (r) => moeda(r.valor_desconto_nf) },
    {
      chave: 'data_saida',
      titulo: 'Data Saída',
      alinhar: 'centro',
      dica: 'Clique para editar a data/hora de saída',
      render: (r) => (
        <button type="button" className="min-w-16 hover:underline cursor-pointer" onClick={(e) => (e.stopPropagation(), setDialogo({ t: 'saida', venda: r }))}>
          {dataBR(r.data_saida) || '—'}
        </button>
      ),
    },
    {
      chave: 'hora_saida',
      titulo: 'Hora Saída',
      alinhar: 'centro',
      render: (r) => (
        <button type="button" className="min-w-10 hover:underline cursor-pointer" onClick={(e) => (e.stopPropagation(), setDialogo({ t: 'saida', venda: r }))}>
          {r.hora_saida || '—'}
        </button>
      ),
    },
    { chave: 'datahora_inclusao', titulo: 'Registrado em:', alinhar: 'centro', oculta: true, render: (r) => dataHoraBR(r.datahora_inclusao) },
  ];

  const pedido = venda?.operacao_codigo === 'PED';
  const colunasItens: Coluna<Linha>[] = [
    { chave: 'item', titulo: '#', alinhar: 'dir' },
    { chave: 'id_produto', titulo: 'Id Prod.', alinhar: 'dir' },
    { chave: 'referencia', titulo: 'Referência' },
    { chave: 'descricao_produto', titulo: 'Produto' },
    { chave: 'qtdade', titulo: 'Qtdade.', alinhar: 'dir', render: (r) => qtd(r.qtdade) },
    { chave: 'preco_lista', titulo: 'Preço Lista', alinhar: 'dir', render: (r) => moeda(r.preco_lista) },
    { chave: 'preco_venda', titulo: 'Preço Venda', alinhar: 'dir', render: (r) => moeda(r.preco_venda) },
    { chave: 'valor_total_bruto', titulo: 'Valor Bruto', alinhar: 'dir', render: (r) => moeda(r.valor_total_bruto) },
    { chave: 'valor_acrescimo_total', titulo: 'R$ Acresc.', alinhar: 'dir', render: (r) => moeda(r.valor_acrescimo_total) },
    { chave: 'valor_desconto_total', titulo: 'R$ Desc.', alinhar: 'dir', render: (r) => moeda(r.valor_desconto_total) },
    { chave: 'valor_total_liquido_final', titulo: 'Valor Líquido', alinhar: 'dir', render: (r) => <b>{moeda(r.valor_total_liquido_final)}</b> },
    { chave: 'cfop', titulo: 'CFOP', alinhar: 'centro' },
    { chave: 'id', titulo: 'ID', alinhar: 'dir', oculta: true },
    { chave: 'qtdade_devol', titulo: pedido ? 'Qtd. Fatur.' : 'Qtd. Devolv.', alinhar: 'dir', render: (r) => qtd(r.qtdade_devol) },
    { chave: 'id_vendas_produtos_devol', titulo: 'Id de Origem', alinhar: 'dir', oculta: true, render: (r) => (num(r.id_vendas_produtos_devol) ? r.id_vendas_produtos_devol : '') },
  ];

  // ---------------------------------------------------------------- painel de condições (§2.5)

  const cond = useMemo(() => {
    if (!venda) return null;
    const c = apoio.condicoes.find((x) => x.id === venda.id_condicao);
    const j = num(c?.juros_mes);
    return {
      rotulo: `TOTAL LÍQUIDO: ${j > 0 ? `(JUROS: ${j}%)` : j < 0 ? `(DESC.: ${Math.abs(j)}%)` : '(SEM JUROS)'}`,
      parcela: num(venda.nr_parcelas) > 0 ? Math.round((num(venda.valor_total_liquido) / num(venda.nr_parcelas)) * 100) / 100 : 0,
    };
  }, [venda, apoio.condicoes]);

  const trocarCondicao = async (c: Linha) => {
    if (!venda) return;
    if (!exigir(venda.status !== 'F', FINALIZADA)) return;
    if (!exigir(!(num(venda.id_cliente) === 1 && !String(c.apelido).toUpperCase().includes('VISTA')), 'Venda consumidor somente a vista!')) return;
    if (await executar('cond', () => api.put(`/api/vendas/${venda.id}/condicao`, { id_condicao: c.id }), `Condição ${c.apelido} aplicada.`)) recarregar();
  };

  const statusSel = venda?.status;
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
      {/* Barra de ferramentas */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-stone-200 dark:border-stone-800">
        <Botao icone={Plus} tom="primario" onClick={() => setDialogo({ t: 'venda', venda: null })} titulo="Incluir venda">
          Novo
        </Botao>
        <Botao icone={Pencil} onClick={editarVenda} desabilitado={!venda} titulo="Editar venda" />
        <Botao icone={Trash2} tom="perigo" onClick={excluirVenda} desabilitado={!venda} titulo="Excluir venda" />
        <Botao icone={RefreshCw} onClick={recarregar} carregando={carregando} titulo="Atualizar" />
        <span className="w-px h-6 bg-stone-200 dark:bg-stone-700 mx-1" />
        <Botao icone={CheckCircle2} onClick={finalizar} desabilitado={!venda} carregando={ocupado === 'finalizar'}>
          Finalizar
        </Botao>
        <Botao icone={Printer} onClick={imprimir} desabilitado={!venda}>
          Imprimir
        </Botao>
        <MaisAcoes
          itens={[
            { icone: FileCheck, titulo: ocupado === 'nfe' ? 'NFe (calculando impostos…)' : 'NFe', onClick: abrirNFe, disabled: ocupado === 'nfe' },
            { icone: Receipt, titulo: 'Boletos', onClick: boletos, disabled: !venda },
            {
              icone: CheckCircle2,
              titulo: 'Confirmar orçamento',
              separar: true,
              disabled: venda?.operacao_codigo !== 'ORC',
              onClick: () => {
                if (!venda || !exigir(venda.status !== 'C', 'Este orçamento já está confirmado!')) return;
                setOpDestino(String(opsDestino[0]?.id ?? ''));
                setDialogo({ t: 'duplicar', venda, orcamento: true });
              },
            },
            { icone: XCircle, titulo: 'Descartar orçamento', tom: 'perigo', disabled: venda?.operacao_codigo !== 'ORC', onClick: () => setDialogo({ t: 'descartar' }) },
            { icone: Settings2, titulo: 'Tabelas', separar: true, onClick: () => setDialogo({ t: 'tabelas' }) },
          ]}
        />
      </div>

      {/* Filtros (no Delphi ficavam no cabeçalho das colunas) */}
      <div className="flex flex-wrap items-end gap-2 px-4 py-2 border-b border-stone-100 dark:border-stone-800 text-xs">
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-stone-500">Operação</span>
          <select className={`${INPUT_CLASS} w-40`} value={filtro.operacao} onChange={(e) => setFiltro((f) => ({ ...f, operacao: e.target.value }))}>
            <option value="">Todas</option>
            {[...new Map(apoio.operacoes.map((o) => [o.codigo, o])).values()].map((o) => (
              <option key={o.codigo} value={o.codigo}>
                {o.apelido}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-stone-500">Status</span>
          <select className={`${INPUT_CLASS} w-32`} value={filtro.status} onChange={(e) => setFiltro((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Todos</option>
            <option value="A">Aberto</option>
            <option value="F">Fechado</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-stone-500">Data Venda</span>
          <select className={`${INPUT_CLASS} w-36`} value={filtro.periodo} onChange={(e) => setFiltro((f) => ({ ...f, periodo: e.target.value as Periodo }))}>
            <option value="">(sem filtro)</option>
            <option value="H">Hoje</option>
            <option value="S">Semana</option>
            <option value="M">Mês</option>
            <option value="A">Ano</option>
            <option value="T">Todos</option>
            <option value="P">Personalizado</option>
          </select>
        </label>
        {filtro.periodo === 'P' && (
          <>
            <label className="flex flex-col gap-0.5">
              <span className="text-[11px] text-stone-500">De</span>
              <DateField value={filtro.d1} onChange={(v) => setFiltro((f) => ({ ...f, d1: v }))} className={`${INPUT_CLASS} w-36`} />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[11px] text-stone-500">Até</span>
              <DateField value={filtro.d2} onChange={(v) => setFiltro((f) => ({ ...f, d2: v }))} className={`${INPUT_CLASS} w-36`} />
            </label>
          </>
        )}
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-stone-500">Cliente</span>
          <input className={`${INPUT_CLASS} w-56`} placeholder="Começo do nome" value={filtro.cliente} onChange={(e) => setFiltro((f) => ({ ...f, cliente: e.target.value }))} />
        </label>
        <span className="ml-auto text-[11px] text-stone-400">{vendas.length} venda(s)</span>
      </div>

      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-2 whitespace-pre-line" />}

      {/* Lista + condições */}
      <div className="flex-[3] min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col">
          <Grade nome="vendas.lista" onToast={onToast} colunas={colunasVendas} linhas={vendas} carregando={carregando} selecionado={selId} onSelecionar={selecionar} onDuploClique={(r) => (selecionar(r), r.status === 'F' ? setErro(FINALIZADA) : setDialogo({ t: 'venda', venda: { ...r, ...(venda?.id === r.id ? venda : {}) } }))} vazio="Nenhuma venda no filtro." />
        </div>
        <aside className="w-64 shrink-0 border-l border-stone-200 dark:border-stone-800 flex flex-col">
          <div className="px-3 py-2 text-xs font-semibold text-stone-600 dark:text-stone-300 border-b border-stone-100 dark:border-stone-800">Condições</div>
          {venda && cond ? (
            <div className="px-3 py-2 text-xs border-b border-stone-100 dark:border-stone-800 text-center">
              <div className="text-[11px] text-stone-500">{cond.rotulo}</div>
              <div className="text-lg font-bold font-mono">{moeda(venda.valor_total_liquido)}</div>
              {venda.apelido_plano && (
                <div className="text-[11px] text-stone-600 dark:text-stone-300">
                  {venda.nr_parcelas} X {venda.apelido_plano}: <b>{moeda(cond.parcela)}</b>
                </div>
              )}
            </div>
          ) : null}
          <div className="flex-1 min-h-0 flex flex-col">
            <Grade
              nome="vendas.condicoes"
              onToast={onToast}
              colunas={[
                { chave: 'apelido', titulo: 'Cond.' },
                { chave: 'nr_vezes', titulo: 'x', alinhar: 'centro' },
                { chave: 'parcela', titulo: 'Parc.', alinhar: 'dir', render: (r) => moeda(r.parcela) },
              ]}
              linhas={venda?.condicoes ?? []}
              selecionado={venda?.id_condicao}
              onDuploClique={trocarCondicao}
              vazio={venda ? 'Venda sem produtos.' : '—'}
            />
          </div>
          <div className="px-3 py-1.5 text-[10px] text-stone-400 border-t border-stone-100 dark:border-stone-800">Duplo clique aplica a condição</div>
        </aside>
      </div>

      {/* Produtos da venda */}
      <div className="flex-[2] min-h-0 flex flex-col border-t-4 border-stone-200 dark:border-stone-800">
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-1.5">
          <span className="text-xs font-bold text-stone-700 dark:text-stone-200 mr-2">
            Produtos da Venda{venda ? ` nº ${venda.id}` : ''} {statusSel && <BadgeStatus status={statusSel} />}
          </span>
          <Botao icone={Plus} tom="primario" onClick={noItem(() => setDialogo({ t: 'item', item: null }))} desabilitado={!venda} titulo="Incluir produto" />
          <Botao icone={Edit3} onClick={noItem(() => item && exigir(!(num(item.id_vendas_produtos_devol) > 0), 'Produto capturado para devolução não pode ser editado!') && setDialogo({ t: 'item', item }))} desabilitado={!item} titulo="Editar produto" />
          <Botao icone={Trash2} tom="perigo" onClick={noItem(() => item && setDialogo({ t: 'excluirItem' }))} desabilitado={!item} titulo="Excluir produto" />
          <span className="w-px h-6 bg-stone-200 dark:bg-stone-700 mx-1" />
          <Botao icone={Sigma} desabilitado={!venda} carregando={ocupado === 'totalizar'} onClick={noItem(async () => (await executar('totalizar', () => api.post(`/api/vendas/${venda!.id}/totalizar`), 'Venda totalizada.')) && recarregar())}>
            Totalizar
          </Botao>
          <MaisAcoes
            itens={[
              { icone: RotateCcw, titulo: 'Devolução', disabled: !venda, onClick: noItem(() => exigir(venda!.operacao_codigo === 'DEV', 'Esta venda não é uma devolução!') && setDialogo({ t: 'devolucao' })) },
              { icone: Truck, titulo: 'Capturar Pedidos', disabled: !venda, onClick: noItem(() => exigir(venda!.operacao_codigo === 'VEN', 'Este registro não é uma Venda!') && setDialogo({ t: 'pedidos' })) },
              {
                icone: Calculator,
                titulo: ocupado === 'impostos' ? 'Calculando impostos…' : 'Calcular Impostos',
                disabled: !venda?.itens?.length || ocupado === 'impostos',
                onClick: async () => {
                  const r = await executar('impostos', () => api.post(`/api/vendas/${venda!.id}/impostos`));
                  if (r) {
                    onToast(`Impostos calculados (${r.calculados} item(ns)).`);
                    if (r.avisos?.length) setErro(`Avisos das fórmulas:\n${r.avisos.join('\n')}`);
                    recarregar();
                  }
                },
              },
            ]}
          />
          {venda && (
            <span className="ml-auto text-[11px] text-stone-500">
              Bruto <b>{moeda(venda.valor_total_bruto)}</b> · Acrésc. <b>{moeda(venda.valor_acrescimo_total)}</b> · Desc. <b>{moeda(venda.valor_desconto_total)}</b> · Líquido{' '}
              <b className="text-stone-800 dark:text-stone-100">{moeda(venda.valor_total_liquido)}</b>
            </span>
          )}
        </div>
        <Grade
          nome="vendas.itens"
          onToast={onToast}
          colunas={colunasItens}
          linhas={venda?.itens ?? []}
          selecionado={itemSel}
          onSelecionar={(r) => setItemSel(r.id)}
          onDuploClique={(r) => {
            setItemSel(r.id);
            if (venda?.status === 'F') return setErro(FINALIZADA);
            if (num(r.id_vendas_produtos_devol) > 0) return setErro('Produto capturado para devolução não pode ser editado!');
            setDialogo({ t: 'item', item: r });
          }}
          vazio={venda ? 'Nenhum produto nesta venda.' : 'Escolha uma venda.'}
        />
      </div>

      {/* Diálogos */}
      {dialogo?.t === 'venda' && (
        <FormVenda
          venda={dialogo.venda}
          apoio={apoio}
          onFechar={() => setDialogo(null)}
          onGravado={(id) => {
            setDialogo(null);
            onToast('Venda gravada.');
            carregar(id);
            if (!dialogo.venda) setTimeout(() => setDialogo({ t: 'item', item: null }), 300);
          }}
        />
      )}
      {dialogo?.t === 'item' && venda && <FormItem venda={venda} item={dialogo.item} onFechar={() => setDialogo(null)} onGravado={recarregar} />}
      {dialogo?.t === 'obs' && <FormObs venda={dialogo.venda} onFechar={() => setDialogo(null)} onGravado={recarregar} />}
      {dialogo?.t === 'saida' && <FormSaida venda={dialogo.venda} onFechar={() => setDialogo(null)} onGravado={recarregar} />}
      {dialogo?.t === 'fechamento' && venda && (
        <Fechamento
          venda={venda}
          preparo={dialogo.preparo}
          apoio={apoio}
          onToast={onToast}
          onFechar={() => {
            setDialogo(null);
            recarregar();
          }}
          onGravado={() => {
            setDialogo(null);
            onToast('Venda finalizada.');
            recarregar();
          }}
        />
      )}
      {dialogo?.t === 'devolucao' && venda && <Devolucao venda={venda} onFechar={() => setDialogo(null)} onGravado={recarregar} />}
      {dialogo?.t === 'pedidos' && venda && <CapturaPedidos venda={venda} onFechar={() => setDialogo(null)} onGravado={recarregar} />}
      {dialogo?.t === 'nfe' && (
        <GerenciadorNFe
          idVenda={venda?.id}
          onToast={onToast}
          onFechar={() => {
            setDialogo(null);
            recarregar();
          }}
        />
      )}
      {dialogo?.t === 'boletos' && venda && <BoletosAreceber idVenda={venda.id} onFechar={() => setDialogo(null)} />}
      {dialogo?.t === 'tabelas' && (
        <TabelasVendas
          p={p}
          onFechar={() => {
            setDialogo(null);
            api.get('/api/vendas/apoio').then(setApoio).catch(() => {});
          }}
        />
      )}
      {dialogo?.t === 'pdf' && <PreviewPdf url={dialogo.url} titulo={dialogo.titulo} onFechar={() => setDialogo(null)} />}
      {dialogo?.t === 'excluirVenda' && venda && (
        <ConfirmDialog
          titulo="Excluir venda"
          mensagem={`Excluir a venda nº ${venda.id} (${venda.nome ?? ''}) com os seus produtos e impostos? As quantidades capturadas voltam para as vendas/pedidos de origem.`}
          onCancelar={() => setDialogo(null)}
          onConfirmar={async () => {
            await api.delete(`/api/vendas/${venda.id}`);
            setDialogo(null);
            onToast('Venda excluída.');
            carregar(null);
          }}
        />
      )}
      {dialogo?.t === 'excluirItem' && venda && item && (
        <ConfirmDialog
          titulo="Excluir produto"
          mensagem={`Excluir o produto ${item.id_produto} - ${item.descricao_produto ?? ''} da venda?`}
          onCancelar={() => setDialogo(null)}
          onConfirmar={async () => {
            await api.delete(`/api/vendas/${venda.id}/itens/${item.id}`);
            setDialogo(null);
            setItemSel(null);
            recarregar();
          }}
        />
      )}
      {dialogo?.t === 'descartar' && venda && (
        <ConfirmDialog
          titulo="Descartar orçamento"
          mensagem={`Marcar o orçamento nº ${venda.id} como NÃO CONFIRMADO?`}
          confirmar="Descartar"
          onCancelar={() => setDialogo(null)}
          onConfirmar={async () => {
            await api.post(`/api/vendas/${venda.id}/orcamento/descartar`);
            setDialogo(null);
            recarregar();
          }}
        />
      )}
      {dialogo?.t === 'duplicar' && (
        <ConfirmDialog
          titulo={dialogo.orcamento ? 'Confirmar orçamento' : 'Duplicar venda'}
          mensagem={
            dialogo.orcamento
              ? `Confirma o orçamento nº ${dialogo.venda.id} (transformar em Pedido/NF)? Ele fica CONFIRMADO e uma nova venda é criada com os mesmos produtos.`
              : `Confirma duplicar o registro nº ${dialogo.venda.id} (transformar em Pedido/NF)? Uma nova venda é criada com os mesmos produtos.`
          }
          confirmar={dialogo.orcamento ? 'Confirmar' : 'Duplicar'}
          tom="normal"
          onCancelar={() => setDialogo(null)}
          onConfirmar={async () => {
            if (!opDestino) throw new Error('Escolha a operação da nova venda.');
            const r = await api.post(`/api/vendas/${dialogo.venda.id}/${dialogo.orcamento ? 'orcamento/confirmar' : 'duplicar'}`, { id_operacao: Number(opDestino) });
            setDialogo(null);
            onToast(`Nova venda nº ${r.id} criada.`);
            carregar(r.id);
          }}
        >
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-stone-500">Operação da nova venda</span>
            <select className={INPUT_CLASS} value={opDestino} onChange={(e) => setOpDestino(e.target.value)}>
              <option value="">— Selecione —</option>
              {(opsDestino.length ? opsDestino : apoio.operacoes).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.apelido} ({o.codigo})
                </option>
              ))}
            </select>
          </label>
        </ConfirmDialog>
      )}
      {ocupado === 'finalizar' && <div className="fixed inset-0 z-[70] cursor-wait" />}
    </div>
  );
};
