import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, ClipboardCheck, FilePlus2, Gauge, Layers, ListChecks, Pencil, Plus, Power, PowerOff, Receipt, RefreshCw, Trash2, Truck, Users, X } from 'lucide-react';
import type { OpcaoRef, RegistroCrud, ResourceDef } from '../../types';
import { api, createRecord, deleteRecord, updateRecord } from '../../services/api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { AvisoErro } from '../../components/AvisoErro';
import { Toggle } from '../../components/Toggle';
import { BotaoAcao } from '../../components/MenuAcoes';
import { MaisAcoes } from '../../components/MaisAcoes';
import { INPUT_CLASS } from '../../utils/formStyles';
import { BotaoBarra, Coluna, Grade, JanelaForm, Selo, dataBr, inteiro, moeda } from './ui';
import { Agrupamento, Conferencia, HistoricoSnmp } from './dialogos';

const LIVRE = <Selo texto="LIVRE" cor="#4682B4" />;
/** A lista traz S/N; o formulário genérico espera 1/0 nos toggles */
const paraForm = (r: RegistroCrud) => ({ ...r, ...Object.fromEntries(['ativo', 'color', 'juntar_nota', 'juntar_financ'].map((k) => [k, r[k] === 'S' ? 1 : 0])) });

interface Props {
  resources: ResourceDef[];
  onToast: (m: string) => void;
  refreshToken: number;
  onNavigate: (tela: string) => void;
  /** Filtro "contratos do lote de pré-leituras" (Filtrar Contratos / Lançar Leituras) */
  lote: number | null;
  onLimparLote: () => void;
  onVendedores: () => void;
  onPreLeituras: () => void;
}

