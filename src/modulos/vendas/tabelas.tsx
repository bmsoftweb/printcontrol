import React, { useState } from 'react';
import { CrudView } from '../../components/CrudView';
import { Janela } from '../../components/Janela';
import type { TelaProps } from '../tipos';

const ABAS = [
  ['vendas_operacoes', 'Operações'],
  ['vendas_series', 'Séries'],
  ['vendas_condicoes', 'Condições de pagamento'],
  ['nfe_impostos_formulas', 'Fórmulas de imposto'],
] as const;

/** Cadastros usados pela tela Vendas (no Delphi ficavam em outras telas de tabela) */
export const TabelasVendas: React.FC<{ p: TelaProps; onFechar: () => void }> = ({ p, onFechar }) => {
  const [aba, setAba] = useState<string>(ABAS[0][0]);
  const recurso = p.resources.find((r) => r.name === aba);
  return (
    <Janela titulo="Tabelas de vendas" onFechar={onFechar} largura="max-w-[95vw]">
      <div className="flex gap-1 mb-2 border-b border-stone-200 dark:border-stone-800">
        {ABAS.map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            onClick={() => setAba(id)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-t-lg border-b-2 cursor-pointer ${aba === id ? 'border-blue-600 text-blue-700 dark:text-blue-400' : 'border-transparent text-stone-500'}`}
          >
            {rotulo}
          </button>
        ))}
      </div>
      <div className="h-[70vh] flex flex-col">
        {recurso && (
          <CrudView
            key={recurso.name}
            resource={recurso}
            allResources={p.resources}
            refreshToken={p.refreshToken}
            createToken={0}
            onToast={p.onToast}
            onCountChange={() => {}}
            onNavigate={p.onNavigate}
            usuario={p.usuario}
          />
        )}
      </div>
    </Janela>
  );
};
