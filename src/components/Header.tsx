import React from 'react';
import { Menu, Database, Plus, RefreshCw } from 'lucide-react';
import { DbConnectionStatus } from '../types';
import { ThemeMode } from '../utils/theme';
import { ThemeToggle } from './ThemeToggle';

interface HeaderProps {
  title: string;
  subtitle: string;
  dbStatus: DbConnectionStatus | null;
  onOpenMobileSidebar: () => void;
  onRefresh?: () => void;
  onCreate?: () => void;
  createLabel?: string;
  theme?: ThemeMode;
  onToggleTheme?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  dbStatus,
  onOpenMobileSidebar,
  onRefresh,
  onCreate,
  createLabel,
  theme = 'light',
  onToggleTheme,
}) => {
  return (
    <header className="h-[var(--altura-topo)] shrink-0 z-20 bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800">
      <div className="h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
        {/* Título da tela */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onOpenMobileSidebar}
            id="btn-open-sidebar-mobile"
            title="Abrir menu de navegação"
            className="lg:hidden p-2 rounded-xl text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 border border-stone-200 dark:border-stone-700 transition-colors cursor-pointer shrink-0"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="min-w-0">
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100 leading-tight truncate">
                {title}
              </h2>
              <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate hidden sm:block">{subtitle}</p>
            </div>
          </div>
        </div>

        {/* Ações à direita */}
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          {/* Status da conexão MySQL */}
          <div
            title={
              dbStatus?.connected
                ? `MySQL conectado • ${dbStatus.database} • ${dbStatus.latencyMs}ms`
                : dbStatus?.error || 'Verificando conexão com o banco...'
            }
            className="hidden md:flex items-center gap-2 bg-stone-50 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700/80 rounded-xl px-3 py-1.5"
          >
            <Database
              className={`w-3.5 h-3.5 ${
                dbStatus?.connected ? 'text-emerald-500' : 'text-rose-500 animate-pulse'
              }`}
            />
            <div className="text-right">
              <div className="text-[10px] text-stone-500 dark:text-stone-400 font-medium">
                Banco de Dados
              </div>
              <div
                className={`text-xs font-bold font-mono ${
                  dbStatus?.connected
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {dbStatus?.connected ? `${dbStatus.latencyMs}ms` : 'Offline'}
              </div>
            </div>
          </div>

          {onToggleTheme && (
            <ThemeToggle theme={theme} onToggle={onToggleTheme} variant="header" />
          )}

          {onRefresh && (
            <button
              id="btn-atualizar"
              onClick={onRefresh}
              title="Recarregar os dados desta tela"
              className="p-2 rounded-xl border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}

          {onCreate && (
            <button
              id="btn-novo-registro"
              onClick={onCreate}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{createLabel || 'Novo'}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
