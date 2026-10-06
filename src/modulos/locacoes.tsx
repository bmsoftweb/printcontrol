import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { Tela, TelaProps } from './tipos';
import { CrudView } from '../components/CrudView';
import { AbaContratos } from './locacoes/contratos';
import { AbaPreLeituras } from './locacoes/preLeituras';
import { BotaoBarra } from './locacoes/ui';

/** Locações (ufrmContratos do Delphi): Contratos + Leituras, Vendedores e Pré-Leituras, navegadas pelos botões como no Delphi */
const TelaLocacoes: React.FC<TelaProps> = (p) => {
  const [aba, setAba] = useState<'contratos' | 'vendedores' | 'pre'>('contratos');
  const [lote, setLote] = useState<number | null>(null);
  const vendedores = p.resources.find((r) => r.name === 'vendedores');

  if (aba === 'vendedores')
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
          <span className="text-sm font-bold text-stone-800 dark:text-stone-100 mr-2">Vendedores</span>
          <BotaoBarra icone={ArrowLeft} texto="Voltar" onClick={() => setAba('contratos')} />
        </div>
        {vendedores && (
          <CrudView
            resource={vendedores}
            allResources={p.resources}
            refreshToken={p.refreshToken}
            createToken={0}
            onToast={p.onToast}
            onCountChange={p.onCountChange}
            onNavigate={p.onNavigate}
            usuario={p.usuario}
          />
        )}
      </div>
    );

  if (aba === 'pre')
    return (
      <AbaPreLeituras
        resources={p.resources}
        onToast={p.onToast}
        onVoltar={() => setAba('contratos')}
        onFiltrarContratos={(id) => {
          setLote(id);
          setAba('contratos');
        }}
      />
    );

  return (
    <AbaContratos
      resources={p.resources}
      onToast={p.onToast}
      refreshToken={p.refreshToken}
      onNavigate={p.onNavigate}
      lote={lote}
      onLimparLote={() => setLote(null)}
      onVendedores={() => setAba('vendedores')}
      onPreLeituras={() => setAba('pre')}
    />
  );
};

/** Telas do módulo locacoes (ids das opções do menu em src/utils/menu.ts) */
export const TELAS_LOCACOES: Record<string, Tela> = {
  locacoes: { componente: TelaLocacoes },
};
