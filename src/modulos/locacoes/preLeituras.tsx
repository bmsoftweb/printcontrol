import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Download, DownloadCloud, Eraser, Filter, Gauge, ListPlus, Pencil, RefreshCw, Save, Search, Send, Trash2 } from 'lucide-react';
import { BotaoAcao } from '../../components/MenuAcoes';
import { MaisAcoes } from '../../components/MaisAcoes';
import type { OpcaoRef, RegistroCrud, ResourceDef } from '../../types';
import { api, deleteRecord, updateRecord } from '../../services/api';
import { Janela } from '../../components/Janela';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { AvisoErro } from '../../components/AvisoErro';
import { DateField } from '../../components/DateField';
import { SelectBusca } from '../../components/SelectBusca';
import { Toggle } from '../../components/Toggle';
import { INPUT_CLASS, LABEL_CLASS } from '../../utils/formStyles';
import { BotaoBarra, Coluna, Grade, JanelaForm, Selo, dataBr, dataHoraBr, hoje, inteiro } from './ui';
import { HistoricoSnmp } from './dialogos';

const CONFERIDO: Record<string, [string, string]> = { S: ['SIM', '#2E8B57'], N: ['NÃO', '#FF6347'], F: ['FATURADO', '#2E8B57'] };
const STATUS: Record<string, [string, string]> = { G: ['GERADO', '#FFDAB9'], C: ['CAPTURADO', '#2E8B57'], P: ['A FATURAR', '#1E90FF'], F: ['FATURADO', '#2E8B57'], Z: ['ZERADO', '#696969'] };

/** Captura anterior à data da leitura (ou nenhuma) e ainda não conferida: destaca Previsão e Última Captura */
const atrasada = (r: RegistroCrud) =>
  (r.faturar ?? 'N') === 'N' && (!r.datahora_leitura_auto || String(r.datahora_leitura_auto).slice(0, 10) < String(r.data_leitura ?? '').slice(0, 10)) ? { background: '#FFA07A' } : undefined;

interface Props {
  resources: ResourceDef[];
  onToast: (m: string) => void;
  onVoltar: () => void;
  /** Filtrar Contratos / depois de Lançar Leituras: lista os contratos do lote na aba Contratos */
  onFiltrarContratos: (lote: number) => void;
}

