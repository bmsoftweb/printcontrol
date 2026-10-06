import React, { useState } from 'react';
import { Loader2, RefreshCw, Save } from 'lucide-react';
import { api } from '../../services/api';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from '../../components/Janela';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { AvisoErro } from '../../components/AvisoErro';
import { NumberField } from '../../components/NumberField';
import { DateField } from '../../components/DateField';
import { INPUT_CLASS, LABEL_CLASS } from '../../utils/formStyles';
import { moeda, num, r2, type Linha } from './comum';
import type { Apoio } from './formularios';

export interface Parcela {
  nr: number;
  vencimento: string;
  valor: number;
  id_banco: number;
  banco: string;
  status: 'A' | 'D';
}

export interface Preparo {
  cliente: string;
  total: number;
  tipoVenda: string;
  parcelas: Parcela[];
  avisos: string[];
}

/** Aba "Fechamento" (§7): parcelas editáveis; editar marca a parcela como digitada (D) */
export const Fechamento: React.FC<{ venda: Linha; preparo: Preparo; apoio: Apoio; onFechar: () => void; onGravado: () => void }> = ({ venda, preparo, apoio, onFechar, onGravado }) => {
  const [parcelas, setParcelas] = useState<Parcela[]>(preparo.parcelas);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const soma = r2(parcelas.reduce((s, p) => s + num(p.valor), 0));

  const editar = (i: number, campos: Partial<Parcela>) => setParcelas((ps) => ps.map((p, k) => (k === i ? { ...p, ...campos, status: 'D' } : p)));

  const refazer = async () => {
    setOcupado(true);
    setErro(null);
    try {
      setParcelas(await api.post(`/api/vendas/${venda.id}/parcelas/refazer`, { parcelas }));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Janela
      titulo="Fechamento da Venda"
      subtitulo={`Venda nº ${venda.id}`}
      onFechar={onFechar}
      largura="max-w-3xl"
      ocupado={ocupado}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={ocupado}>
            Cancelar
          </button>
          <button type="button" className={BOTAO_PRIMARIO} onClick={() => setConfirmar(true)} disabled={ocupado}>
            <Save className="w-4 h-4" />
            Gravar
          </button>
        </>
      }
    >
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      {preparo.avisos.length > 0 && (
        <div className="mb-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300 whitespace-pre-line">
          Avisos do cálculo de impostos:{'\n'}
          {preparo.avisos.join('\n')}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end text-xs">
        <div>
          <div className={LABEL_CLASS}>Cliente:</div>
          <div className="font-semibold text-stone-800 dark:text-stone-100 py-1">{preparo.cliente}</div>
        </div>
        <div />
        <div>
          <div className={LABEL_CLASS}>Total Líquido da Venda:</div>
          <div className="text-lg font-bold font-mono text-stone-900 dark:text-stone-100">R$ {moeda(preparo.total)}</div>
        </div>
        <button type="button" className={BOTAO_SECUNDARIO} onClick={refazer} disabled={ocupado} title="Recalcula as parcelas automáticas mantendo as digitadas">
          {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Gerar Parcelas
        </button>
        <div className="sm:col-span-2">
          <div className={LABEL_CLASS}>Tipo da Venda:</div>
          <div className="font-semibold text-stone-800 dark:text-stone-100 py-1">{preparo.tipoVenda}</div>
        </div>
      </div>
      <div className={`${LABEL_CLASS} mt-3 mb-1`}>Parcelamento:</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-stone-500 border-b border-stone-200 dark:border-stone-800">
            <th className="py-1.5 w-16">Parcela</th>
            <th className="py-1.5">Vencimento</th>
            <th className="py-1.5">Valor</th>
            <th className="py-1.5">Banco</th>
          </tr>
        </thead>
        <tbody>
          {parcelas.map((p, i) => (
            <tr key={p.nr} className="border-b border-stone-100 dark:border-stone-800/70">
              <td className="py-1 text-center font-semibold">
                {p.nr}
                {p.status === 'D' && <span className="ml-1 text-[10px] text-amber-600" title="Digitada">✎</span>}
              </td>
              <td className="py-1 px-1">
                <DateField value={p.vencimento} onChange={(v) => editar(i, { vencimento: v })} className={INPUT_CLASS} />
              </td>
              <td className="py-1 px-1">
                <NumberField scale={2} value={p.valor} className={`${INPUT_CLASS} w-full`} onChange={(v) => editar(i, { valor: num(v) })} />
              </td>
              <td className="py-1 px-1">
                <select
                  className={`${INPUT_CLASS} w-full`}
                  value={p.id_banco || ''}
                  onChange={(e) => editar(i, { id_banco: Number(e.target.value) || 0, banco: apoio.bancos.find((b) => String(b.id) === e.target.value)?.apelido ?? '' })}
                >
                  <option value="">—</option>
                  {apoio.bancos.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.apelido}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="py-2 text-right font-semibold text-stone-500">
              Soma das parcelas:
            </td>
            <td className={`py-2 px-3 text-right font-mono font-bold ${Math.abs(soma - preparo.total) >= 0.005 ? 'text-rose-600' : 'text-emerald-700'}`}>{moeda(soma)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      {confirmar && (
        <ConfirmDialog
          titulo="Confirme a operação"
          mensagem="Confirma Gravar? A venda será finalizada (numeração, títulos a receber e estoque)."
          confirmar="Gravar"
          tom="normal"
          onCancelar={() => setConfirmar(false)}
          onConfirmar={async () => {
            if (Math.abs(soma - preparo.total) >= 0.005) throw new Error('Valor das parcelas não fecha com o total!');
            await api.post(`/api/vendas/${venda.id}/finalizar`, { parcelas });
            setConfirmar(false);
            onGravado();
          }}
        />
      )}
    </Janela>
  );
};