export const AbaContratos: React.FC<Props> = ({ resources, onToast, refreshToken, onNavigate, lote, onLimparLote, onVendedores, onPreLeituras }) => {
  const recurso = resources.find((r) => r.name === 'locacao_contratos');
  const [filtro, setFiltro] = useState({ nome: '', nr_serie: '', ativo: 'T' });
  const [linhas, setLinhas] = useState<RegistroCrud[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const [lookups, setLookups] = useState<Record<string, OpcaoRef[]>>({});
  const [editando, setEditando] = useState<{ record: RegistroCrud | null } | null>(null);
  const [excluindo, setExcluindo] = useState<RegistroCrud | null>(null);
  const [ativando, setAtivando] = useState<RegistroCrud | null>(null);
  const [dialogo, setDialogo] = useState<null | 'agrupamento' | 'conferencia' | 'os' | 'snmp'>(null);
  const [recarga, setRecarga] = useState(0);

  const sel = linhas.find((l) => l.id === selId) ?? null;

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const qs = new URLSearchParams({ ...filtro, ativo: lote ? 'S' : filtro.ativo });
      if (lote) qs.set('id_leitura', String(lote));
      const [rows, lk] = await Promise.all([api.get<RegistroCrud[]>(`/api/locacoes/contratos?${qs}`), api.get('/api/locacoes/lookups')]);
      setLinhas(rows);
      setLookups(lk);
      setSelId((s) => (rows.some((r) => r.id === s) ? s : (rows[0]?.id ?? null)));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [filtro, lote]);

  // Filtros de coluna recarregam a lista (com uma pausa para a digitação)
  useEffect(() => {
    const t = setTimeout(carregar, 300);
    return () => clearTimeout(t);
  }, [carregar, refreshToken, recarga]);

  const salvar = async (payload: RegistroCrud) => {
    let id = editando?.record?.id;
    if (id) await updateRecord('locacao_contratos', id, payload);
    else id = (await createRecord('locacao_contratos', payload)).id;
    setEditando(null);
    setSelId(Number(id));
    setRecarga((r) => r + 1);
    // Aviso do Delphi (não impede a gravação)
    const { contratos } = await api.get<{ contratos: { id: number; nome: string; color: string }[] }>(`/api/locacoes/contratos/${id}/alocado`);
    if (contratos.length) onToast(`Esse equipamento já está alocado para: ${contratos.map((c) => `${c.nome ?? '?'} (contrato ${c.id}${c.color === 'S' ? ', cor' : ''})`).join('; ')}`);
  };

  const colunas: Coluna<RegistroCrud>[] = [
    { titulo: 'Nome', campo: 'cliente_nome', largura: 220, fixa: true },
    { titulo: 'G', alinhar: 'c', render: (r) => (r.codigo_grupo ? <Selo texto={r.codigo_grupo} cor="#4682B4" /> : null) },
    { titulo: 'Ativo', alinhar: 'c', render: (r) => (r.ativo === 'S' ? <Selo texto="SIM" /> : <Selo texto="NÃO" />) },
    { titulo: 'ID/Cliente', campo: 'id_cliente', alinhar: 'c', oculta: true },
    { titulo: 'Id/Equip', campo: 'id_equip', alinhar: 'c' },
    { titulo: 'Nr.Série', campo: 'nr_serie', largura: 120 },
    { titulo: 'Color', alinhar: 'c', render: (r) => (r.color === 'S' ? <Selo texto="COR" cor="#4682B4" /> : <Selo texto="P&B" />) },
    { titulo: 'Rede/USB', alinhar: 'c', render: (r) => <Selo texto={r.rede_usb === 'R' ? 'REDE' : 'USB'} cor={r.rede_usb === 'R' ? '#2E8B57' : '#FFD700'} /> },
    { titulo: 'Equipamento', campo: 'equip_descricao', largura: 140 },
    { titulo: 'Vendedor', campo: 'vendedor_nome' },
    { titulo: 'Grupo', campo: 'codigo_grupo', alinhar: 'c', oculta: true },
    { titulo: 'Setor', campo: 'setor' },
    { titulo: 'Dia Leitura', campo: 'dia_leitura', alinhar: 'c' },
    { titulo: 'Dia Vencto.', campo: 'dia_vencimento', alinhar: 'c' },
    { titulo: 'Nr. Cópias', alinhar: 'c', render: (r) => (Number(r.nr_copias) === 0 ? LIVRE : inteiro(r.nr_copias)) },
    { titulo: 'Valor Locação R$', alinhar: 'd', render: (r) => (Number(r.valor_contrato) === 0 ? LIVRE : moeda(r.valor_contrato)) },
    { titulo: 'Valor Cópia R$', alinhar: 'd', render: (r) => moeda(r.valor_copia, 5) },
    { titulo: 'Valor Excedente R$', alinhar: 'd', render: (r) => moeda(r.valor_excedente, 5) },
    { titulo: 'Data Contrato', alinhar: 'c', render: (r) => dataBr(r.data_contrato) },
    { titulo: 'Validade', alinhar: 'c', render: (r) => dataBr(r.data_vencimento) },
    { titulo: 'Série / NF', alinhar: 'c', render: (r) => r.serie_nf ?? '', oculta: true },
    { titulo: 'Observações', campo: 'obs', largura: 200 },
    { titulo: 'ID/Contrato', campo: 'id', alinhar: 'c', oculta: true },
  ];

  const acoes = (r: RegistroCrud) => (
    <span className="inline-flex gap-1">
      <BotaoAcao icone={Pencil} titulo="Editar" descricao="Altera o contrato" onClick={() => setEditando({ record: paraForm(r) })} />
      {r.ativo === 'S' ? (
        <BotaoAcao icone={PowerOff} titulo="Inativar" descricao="Inativa o contrato" onClick={() => setAtivando(r)} />
      ) : (
        <BotaoAcao icone={Power} titulo="Ativar" descricao="Ativa o contrato" tom="verde" onClick={() => setAtivando(r)} />
      )}
      <BotaoAcao icone={Trash2} titulo="Excluir" descricao="Exclui o contrato" tom="perigo" onClick={() => setExcluindo(r)} />
    </span>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
        <BotaoBarra icone={FilePlus2} texto="Novo" primario onClick={() => setEditando({ record: null })} />
        <BotaoBarra icone={RefreshCw} texto="Atualizar" onClick={() => setRecarga((r) => r + 1)} />
        <BotaoBarra icone={ListChecks} texto="Pré-Leituras" onClick={onPreLeituras} />
        <BotaoBarra icone={Receipt} texto="Faturamento" onClick={() => onNavigate('faturamento')} />
        <MaisAcoes
          itens={[
            { icone: Layers, titulo: 'Agrupamento', onClick: () => setDialogo('agrupamento') },
            { icone: Users, titulo: 'Vendedores', onClick: onVendedores },
            { icone: ClipboardCheck, titulo: 'Conferência', onClick: () => setDialogo('conferencia') },
            { icone: Truck, titulo: 'Gerar OS Entrega', disabled: !sel, onClick: () => setDialogo('os') },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-stone-200 dark:border-stone-800">
        <select
          value={lote ? 'S' : filtro.ativo}
          disabled={Boolean(lote)}
          onChange={(e) => setFiltro((f) => ({ ...f, ativo: e.target.value }))}
          className={`${INPUT_CLASS} w-28 h-[38px]`}
          title="Ativo"
        >
          <option value="T">Todos</option>
          <option value="S">Ativos</option>
          <option value="N">Inativos</option>
        </select>
        <input
          value={filtro.nome}
          onChange={(e) => setFiltro((f) => ({ ...f, nome: e.target.value.toUpperCase() }))}
          onFocus={(e) => e.target.select()}
          placeholder="Nome do cliente (início)"
          className={`${INPUT_CLASS} w-64 h-[38px]`}
        />
        <input
          value={filtro.nr_serie}
          onChange={(e) => setFiltro((f) => ({ ...f, nr_serie: e.target.value.toUpperCase() }))}
          onFocus={(e) => e.target.select()}
          placeholder="Nr. série (início)"
          className={`${INPUT_CLASS} w-48 h-[38px]`}
        />
        {lote && (
          <span className="inline-flex items-center gap-1.5 h-[30px] pl-3 pr-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900">
            Contratos do lote de pré-leituras nº {lote}
            <button type="button" onClick={onLimparLote} title="Tirar o filtro do lote" className="p-1 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        )}
        <span className="ml-auto text-[11px] text-stone-500">{linhas.length} contrato(s)</span>
      </div>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-2" />}
      <Grade
        nome="locacoes.contratos"
        colunas={colunas}
        linhas={linhas}
        selecionada={selId ?? undefined}
        onSelecionar={(r) => setSelId(r.id)}
        onDuploClique={(r) => setEditando({ record: paraForm(r) })}
        carregando={carregando}
        vazio="Nenhum contrato."
        rolarParaSelecionada
        acoes={acoes}
        larguraAcoes="w-28 min-w-28 max-w-28"
        onToast={onToast}
      />

      {sel && <PainelLeituras contrato={sel} resources={resources} onSnmp={() => setDialogo('snmp')} onToast={onToast} />}

      {editando && recurso && (
        <JanelaForm
          titulo={editando.record ? `Contrato ${editando.record.id} — ${editando.record.cliente_nome ?? ''}` : 'Novo contrato'}
          resource={recurso}
          record={editando.record}
          refOptions={lookups}
          onCancel={() => setEditando(null)}
          onSave={salvar}
        />
      )}
      {excluindo && (
        <ConfirmDialog
          titulo={`Excluir o contrato ${excluindo.id}?`}
          mensagem={`${excluindo.cliente_nome ?? ''} — ${excluindo.nr_serie ?? ''}. Contrato com leituras não pode ser excluído (inative-o).`}
          onConfirmar={async () => {
            await deleteRecord('locacao_contratos', excluindo.id);
            setExcluindo(null);
            setRecarga((r) => r + 1);
          }}
          onCancelar={() => setExcluindo(null)}
        />
      )}
      {ativando && (
        <ConfirmDialog
          titulo={`${ativando.ativo === 'S' ? 'Inativar' : 'Ativar'} o contrato ${ativando.id}?`}
          mensagem={`${ativando.cliente_nome ?? ''} — ${ativando.nr_serie ?? ''}`}
          confirmar={ativando.ativo === 'S' ? 'Inativar' : 'Ativar'}
          tom={ativando.ativo === 'S' ? 'perigo' : 'normal'}
          onConfirmar={async () => {
            const ativo = ativando.ativo === 'S' ? 'N' : 'S';
            await updateRecord('locacao_contratos', ativando.id, { ativo: ativo === 'S' ? 1 : 0 });
            setLinhas((ls) => ls.map((l) => (l.id === ativando.id ? { ...l, ativo } : l)));
            setAtivando(null);
          }}
          onCancelar={() => setAtivando(null)}
        />
      )}
      {dialogo === 'os' && sel && (
        <ConfirmDialog
          titulo="Gerar a OS de entrega?"
          mensagem={`Contrato ${sel.id}: ${sel.cliente_nome ?? ''} — ${sel.nr_serie ?? ''}`}
          confirmar="Gerar OS"
          tom="normal"
          onConfirmar={async () => {
            const r = await api.post<{ id: number }>(`/api/locacoes/contratos/${sel.id}/os-entrega`);
            setDialogo(null);
            onToast(`OS de entrega nº ${r.id} gerada.`);
          }}
          onCancelar={() => setDialogo(null)}
        />
      )}
      {dialogo === 'agrupamento' && (
        <Agrupamento
          codigoInicial={sel?.codigo_grupo ?? ''}
          onFechar={() => {
            setDialogo(null);
            setRecarga((r) => r + 1);
          }}
          onToast={onToast}
        />
      )}
      {dialogo === 'conferencia' && (
        <Conferencia
          onToast={onToast}
          onFechar={() => setDialogo(null)}
          onIrPara={(id) => {
            setDialogo(null);
            if (linhas.some((l) => l.id === id)) setSelId(id);
            else onToast(`O contrato ${id} não está na lista atual (confira os filtros).`);
          }}
        />
      )}
      {dialogo === 'snmp' && sel && <HistoricoSnmp nrSerie={sel.nr_serie ?? ''} onFechar={() => setDialogo(null)} onToast={onToast} />}
    </div>
  );
};

/** Painel "Leituras" do contrato selecionado */
const PainelLeituras: React.FC<{ contrato: RegistroCrud; resources: ResourceDef[]; onSnmp: () => void; onToast: (m: string) => void }> = ({ contrato, resources, onSnmp, onToast }) => {
  const recurso = resources.find((r) => r.name === 'locacao_leituras');
  const [linhas, setLinhas] = useState<RegistroCrud[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const [editando, setEditando] = useState<{ record: RegistroCrud | null; padrao?: RegistroCrud } | null>(null);
  const [excluindo, setExcluindo] = useState<RegistroCrud | null>(null);
  const [recalculando, setRecalculando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const rows = await api.get<RegistroCrud[]>(`/api/locacoes/contratos/${contrato.id}/leituras`);
      setLinhas(rows);
      setSelId((s) => (rows.some((r) => r.id === s) ? s : (rows[0]?.id ?? null)));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [contrato.id]);

  useEffect(() => {
    carregar();
  }, [carregar, contrato]);

  const inserir = async () => {
    try {
      setEditando({ record: null, padrao: await api.get(`/api/locacoes/contratos/${contrato.id}/nova-leitura`) });
    } catch (e: any) {
      setErro(e.message);
    }
  };

  /** Formulário: sem a chave do contrato; na inclusão os campos já vêm com a última leitura e o vencimento */
  const recursoForm = useMemo(() => {
    if (!recurso) return null;
    const p = editando?.padrao;
    return {
      ...recurso,
      fields: recurso.fields
        .filter((f) => f.name !== 'id_contrato')
        .map((f) => (p && p[f.name] !== undefined && p[f.name] !== null ? { ...f, default: f.type === 'boolean' ? p[f.name] === 'S' : String(p[f.name]) } : f)),
    };
  }, [recurso, editando?.padrao]);

  const alternarFaturado = async (r: RegistroCrud, v: boolean) => {
    try {
      await updateRecord('locacao_leituras', r.id, { status_fatur: v ? 1 : 0 });
      carregar();
    } catch (e: any) {
      setErro(e.message);
    }
  };

  const colunas: Coluna<RegistroCrud>[] = [
    { titulo: 'Faturado', alinhar: 'c', render: (r) => <Toggle size="sm" checked={Number(r.status_fatur) === 1} onChange={(v) => alternarFaturado(r, v)} /> },
    { titulo: 'Data Leitura', alinhar: 'c', render: (r) => dataBr(r.data_leitura) },
    { titulo: 'Data Vencto.', alinhar: 'c', render: (r) => dataBr(r.data_vencimento) },
    { titulo: 'Leitura Anterior', alinhar: 'd', render: (r) => inteiro(r.leitura_anterior) },
    { titulo: 'Leitura Atual', alinhar: 'd', render: (r) => inteiro(r.leitura_atual) },
    { titulo: 'Total R$', alinhar: 'd', negrito: true, render: (r) => moeda(r.valor_total_geral) },
    { titulo: 'Nr. Cópias (Mês)', alinhar: 'd', render: (r) => inteiro(r.nr_copias_mes) },
    { titulo: 'Nr. Cópias (Total)', alinhar: 'd', render: (r) => inteiro(r.nr_copias_total) },
    { titulo: 'Nr. Cópias (Contrato)', alinhar: 'c', render: (r) => (Number(r.nr_copias_contrato) === 0 ? LIVRE : inteiro(r.nr_copias_contrato)) },
    { titulo: 'Nr. Cópias (Exced.)', alinhar: 'd', render: (r) => inteiro(r.nr_copias_excedente) },
    { titulo: 'ND', alinhar: 'd', render: (r) => inteiro(r.nd) },
    { titulo: 'Valor Unit. R$', alinhar: 'd', render: (r) => moeda(r.valor_copia_unit, 5) },
    { titulo: 'Valor Total R$', alinhar: 'd', render: (r) => moeda(r.valor_copia_total) },
    { titulo: 'Valor Unit (Exced.)', alinhar: 'd', render: (r) => moeda(r.valor_copia_unit_excedente, 5) },
    { titulo: 'Valor Total (Exced.)', alinhar: 'd', render: (r) => moeda(r.valor_copia_total_excedente) },
    { titulo: 'G', alinhar: 'c', render: (r) => (r.grupo_acertado === 'S' ? <Selo texto="A" cor="#4682B4" title="Acertado no agrupamento" /> : null) },
    { titulo: 'Observações', campo: 'obs' },
  ];

  const sel = linhas.find((l) => l.id === selId);
  return (
    <div
      className="h-[40%] min-h-[220px] shrink-0 flex flex-col border-t-2 border-blue-500/60 bg-white dark:bg-stone-900 outline-none"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Insert') {
          e.preventDefault();
          inserir();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-1.5 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/60">
        <span className="text-xs font-bold text-stone-700 dark:text-stone-200 mr-2">
          Leituras <span className="font-normal text-stone-500">— contrato {contrato.id} · {contrato.cliente_nome ?? ''} · {contrato.nr_serie ?? ''} {contrato.color === 'S' ? '(cor)' : '(P&B)'}</span>
        </span>
        <BotaoBarra icone={Plus} texto="Inserir" primario onClick={inserir} title="Nova leitura (tecla Insert)" />
        <BotaoBarra icone={Calculator} texto="Recalcular" disabled={!sel} carregando={recalculando} onClick={() => setRecalculando(true)} title="Refaz os valores da leitura selecionada com os preços atuais do contrato" />
        <BotaoBarra icone={Gauge} texto="Leituras" onClick={onSnmp} title="Histórico das leituras automáticas (SNMP) do equipamento" />
      </div>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-2" />}
      <Grade
        nome="locacoes.leituras"
        colunas={colunas}
        linhas={linhas}
        selecionada={selId ?? undefined}
        onSelecionar={(r) => setSelId(r.id)}
        onDuploClique={(r) => setEditando({ record: r })}
        carregando={carregando}
        vazio="Nenhuma leitura deste contrato."
        onToast={onToast}
        acoes={(r) => (
          <span className="inline-flex gap-1">
            <BotaoAcao icone={Pencil} titulo="Editar" descricao="Altera a leitura" onClick={() => setEditando({ record: r })} />
            <BotaoAcao icone={Trash2} titulo="Excluir" descricao="Exclui a leitura" tom="perigo" onClick={() => setExcluindo(r)} />
          </span>
        )}
      />

      {editando && recursoForm && (
        <JanelaForm
          titulo={editando.record ? `Leitura de ${dataBr(editando.record.data_leitura)}` : `Nova leitura — contrato ${contrato.id}`}
          resource={recursoForm}
          record={editando.record}
          refOptions={{}}
          onCancel={() => setEditando(null)}
          onSave={async (payload) => {
            if (editando.record) await updateRecord('locacao_leituras', editando.record.id, payload);
            else {
              const r = await createRecord('locacao_leituras', { ...payload, id_contrato: contrato.id });
              setSelId(Number(r.id));
            }
            setEditando(null);
            carregar();
          }}
        />
      )}
      {excluindo && (
        <ConfirmDialog
          titulo={`Excluir a leitura de ${dataBr(excluindo.data_leitura)}?`}
          mensagem={`Leitura ${inteiro(excluindo.leitura_atual)} — total ${moeda(excluindo.valor_total_geral)}.`}
          onConfirmar={async () => {
            await deleteRecord('locacao_leituras', excluindo.id);
            setExcluindo(null);
            carregar();
          }}
          onCancelar={() => setExcluindo(null)}
        />
      )}
      {recalculando && sel && (
        <ConfirmDialog
          titulo="Confirma refazer os valores?"
          mensagem={`Leitura de ${dataBr(sel.data_leitura)}: recopia os preços do contrato, recalcula franquia/excedente e desfaz o acerto de grupo.`}
          confirmar="Recalcular"
          tom="normal"
          onConfirmar={async () => {
            await api.post(`/api/locacoes/leituras/${sel.id}/recalcular`);
            setRecalculando(false);
            onToast('Valores da leitura refeitos.');
            carregar();
          }}
          onCancelar={() => setRecalculando(false)}
        />
      )}
    </div>
  );
};
