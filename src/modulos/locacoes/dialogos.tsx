import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, CornerDownRight, Printer, Scale, Search } from 'lucide-react';
import type { RegistroCrud } from '../../types';
import { api, baixarArquivo } from '../../services/api';
import { Janela } from '../../components/Janela';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { AvisoErro } from '../../components/AvisoErro';
import { INPUT_CLASS } from '../../utils/formStyles';
import { BotaoBarra, Coluna, Grade, Selo, dataBr, dataHoraBr, hoje, inteiro, moeda } from './ui';

const soma = (campo: string, f: (v: number) => string = inteiro) => (rows: RegistroCrud[]) => f(rows.reduce((t, r) => t + (Number(r[campo]) || 0), 0));

// ---------------------------------------------------------------------------------------------
// Agrupamento de Leituras
// ---------------------------------------------------------------------------------------------

export const Agrupamento: React.FC<{ codigoInicial: string; onFechar: () => void; onToast: (m: string) => void }> = ({ codigoInicial, onFechar, onToast }) => {
  const [codigo, setCodigo] = useState(codigoInicial);
  const [dados, setDados] = useState<{ leituras: RegistroCrud[]; total: RegistroCrud | null } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const gerar = async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDados(await api.get(`/api/locacoes/agrupamento?codigo=${encodeURIComponent(codigo.trim())}`));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  };
  useEffect(() => {
    if (codigoInicial) gerar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const colunas: Coluna<RegistroCrud>[] = [
    { titulo: 'A', alinhar: 'c', render: (r) => (r.grupo_acertado === 'S' ? <Selo texto="S" cor="#2E8B57" /> : '') },
    { titulo: 'G', campo: 'codigo_grupo', alinhar: 'c' },
    { titulo: 'Data Leitura', alinhar: 'c', render: (r) => dataBr(r.data_leitura) },
    { titulo: 'Data Vencimento', alinhar: 'c', render: (r) => dataBr(r.data_vencimento) },
    { titulo: 'Equipamento', campo: 'equip_descricao_total' },
    { titulo: 'Nr. Série', campo: 'nr_serie' },
    { titulo: 'Leitura Anterior', alinhar: 'd', render: (r) => inteiro(r.leitura_anterior) },
    { titulo: 'Leitura Atual', alinhar: 'd', render: (r) => inteiro(r.leitura_atual) },
    { titulo: 'Cópias Mês', alinhar: 'd', render: (r) => inteiro(r.nr_copias_mes), total: soma('nr_copias_mes') },
    { titulo: 'Cópias Contrato', alinhar: 'd', render: (r) => inteiro(r.nr_copias_contrato), total: soma('nr_copias_contrato') },
    { titulo: 'Cópias Excedente', alinhar: 'd', render: (r) => inteiro(r.nr_copias_excedente), total: soma('nr_copias_excedente') },
    { titulo: 'Valor Total', alinhar: 'd', render: (r) => moeda(r.valor_copia_total), total: soma('valor_copia_total', moeda) },
    { titulo: 'Valor Total Exced.', alinhar: 'd', render: (r) => moeda(r.valor_copia_total_excedente), total: soma('valor_copia_total_excedente', moeda) },
    { titulo: 'Total Geral', alinhar: 'd', negrito: true, render: (r) => moeda(r.valor_total_geral), total: soma('valor_total_geral', moeda) },
    { titulo: 'Valor Original Total Exced.', alinhar: 'd', render: (r) => moeda(r.valor_copia_total_excedente_original) },
  ];
  const t = dados?.total;
  const colTotal: Coluna<RegistroCrud>[] = [
    { titulo: 'G', campo: 'codigo_grupo', alinhar: 'c' },
    { titulo: 'Total Mês', alinhar: 'd', render: (r) => inteiro(r.nr_copias_mes) },
    { titulo: 'Total Contrato', alinhar: 'd', render: (r) => inteiro(r.nr_copias_contrato) },
    { titulo: 'Total R$ Mês', alinhar: 'd', render: (r) => moeda(r.valor_total_geral) },
    { titulo: 'Total R$ Contrato', alinhar: 'd', render: (r) => moeda(r.valor_contrato) },
  ];

  return (
    <Janela
      titulo="Agrupamento de Leituras"
      subtitulo="Leituras a faturar do grupo: franquia compartilhada ou valor mínimo"
      onFechar={onFechar}
      largura="max-w-[95vw]"
      rodape={<BotaoBarra icone={Scale} texto="Acertar Valores" primario disabled={!dados?.leituras.length} onClick={() => setConfirmando(true)} />}
    >
      <div className="flex items-center gap-2 mb-3">
        <input
          value={codigo}
          maxLength={30}
          onChange={(e) => setCodigo(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => e.key === 'Enter' && gerar()}
          placeholder="Grupo"
          className={`${INPUT_CLASS} w-40 h-[38px]`}
        />
        <BotaoBarra icone={Search} texto="Gerar" onClick={gerar} carregando={carregando} disabled={!codigo.trim()} />
      </div>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      <div className="text-xs font-semibold text-stone-600 dark:text-stone-300 mb-1">Leituras do Grupo</div>
      <div className="flex flex-col h-[45vh] border border-stone-200 dark:border-stone-800 rounded-lg">
        <Grade nome="locacoes.agrupamento" colunas={colunas} linhas={dados?.leituras ?? []} carregando={carregando} vazio="Gere o grupo para ver as leituras a faturar." onToast={onToast} />
      </div>
      <div className="text-xs font-semibold text-stone-600 dark:text-stone-300 mt-3 mb-1">Totalização do Grupo</div>
      <div className="flex flex-col h-[92px] border border-stone-200 dark:border-stone-800 rounded-lg">
        <Grade
          nome="locacoes.agrupamentoTotal"
          chave="codigo_grupo"
          colunas={colTotal}
          linhas={t ? [t] : []}
          vazio="Sem totais."
          onToast={onToast}
        />
      </div>
      {confirmando && (
        <ConfirmDialog
          titulo="Confirma acertar os valores das leituras?"
          mensagem={
            Number(t?.nr_copias_contrato) > 0
              ? 'Franquia compartilhada: o excedente individual é zerado (guardando o original) e o excedente do grupo vai para a leitura que mais passou da franquia.'
              : 'Sem franquia: se a soma dos valores de contrato cobrir o total do mês, cada leitura passa a valer o seu valor de contrato (valor mínimo).'
          }
          confirmar="Acertar"
          tom="normal"
          onConfirmar={async () => {
            const r = await api.post<{ alteradas: number }>('/api/locacoes/agrupamento/acertar', { codigo: codigo.trim() });
            setConfirmando(false);
            onToast(r.alteradas ? `${r.alteradas} leitura(s) acertada(s).` : 'Nada a acertar: o total do mês passa do valor mínimo do grupo.');
            gerar();
          }}
          onCancelar={() => setConfirmando(false)}
        />
      )}
    </Janela>
  );
};

// ---------------------------------------------------------------------------------------------
// Conferência de Leituras
// ---------------------------------------------------------------------------------------------

export const Conferencia: React.FC<{ onFechar: () => void; onIrPara: (idContrato: number) => void; onToast?: (m: string) => void }> = ({ onFechar, onIrPara, onToast }) => {
  const [a, m] = hoje().split('-').map(Number);
  const [ano, setAno] = useState(a);
  const [mes, setMes] = useState(m);
  const [dia, setDia] = useState(1);
  const [linhas, setLinhas] = useState<RegistroCrud[] | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [desmarcar, setDesmarcar] = useState(false);
  const qs = `ano=${ano}&mes=${mes}&dia=${dia}`;

  const conferir = async () => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.get<RegistroCrud[]>(`/api/locacoes/conferencia?${qs}`);
      setLinhas(r);
      setSelId(r[0]?.id ?? null);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  };
  const sel = linhas?.find((l) => l.id === selId);

  const marcar = async () => {
    if (!sel) return;
    const r = await api.post<{ id_conferencia: number | null }>('/api/locacoes/conferencia', { id_contrato: sel.id, data_vencimento: sel.novo_vencimento });
    setLinhas((ls) => ls?.map((l) => (l.id === sel.id ? { ...l, id_conferencia: r.id_conferencia } : l)) ?? null);
  };

  const colunas: Coluna<RegistroCrud>[] = [
    { id: 'conferido', rotulo: 'Conferido', titulo: '', alinhar: 'c', render: (r) => (r.id_conferencia ? <Selo texto="CONFERIDO" cor="#2E8B57" /> : '') },
    { titulo: 'Nome', campo: 'nome' },
    { titulo: 'Nr. Série', campo: 'nr_serie' },
    { titulo: 'Id Equip.', campo: 'id_equip', alinhar: 'c' },
    { titulo: 'Marca', campo: 'marca' },
    { titulo: 'Modelo', campo: 'modelo' },
    { titulo: 'Setor', campo: 'setor' },
    { titulo: 'Dia Leitura', campo: 'dia_leitura', alinhar: 'c' },
    { titulo: 'Dia Vencto.', campo: 'dia_vencimento', alinhar: 'c' },
    { titulo: 'Vencto.', alinhar: 'c', render: (r) => dataBr(r.novo_vencimento), total: (rows) => `${rows.length} contrato(s)` },
  ];
  const opcoes = (de: number, ate: number) => Array.from({ length: ate - de + 1 }, (_, i) => de + i);

  return (
    <Janela
      titulo="Conferência de Leituras"
      subtitulo="Contratos do dia de leitura sem leitura lançada para o vencimento do mês"
      onFechar={onFechar}
      largura="max-w-6xl"
      rodape={
        <>
          <BotaoBarra
            icone={Printer}
            texto="Imprimir"
            disabled={!linhas}
            onClick={() => baixarArquivo(`/api/locacoes/conferencia/pdf?${qs}`, 'leituras_nao_efetuadas.pdf').catch((e) => setErro(e.message))}
          />
          <BotaoBarra icone={CheckCircle2} texto="Conferido!" disabled={!sel} onClick={() => (sel?.id_conferencia ? setDesmarcar(true) : marcar().catch((e) => setErro(e.message)))} />
          <BotaoBarra icone={CornerDownRight} texto="Ir para o Contrato" primario disabled={!sel} onClick={() => sel && onIrPara(sel.id)} />
        </>
      }
    >
      <div className="flex items-center gap-2 mb-3">
        <select value={ano} onChange={(e) => setAno(Number(e.target.value))} className={`${INPUT_CLASS} h-[38px]`} title="Ano">
          {opcoes(a - 6, a + 4).map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className={`${INPUT_CLASS} h-[38px]`} title="Mês">
          {opcoes(1, 12).map((x) => (
            <option key={x} value={x}>
              {String(x).padStart(2, '0')}
            </option>
          ))}
        </select>
        <label className="text-xs text-stone-500">Dia leitura</label>
        <select value={dia} onChange={(e) => setDia(Number(e.target.value))} className={`${INPUT_CLASS} h-[38px]`}>
          {opcoes(1, 31).map((x) => (
            <option key={x} value={x}>
              {String(x).padStart(2, '0')}
            </option>
          ))}
        </select>
        <BotaoBarra icone={Search} texto="Conferir" primario onClick={conferir} carregando={ocupado} />
      </div>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      <div className="text-xs font-semibold text-stone-600 dark:text-stone-300 mb-1">Leituras não Realizadas</div>
      <div className="flex flex-col h-[50vh] border border-stone-200 dark:border-stone-800 rounded-lg">
        <Grade
          nome="locacoes.conferencia"
          colunas={colunas}
          linhas={linhas ?? []}
          selecionada={selId ?? undefined}
          onSelecionar={(r) => setSelId(r.id)}
          onDuploClique={(r) => onIrPara(r.id)}
          carregando={ocupado}
          vazio={linhas ? 'Todas as leituras do dia foram feitas.' : 'Escolha o mês e o dia e clique em Conferir.'}
          onToast={onToast}
        />
      </div>
      {desmarcar && sel && (
        <ConfirmDialog
          titulo="Tirar a marca de conferido?"
          mensagem={`${sel.nome ?? ''} — ${sel.nr_serie ?? ''} (vencimento ${dataBr(sel.novo_vencimento)}).`}
          confirmar="Desmarcar"
          onConfirmar={async () => {
            await marcar();
            setDesmarcar(false);
          }}
          onCancelar={() => setDesmarcar(false)}
        />
      )}
    </Janela>
  );
};

// ---------------------------------------------------------------------------------------------
// Leituras automáticas (histórico SNMP)
// ---------------------------------------------------------------------------------------------

/** Nível de toner em % (vazio quando a impressora não informa) */
const pct = (v: unknown) => (v === null || v === undefined || v === '' ? '' : `${v}%`);

export const HistoricoSnmp: React.FC<{ nrSerie: string; onFechar: () => void; onToast?: (m: string) => void }> = ({ nrSerie, onFechar, onToast }) => {
  const [serie, setSerie] = useState(nrSerie);
  const [linhas, setLinhas] = useState<RegistroCrud[]>([]);
  const [pos, setPos] = useState(-1);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    setCarregando(true);
    api
      .get<RegistroCrud[]>(`/api/locacoes/snmp?nr_serie=${encodeURIComponent(serie)}`)
      .then((r) => {
        setLinhas(r);
        setPos(r.length - 1); // posicionado no último registro, como no Delphi
      })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, [serie]);

  const colunas: Coluna<RegistroCrud>[] = [
    { titulo: 'Leitura em:', alinhar: 'c', render: (r) => dataHoraBr(r.datahora_inclusao) },
    { titulo: 'NS', campo: 'equip_ns' },
    { titulo: 'Marca', campo: 'equip_marca' },
    { titulo: 'Modelo', campo: 'equip_modelo' },
    { titulo: 'Setor', campo: 'cliente_descricao_equip' },
    { titulo: 'Cliente', campo: 'cliente_nome' },
    { titulo: 'P/B', alinhar: 'd', render: (r) => <span className="font-bold text-blue-700 dark:text-blue-400">{inteiro(r.leitura_pb)}</span> },
    { titulo: 'Color', alinhar: 'd', render: (r) => inteiro(r.leitura_color) },
    { titulo: 'Unidade', campo: 'unidade', alinhar: 'c' },
    { titulo: 'Black', alinhar: 'c', render: (r) => pct(r.nivel_toner_black) },
    { titulo: 'Cyan', alinhar: 'c', render: (r) => pct(r.nivel_toner_cyan) },
    { titulo: 'Magenta', alinhar: 'c', render: (r) => pct(r.nivel_toner_magenta) },
    { titulo: 'Yellow', alinhar: 'c', render: (r) => pct(r.nivel_toner_yellow) },
    { titulo: 'IP', campo: 'cliente_ip_equip' },
  ];
  const ir = (p: number) => setPos(Math.max(0, Math.min(linhas.length - 1, p)));
  const nav = 'p-2 rounded-lg border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40 h-[38px]';

  return (
    <Janela
      titulo="Leituras"
      subtitulo={serie ? `Coletas do Scan Impressoras (SNMP) do equipamento ${serie}` : 'Todas as coletas do Scan Impressoras dos equipamentos do grupo (as 2.000 mais recentes)'}
      onFechar={onFechar}
      largura="max-w-[95vw]"
      rodape={
        <>
          <span className="mr-auto text-xs text-stone-500">{linhas.length ? `${pos + 1} de ${linhas.length}` : ''}</span>
          <button type="button" className={nav} onClick={() => ir(0)} disabled={!linhas.length} title="Primeiro">
            <ChevronFirst className="w-4 h-4" />
          </button>
          <button type="button" className={nav} onClick={() => ir(pos - 1)} disabled={pos <= 0} title="Anterior">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" className={nav} onClick={() => ir(pos + 1)} disabled={pos >= linhas.length - 1} title="Próximo">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button type="button" className={nav} onClick={() => ir(linhas.length - 1)} disabled={!linhas.length} title="Último">
            <ChevronLast className="w-4 h-4" />
          </button>
          <BotaoBarra icone={Search} texto="Todas" disabled={!serie} onClick={() => setSerie('')} title="Todas as leituras, sem filtro de nr. de série" />
        </>
      }
    >
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      <div className="flex flex-col h-[60vh] border border-stone-200 dark:border-stone-800 rounded-lg">
        <Grade
          nome="locacoes.snmp"
          colunas={colunas}
          linhas={linhas}
          selecionada={linhas[pos]?.id}
          onSelecionar={(r) => setPos(linhas.indexOf(r))}
          carregando={carregando}
          vazio="Nenhuma leitura automática."
          rolarParaSelecionada
          onToast={onToast}
        />
      </div>
    </Janela>
  );
};
