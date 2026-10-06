import React, { useEffect, useState } from 'react';
import { Printer, FileSignature, Receipt, AlertTriangle, CalendarClock, Wrench, type LucideIcon } from 'lucide-react';
import type { Tela, TelaProps } from './tipos';
import { gruposDoMenu, podeAcessar } from '../utils/menu';
import { api } from '../services/api';
import { formatMoeda } from '../utils/formatters';

interface Painel {
  leituras?: { contratos: number; pendentes: number; atrasadas: number };
  aFaturar?: { quantidade: number; valor: string };
  notas?: { vencidas: number; valorVencidas: string; aVencer: number; valorAVencer: string };
  os?: { abertas: number; executando: number };
}

type Tom = 'vermelho' | 'ambar' | 'azul' | 'verde';
const TOM: Record<Tom, string> = {
  vermelho: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40',
  ambar: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40',
  azul: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40',
  verde: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40',
};

/** Indicador clicável: leva à tela onde a pendência se resolve */
const Indicador: React.FC<{ icone: LucideIcon; titulo: string; valor: React.ReactNode; detalhe: React.ReactNode; tom: Tom; onClick: () => void }> = ({
  icone: Icone,
  titulo,
  valor,
  detalhe,
  tom,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="flex items-start gap-3 p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 hover:border-blue-400 hover:shadow-sm text-left cursor-pointer transition-all"
  >
    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${TOM[tom]}`}>
      <Icone className="w-5 h-5" />
    </div>
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">{titulo}</div>
      <div className="text-2xl font-bold text-stone-900 dark:text-white leading-tight tabular-nums">{valor}</div>
      <div className="text-[11px] text-stone-500 dark:text-stone-400">{detalhe}</div>
    </div>
  </button>
);

/** Indicadores do que está pendente na empresa ativa (só os blocos que o nível do usuário acessa) */
const PainelPendencias: React.FC<Pick<TelaProps, 'usuario' | 'onNavigate' | 'refreshToken'>> = ({ usuario, onNavigate, refreshToken }) => {
  const [p, setP] = useState<Painel | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Painel>('/api/painel')
      .then(setP)
      .catch((e) => setErro(e.message));
  }, [refreshToken]);

  if (erro) return <p className="text-xs text-rose-600 mb-4">Painel indisponível: {erro}</p>;
  if (!p) return <div className="h-24 mb-6 rounded-xl bg-stone-200/50 dark:bg-stone-800/50 animate-pulse" />;

  const ir = (tela: string) => () => podeAcessar(usuario, tela) && onNavigate(tela);
  const cards: React.ReactNode[] = [];
  if (p.leituras) {
    cards.push(
      <Indicador
        key="leituras"
        icone={FileSignature}
        titulo="Leituras atrasadas"
        valor={p.leituras.atrasadas}
        detalhe={`${p.leituras.pendentes} de ${p.leituras.contratos} contratos sem leitura neste mês`}
        tom={p.leituras.atrasadas ? 'vermelho' : 'verde'}
        onClick={ir('locacoes')}
      />,
    );
  }
  if (p.aFaturar) {
    cards.push(
      <Indicador
        key="faturar"
        icone={Receipt}
        titulo="Leituras a faturar"
        valor={p.aFaturar.quantidade}
        detalhe={formatMoeda(p.aFaturar.valor)}
        tom="azul"
        onClick={ir('faturamento')}
      />,
    );
  }
  if (p.notas) {
    cards.push(
      <Indicador
        key="vencidas"
        icone={AlertTriangle}
        titulo="Notas vencidas"
        valor={p.notas.vencidas}
        detalhe={formatMoeda(p.notas.valorVencidas)}
        tom={p.notas.vencidas ? 'vermelho' : 'verde'}
        onClick={ir('financeiro')}
      />,
      <Indicador
        key="avencer"
        icone={CalendarClock}
        titulo="A vencer em 7 dias"
        valor={p.notas.aVencer}
        detalhe={formatMoeda(p.notas.valorAVencer)}
        tom="ambar"
        onClick={ir('financeiro')}
      />,
    );
  }
  if (p.os) {
    cards.push(
      <Indicador
        key="os"
        icone={Wrench}
        titulo="OS abertas"
        valor={p.os.abertas}
        detalhe={`${p.os.executando} em execução`}
        tom={p.os.abertas ? 'ambar' : 'verde'}
        onClick={ir('os')}
      />,
    );
  }
  if (!cards.length) return null;
  return <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 mb-6">{cards}</div>;
};

/** Aba Home do Delphi: indicadores da empresa e a página inicial do usuário (usuarios.pagina_web); sem ela, os atalhos */
const Inicio: React.FC<TelaProps> = ({ usuario, empresa, onNavigate, refreshToken }) => {
  const pagina = usuario.paginaWeb?.trim();
  const painel = <PainelPendencias usuario={usuario} onNavigate={onNavigate} refreshToken={refreshToken} />;
  if (pagina) {
    const url = /^https?:\/\//i.test(pagina) ? pagina : `https://${pagina}`;
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="px-4 sm:px-6 lg:px-8 pt-6">{painel}</div>
        <iframe title="Página inicial" src={url} className="w-full flex-1 min-h-0 border-0 bg-white" />
      </div>
    );
  }
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 overflow-y-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md">
          <Printer className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-stone-900 dark:text-white">Olá, {usuario.nome}</h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Grupo/Empresa ativos: {empresa.grupoId}/{empresa.id} — {empresa.grupoNome || empresa.grupoApelido} · {empresa.nome}
          </p>
        </div>
      </div>
      {painel}
      {gruposDoMenu(usuario)
        .filter((g) => g.titulo !== 'Visão Geral')
        .map((g) => (
          <div key={g.titulo} className="mb-6">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 mb-2">{g.titulo}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {g.itens.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => onNavigate(i.id)}
                  className="flex items-start gap-3 p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 hover:border-blue-400 hover:shadow-sm text-left cursor-pointer transition-all"
                >
                  <i.icone className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-stone-900 dark:text-stone-100">{i.label}</div>
                    <div className="text-[11px] text-stone-500 dark:text-stone-400">{i.descricao}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      <p className="text-[11px] text-stone-400">Defina a sua página inicial em Meus Dados (ícone ao lado do seu nome, no menu).</p>
    </div>
  );
};

export const TELA_INICIO: Record<string, Tela> = { inicio: { componente: Inicio } };
