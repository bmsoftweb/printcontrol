import React, { useState } from 'react';
import { Loader2, Play, Save } from 'lucide-react';
import { api } from '../../services/api';
import { Janela, BOTAO_PRIMARIO } from '../../components/Janela';
import { AvisoErro } from '../../components/AvisoErro';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SelectBusca } from '../../components/SelectBusca';
import { Toggle } from '../../components/Toggle';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS } from '../../utils/formStyles';
import { Grade, TituloPainel, data, inteiro, moeda, type Reg } from './comum';

/**
 * Painel Pré-Faturamento (pan_pre_fatur): agrupa as leituras não faturadas em notas (cliente + vencimento + série,
 * juntando contratos com juntar_nota) e grava o faturamento das notas marcadas.
 */
export const PreFaturamento: React.FC<{ clientes: { id: number; nome: string }[]; onFechar: () => void; onGravado: (qtd: number) => void; onToast?: (m: string) => void }> = ({
  clientes,
  onFechar,
  onGravado,
  onToast,
}) => {
  const [cliente, setCliente] = useState('');
  const [grupo, setGrupo] = useState('');
  const [notas, setNotas] = useState<Reg[] | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [atual, setAtual] = useState<string | null>(null);
  const [obs, setObs] = useState<Record<number, string>>({});
  const [ref, setRef] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  const gerar = async () => {
    setGerando(true);
    setErro(null);
    try {
      const lista: Reg[] = await api.get(`/api/faturamento/pre?cliente=${Number(cliente) || 0}&grupo=${encodeURIComponent(grupo.trim())}`);
      setNotas(lista);
      setMarcadas(new Set(lista.map((n) => n.chave)));
      setAtual(lista[0]?.chave ?? null);
      setObs(Object.fromEntries(lista.flatMap((n) => n.leituras.map((l: Reg) => [l.id, l.obs ?? '']))));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setGerando(false);
    }
  };

  const nota = notas?.find((n) => n.chave === atual) ?? null;
  const escolhidas = (notas ?? []).filter((n) => marcadas.has(n.chave));
  const marcar = (chave: string, v: boolean) =>
    setMarcadas((s) => {
      const n = new Set(s);
      if (v) n.add(chave);
      else n.delete(chave);
      return n;
    });

  const gravar = async () => {
    if (!escolhidas.length) return setConfirmar(false); // como o Delphi: sem nota marcada, sai sem mensagem
    const leituras = escolhidas.flatMap((n) => n.leituras.map((l: Reg) => l.id));
    const r = await api.post('/api/faturamento/gravar', { leituras, ref, obs: Object.fromEntries(leituras.map((id) => [id, obs[id] ?? ''])) });
    setConfirmar(false);
    onGravado(r.notas);
  };

  return (
    <Janela
      titulo="Pré-Faturamento"
      subtitulo="Leituras ainda não faturadas, agrupadas em notas"
      onFechar={onFechar}
      largura="max-w-[1400px]"
      rodape={
        <div className="flex-1 flex flex-wrap items-end justify-end gap-3">
          <label className={`${FIELD_CLASS} w-72`}>
            <span className={LABEL_CLASS}>Gravar Referente a</span>
            <input className={INPUT_CLASS} maxLength={30} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Ex.: LEITURAS DE SETEMBRO/2026" />
          </label>
          <button type="button" className={BOTAO_PRIMARIO} disabled={!notas?.length} onClick={() => setConfirmar(true)}>
            <Save className="w-4 h-4" /> Gravar Faturamento
          </button>
        </div>
      }
    >
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className={`${FIELD_CLASS} w-80`}>
          <span className={LABEL_CLASS}>Filtrar Cliente</span>
          <SelectBusca value={cliente} options={clientes.map((c) => ({ value: String(c.id), label: c.nome }))} onChange={setCliente} vazioLabel="— Todos —" />
        </label>
        <label className={`${FIELD_CLASS} w-40`}>
          <span className={LABEL_CLASS}>Filtrar Grupo</span>
          <input className={INPUT_CLASS} maxLength={30} value={grupo} onChange={(e) => setGrupo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && gerar()} />
        </label>
        <button type="button" className={BOTAO_PRIMARIO} onClick={gerar} disabled={gerando}>
          {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Gerar
        </button>
      </div>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-3 h-[55vh]">
        <div className="flex flex-col min-h-0 border border-stone-200 dark:border-stone-800 rounded-lg overflow-hidden">
          <TituloPainel direita={<span className="text-[11px] text-stone-500">{escolhidas.length} de {notas?.length ?? 0} marcada(s)</span>}>Notas</TituloPainel>
          <Grade
            nome="faturamento.pre"
            onToast={onToast}
            chave="chave"
            linhas={notas ?? []}
            selecionado={atual ?? undefined}
            onSelecionar={(r) => setAtual(r.chave)}
            carregando={gerando}
            vazio={notas ? 'Nenhuma leitura a faturar.' : 'Clique em Gerar.'}
            colunas={[
              { chave: 'f', titulo: 'F', rotulo: 'Faturar', alinhar: 'centro', render: (r) => <span onClick={(e) => e.stopPropagation()}><Toggle size="sm" checked={marcadas.has(r.chave)} onChange={(v) => marcar(r.chave, v)} label=" " /></span> },
              { chave: 'nome', titulo: 'Cliente', fixa: true, render: (r) => <span title={`${r.contagem} leitura(s) — série ${r.serie_nf}`}>{r.nome}</span> },
              { chave: 'contagem', titulo: 'Leituras', alinhar: 'dir', rodape: inteiro(escolhidas.reduce((s, n) => s + n.contagem, 0)) },
              { chave: 'total_geral', titulo: 'Total R$', alinhar: 'dir', render: (r) => moeda(r.total_geral), rodape: `R$ ${moeda(escolhidas.reduce((s, n) => s + Number(n.total_geral), 0))}` },
              { chave: 'data_vencimento', titulo: 'Vencto.', alinhar: 'centro', render: (r) => data(r.data_vencimento) },
            ]}
          />
        </div>
        <div className="flex flex-col min-h-0 border border-stone-200 dark:border-stone-800 rounded-lg overflow-hidden">
          <TituloPainel>Produtos da Nota</TituloPainel>
          <Grade
            nome="faturamento.pre.produtos"
            onToast={onToast}
            linhas={nota?.leituras ?? []}
            vazio="Escolha uma nota."
            colunas={[
              { chave: 'data_leitura', titulo: 'Leitura', alinhar: 'centro', render: (r) => data(r.data_leitura) },
              { chave: 'equip_marca', titulo: 'Marca' },
              { chave: 'equip_modelo', titulo: 'Modelo' },
              { chave: 'nr_serie', titulo: 'Nr. Série' },
              { chave: 'leitura_anterior', titulo: 'Leitura Anterior', alinhar: 'dir', render: (r) => inteiro(r.leitura_anterior) },
              { chave: 'leitura_atual', titulo: 'Leitura Atual', alinhar: 'dir', render: (r) => inteiro(r.leitura_atual) },
              { chave: 'nr_copias_mes', titulo: 'Nr. Cópias Mês', alinhar: 'dir', render: (r) => inteiro(r.nr_copias_mes) },
              { chave: 'valor_total_geral', titulo: 'Valor Total', alinhar: 'dir', render: (r) => moeda(r.valor_total_geral), rodape: `R$ ${moeda((nota?.leituras ?? []).reduce((s: number, l: Reg) => s + Number(l.valor_total_geral), 0))}` },
              {
                chave: 'obs',
                titulo: 'Observação',
                render: (r) => (
                  <input className={`${INPUT_CLASS} w-56 !py-1`} maxLength={255} value={obs[r.id] ?? ''} onChange={(e) => setObs((o) => ({ ...o, [r.id]: e.target.value }))} />
                ),
              },
            ]}
          />
        </div>
      </div>
      {confirmar && (
        <ConfirmDialog
          titulo="Gravar Faturamento"
          tom="normal"
          confirmar="Gravar"
          mensagem={`Confirma gravar essas notas e financeiro? ${escolhidas.length} nota(s), total R$ ${moeda(escolhidas.reduce((s, n) => s + Number(n.total_geral), 0))}.`}
          onConfirmar={gravar}
          onCancelar={() => setConfirmar(false)}
        />
      )}
    </Janela>
  );
};