export const AbaPreLeituras: React.FC<Props> = ({ resources, onToast, onVoltar, onFiltrarContratos }) => {
  const recursoItem = resources.find((r) => r.name === 'locacao_pre_leituras_leituras');
  const [lotes, setLotes] = useState<RegistroCrud[]>([]);
  const [loteId, setLoteId] = useState<number | null>(null);
  const [itens, setItens] = useState<RegistroCrud[]>([]);
  const [itemId, setItemId] = useState<number | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [carregandoItens, setCarregandoItens] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<null | 'gerar' | 'editar' | 'excluir' | 'snmp'>(null);

  const carregarLotes = useCallback(async (selecionar?: number) => {
    setCarregando(true);
    try {
      const r = await api.get<RegistroCrud[]>('/api/locacoes/pre-leituras');
      setLotes(r);
      setLoteId((s) => selecionar ?? (r.some((l) => l.id === s) ? s : (r[0]?.id ?? null)));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, []);

  const carregarItens = useCallback(async () => {
    if (!loteId) return setItens([]);
    setCarregandoItens(true);
    try {
      const r = await api.get<RegistroCrud[]>(`/api/locacoes/pre-leituras/${loteId}/itens`);
      setItens(r);
      setItemId((s) => (r.some((l) => l.id === s) ? s : (r[0]?.id ?? null)));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregandoItens(false);
    }
  }, [loteId]);

  useEffect(() => {
    carregarLotes();
  }, [carregarLotes]);
  useEffect(() => {
    carregarItens();
  }, [carregarItens]);

  const item = itens.find((i) => i.id === itemId) ?? null;

  /** Executa um processo do lote com a barra ocupada e mostra o resultado */
  const processo = async (nome: string, fn: () => Promise<string | void>) => {
    setOcupado(nome);
    setErro(null);
    try {
      const msg = await fn();
      if (msg) onToast(msg);
      await carregarItens();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setOcupado(null);
    }
  };

  const alternarConferido = async (r: RegistroCrud) => {
    if (r.faturar === 'F') return onToast('Leitura já lançada (faturada).');
    try {
      await updateRecord('locacao_pre_leituras_leituras', r.id, { faturar: r.faturar === 'S' ? 'N' : 'S' });
      setItens((l) => l.map((x) => (x.id === r.id ? { ...x, faturar: r.faturar === 'S' ? 'N' : 'S' } : x)));
    } catch (e: any) {
      setErro(e.message);
    }
  };

  const colLotes: Coluna<RegistroCrud>[] = [
    { titulo: 'Gerado em:', render: (r) => dataHoraBr(r.datahora_geracao) },
    { titulo: 'Dia Leitura', campo: 'filtro_dia_leitura', alinhar: 'c' },
    { titulo: 'Até:', alinhar: 'c', render: (r) => dataBr(r.filtro_ate_data) },
    { titulo: 'Cliente', campo: 'filtro_cliente' },
  ];
  const colItens: Coluna<RegistroCrud>[] = [
    {
      titulo: 'Conferido',
      alinhar: 'c',
      render: (r) => {
        const [t, c] = CONFERIDO[r.faturar ?? 'N'] ?? CONFERIDO.N;
        return <Selo texto={t} cor={c} onClick={() => alternarConferido(r)} title="Clique para marcar/desmarcar conferido" />;
      },
    },
    {
      titulo: 'Status',
      alinhar: 'c',
      render: (r) => {
        const s = STATUS[r.status];
        return s ? <Selo texto={s[0]} cor={s[1]} /> : r.status;
      },
    },
    { titulo: 'Nr. Série', campo: 'nr_serie' },
    { titulo: 'Rede/USB', alinhar: 'c', render: (r) => <Selo texto={r.rede_usb === 'R' ? 'REDE' : 'USB'} cor={r.rede_usb === 'R' ? '#2E8B57' : '#FFD700'} /> },
    { titulo: 'Previsão', alinhar: 'c', estilo: atrasada, render: (r) => dataBr(r.data_leitura_prevista) },
    { titulo: 'Última Captura', alinhar: 'c', estilo: atrasada, render: (r) => dataHoraBr(r.datahora_leitura_auto) },
    { titulo: 'PB Anterior', alinhar: 'd', render: (r) => inteiro(r.leitura_pb_anterior) },
    { titulo: 'PB Atual', alinhar: 'd', render: (r) => inteiro(r.leitura_pb) },
    { titulo: 'Color Anterior', alinhar: 'd', render: (r) => inteiro(r.leitura_color_anterior) },
    { titulo: 'Color Atual', alinhar: 'd', render: (r) => inteiro(r.leitura_color) },
    { titulo: 'Cliente', campo: 'nome' },
    { titulo: 'Marca', campo: 'equip_marca' },
    { titulo: 'Modelo', campo: 'equip_modelo' },
    { titulo: 'Setor', campo: 'setor' },
    { titulo: 'Fone', campo: 'fone_fixo' },
    { titulo: 'Celular', campo: 'fone_celular1' },
    { titulo: 'Dia Leitura', campo: 'dia_leitura', alinhar: 'c' },
    { titulo: 'Id Cliente', campo: 'id_cliente', alinhar: 'c' },
    { titulo: 'Id Equip.', campo: 'id_equip', alinhar: 'c' },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
        <span className="text-sm font-bold text-stone-800 dark:text-stone-100 mr-2">Pré-Leituras</span>
        <BotaoBarra icone={ListPlus} texto="Gerar Pré-Leituras" primario onClick={() => setDialogo('gerar')} />
        <BotaoBarra icone={RefreshCw} texto="Atualizar" onClick={() => carregarLotes()} />
        <BotaoBarra icone={ArrowLeft} texto="Voltar" onClick={onVoltar} />
      </div>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-2" />}
      <div className="flex-1 flex min-h-0">
        <div className="w-[300px] shrink-0 flex flex-col border-r border-stone-200 dark:border-stone-800">
          <div className="px-3 py-2 text-xs font-semibold text-stone-600 dark:text-stone-300 border-b border-stone-200 dark:border-stone-800">Pré-Leituras</div>
          <Grade nome="locacoes.preLotes" colunas={colLotes} linhas={lotes} selecionada={loteId ?? undefined} onSelecionar={(r) => setLoteId(r.id)} carregando={carregando} vazio="Nenhum lote gerado." onToast={onToast} />
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-stone-200 dark:border-stone-800">
            <span className="text-xs font-semibold text-stone-600 dark:text-stone-300 mr-1">Leituras</span>
            <BotaoBarra
              icone={Download}
              texto="Capturar Leitura"
              disabled={!item || !!ocupado}
              carregando={ocupado === 'capturar'}
              onClick={() =>
                processo('capturar', async () => {
                  const r = await api.post<{ capturada: boolean }>(`/api/locacoes/pre-leituras/itens/${item!.id}/capturar`);
                  return r.capturada ? 'Leitura capturada.' : 'Nenhuma leitura automática até a data: status ZERADO.';
                })
              }
            />
            <BotaoBarra
              icone={Send}
              texto="Lançar Leituras"
              disabled={!loteId || !!ocupado}
              carregando={ocupado === 'lancar'}
              onClick={() =>
                processo('lancar', async () => {
                  const r = await api.post<{ lancadas: number; ignoradas: number }>(`/api/locacoes/pre-leituras/${loteId}/lancar`);
                  onFiltrarContratos(loteId!);
                  return `${r.lancadas} leitura(s) lançada(s)${r.ignoradas ? `; ${r.ignoradas} sem contrato ativo para o contador` : ''}.`;
                })
              }
            />
            <BotaoBarra
              icone={DownloadCloud}
              texto="Capturar Todas"
              disabled={!itens.length || !!ocupado}
              carregando={ocupado === 'todas'}
              onClick={() =>
                processo('todas', async () => {
                  const r = await api.post<{ capturadas: number; zeradas: number }>(`/api/locacoes/pre-leituras/${loteId}/capturar-todas`);
                  return `${r.capturadas} capturada(s), ${r.zeradas} sem leitura automática.`;
                })
              }
            />
            <MaisAcoes
              itens={[
                { icone: Filter, titulo: 'Filtrar Contratos', disabled: !loteId, onClick: () => loteId && onFiltrarContratos(loteId) },
                { icone: Gauge, titulo: 'Listar Leituras', disabled: !item, onClick: () => setDialogo('snmp') },
              ]}
            />
          </div>
          <Grade
            nome="locacoes.preItens"
            colunas={colItens}
            linhas={itens}
            selecionada={itemId ?? undefined}
            onSelecionar={(r) => setItemId(r.id)}
            onDuploClique={() => setDialogo('editar')}
            carregando={carregandoItens}
            vazio="Nenhuma leitura neste lote."
            onToast={onToast}
            acoes={(r) => (
              <span className="inline-flex gap-1">
                <BotaoAcao icone={Pencil} titulo="Editar" descricao="Altera a pré-leitura" onClick={() => (setItemId(r.id), setDialogo('editar'))} />
                <BotaoAcao icone={Trash2} titulo="Excluir" descricao="Exclui a pré-leitura do lote" tom="perigo" onClick={() => (setItemId(r.id), setDialogo('excluir'))} />
              </span>
            )}
          />
        </div>
      </div>

      {dialogo === 'gerar' && (
        <GerarPreLeituras
          onToast={onToast}
          onFechar={() => setDialogo(null)}
          onGravado={(id, n) => {
            setDialogo(null);
            carregarLotes(id);
            onToast(`Número de leituras gravadas: ${n}`);
          }}
        />
      )}
      {dialogo === 'editar' && item && recursoItem && (
        <JanelaForm
          titulo={`Pré-leitura — ${item.nr_serie ?? ''} · ${item.nome ?? ''}`}
          resource={recursoItem}
          record={item}
          refOptions={{}}
          onCancel={() => setDialogo(null)}
          onSave={async (payload) => {
            await updateRecord('locacao_pre_leituras_leituras', item.id, payload);
            setDialogo(null);
            carregarItens();
          }}
        />
      )}
      {dialogo === 'excluir' && item && (
        <ConfirmDialog
          titulo="Excluir esta pré-leitura do lote?"
          mensagem={`${item.nr_serie ?? ''} — ${item.nome ?? ''}`}
          onConfirmar={async () => {
            await deleteRecord('locacao_pre_leituras_leituras', item.id);
            setDialogo(null);
            carregarItens();
          }}
          onCancelar={() => setDialogo(null)}
        />
      )}
      {dialogo === 'snmp' && item && <HistoricoSnmp nrSerie={item.nr_serie ?? ''} onFechar={() => setDialogo(null)} onToast={onToast} />}
    </div>
  );
};

/** Diálogo "Gerar Pré-Leituras": seleciona os contratos ativos e grava um lote novo */
const GerarPreLeituras: React.FC<{ onFechar: () => void; onGravado: (id: number, gravadas: number) => void; onToast: (m: string) => void }> = ({ onFechar, onGravado, onToast }) => {
  const [data, setData] = useState(hoje());
  const [dia, setDia] = useState(0);
  const [cliente, setCliente] = useState('');
  const [clientes, setClientes] = useState<OpcaoRef[]>([]);
  const [linhas, setLinhas] = useState<(RegistroCrud & { ok: boolean })[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api.get('/api/locacoes/lookups').then((l) => setClientes(l.id_cliente ?? [])).catch((e) => setErro(e.message));
  }, []);

  const selecionar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.get<RegistroCrud[]>(`/api/locacoes/pre-leituras-selecao?dia=${dia}&id_cliente=${cliente || 0}`);
      setLinhas(r.map((x) => ({ ...x, ok: true })));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  };

  const gravar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.post<{ id: number; gravadas: number }>('/api/locacoes/pre-leituras', {
        data,
        dia,
        id_cliente: cliente || 0,
        nome_cliente: clientes.find((c) => c.value === cliente)?.label ?? '',
        ids: (linhas ?? []).filter((l) => l.ok).map((l) => l.id_contrato),
      });
      onGravado(r.id, r.gravadas);
    } catch (e: any) {
      setErro(e.message);
      setOcupado(false);
    }
  };

  const marcarTodos = (ok: boolean) => setLinhas((l) => l?.map((x) => ({ ...x, ok })) ?? null);
  const colunas: Coluna<RegistroCrud & { ok: boolean }>[] = [
    {
      titulo: 'OK',
      alinhar: 'c',
      render: (r) => <Toggle size="sm" checked={r.ok} onChange={(v) => setLinhas((l) => l?.map((x) => (x.id_contrato === r.id_contrato ? { ...x, ok: v } : x)) ?? null)} />,
      total: (rows) => `${rows.filter((x) => x.ok).length} de ${rows.length}`,
    },
    { titulo: 'Contrato', campo: 'id_contrato', alinhar: 'c' },
    { titulo: 'Cliente', campo: 'nome' },
    { titulo: 'Nr. Série', campo: 'nr_serie' },
    { titulo: 'Color', alinhar: 'c', render: (r) => (r.color === 'S' ? <Selo texto="COR" cor="#4682B4" /> : 'P&B') },
    { titulo: 'Marca', campo: 'marca' },
    { titulo: 'Modelo', campo: 'modelo' },
    { titulo: 'Setor', campo: 'setor' },
    { titulo: 'Dia Leitura', campo: 'dia_leitura', alinhar: 'c' },
    { titulo: 'Data Leitura', alinhar: 'c', render: () => dataBr(data) },
    { titulo: 'ID Cliente', campo: 'id_cliente', alinhar: 'c' },
    { titulo: 'ID Equip.', campo: 'id_equip', alinhar: 'c' },
  ];

  return (
    <Janela
      titulo="Gerar Pré-Leituras"
      subtitulo="Contratos ativos a ler: grava um lote novo com os marcados"
      onFechar={onFechar}
      ocupado={ocupado}
      largura="max-w-6xl"
      rodape={
        <>
          <BotaoBarra icone={Search} texto="Marcar Todos" disabled={!linhas?.length} onClick={() => marcarTodos(true)} />
          <BotaoBarra icone={Eraser} texto="Desmarcar Todos" disabled={!linhas?.length} onClick={() => marcarTodos(false)} />
          <BotaoBarra icone={Save} texto="Gravar Novo Lote Leituras" primario carregando={ocupado && !!linhas} disabled={!linhas} onClick={gravar} />
        </>
      }
    >
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div className="flex flex-col gap-1 w-40">
          <label className={LABEL_CLASS}>Leitura até</label>
          <DateField value={data} onChange={setData} required />
        </div>
        <div className="flex flex-col gap-1 w-80">
          <label className={LABEL_CLASS}>Filtrar cliente</label>
          <SelectBusca value={cliente} options={clientes} onChange={setCliente} vazioLabel="— Todos os clientes —" />
        </div>
        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASS}>Dia leitura</label>
          <select value={dia} onChange={(e) => setDia(Number(e.target.value))} className={`${INPUT_CLASS} h-[38px]`}>
            {Array.from({ length: 32 }, (_, i) => (
              <option key={i} value={i}>
                {i === 0 ? '00 (todos)' : String(i).padStart(2, '0')}
              </option>
            ))}
          </select>
        </div>
        <BotaoBarra
          icone={Eraser}
          texto="Limpar"
          onClick={() => {
            setDia(0);
            setData(hoje());
            setCliente('');
          }}
        />
        <BotaoBarra icone={Search} texto="Selecionar" primario onClick={selecionar} carregando={ocupado && !linhas} />
      </div>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      <div className="text-xs font-semibold text-stone-600 dark:text-stone-300 mb-1">Impressoras Selecionadas</div>
      <div className="flex flex-col h-[50vh] border border-stone-200 dark:border-stone-800 rounded-lg">
        <Grade
          nome="locacoes.preSelecao"
          colunas={colunas}
          linhas={linhas ?? []}
          chave="id_contrato"
          vazio={linhas ? 'Nenhum contrato ativo com estes filtros.' : 'Escolha os filtros e clique em Selecionar.'}
          onToast={onToast}
        />
      </div>
    </Janela>
  );
};
