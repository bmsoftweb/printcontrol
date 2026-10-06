import React from 'react';
import { Printer } from 'lucide-react';
import type { Tela, TelaProps } from './tipos';
import { gruposDoMenu } from '../utils/menu';

/** Aba Home do Delphi: abre a página inicial do usuário (usuarios.pagina_web); sem ela, os atalhos do menu */
const Inicio: React.FC<TelaProps> = ({ usuario, empresa, onNavigate }) => {
  const pagina = usuario.paginaWeb?.trim();
  if (pagina) {
    const url = /^https?:\/\//i.test(pagina) ? pagina : `https://${pagina}`;
    return <iframe title="Página inicial" src={url} className="w-full h-full border-0 bg-white" />;
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
