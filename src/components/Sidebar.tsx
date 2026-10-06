import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, UserPen, LogOut, X, User, type LucideIcon } from 'lucide-react';
import { Usuario, EmpresaSessao, ServidorSessao } from '../types';
import { gruposDoMenu } from '../utils/menu';
import { salvarMeusDados } from '../services/api';
import { ConfirmDialog } from './ConfirmDialog';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS } from '../utils/formStyles';

const CHAVE_RECOLHIDO = 'printcontrol_menu_recolhido';

/** Título do grupo do menu; recolhido, vira uma linha (o primeiro grupo não precisa) */
const tituloGrupo = (titulo: string, rec: boolean, primeiro = false) =>
  rec ? (
    primeiro ? null : <div className="mx-4 mb-2 border-t border-stone-200 dark:border-stone-800" />
  ) : (
    <div className="px-4 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-400">{titulo}</div>
  );

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  recordCounts: Record<string, number>;
  usuario: Usuario;
  empresa: EmpresaSessao;
  servidor?: ServidorSessao;
  onLogout: () => void;
  onToast: (msg: string) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  recordCounts,
  usuario,
  empresa,
  servidor,
  onLogout,
  onToast,
  isOpenMobile,
  onCloseMobile,
}) => {
  // Desktop: menu recolhido (só os ícones), lembrado neste navegador
  const [recolhido, setRecolhido] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_RECOLHIDO) === '1';
    } catch {
      return false;
    }
  });
  const alternar = () =>
    setRecolhido((r) => {
      try {
        localStorage.setItem(CHAVE_RECOLHIDO, r ? '0' : '1');
      } catch {
        // sem storage: vale só até recarregar
      }
      return !r;
    });

  const [meusDados, setMeusDados] = useState(false);

  const handleNavClick = (tabId: string) => {
    setActiveTab(tabId);
    onCloseMobile();
  };

  const renderNavButton = (
    id: string,
    label: string,
    description: string,
    Icon: LucideIcon,
    badge: number | undefined,
    rec: boolean,
  ) => {
    const isActive = activeTab === id;
    return (
      <button
        key={id}
        id={`sidebar-nav-${id}`}
        onClick={() => handleNavClick(id)}
        title={rec ? label : undefined}
        className={`relative w-full flex items-center ${rec ? 'justify-center' : 'justify-between px-4'} py-[11px] text-left transition-colors cursor-pointer group border-l-2 ${
          isActive
            ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300'
            : 'border-transparent text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800/70 dark:hover:text-white'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Icon
            className={`w-4 h-4 shrink-0 transition-transform group-hover:scale-110 ${
              isActive
                ? 'text-blue-600 dark:text-blue-300'
                : 'text-stone-400 group-hover:text-blue-600 dark:text-stone-400 dark:group-hover:text-blue-400'
            }`}
          />
          {!rec && (
            <div className="min-w-0">
              <div className="text-xs truncate">{label}</div>
            </div>
          )}
        </div>

        {!rec && badge !== undefined && badge > 0 && (
          <span
            // Mesma altura da linha do texto (16px): a etiqueta chega depois da contagem e não pode esticar a opção
            className={`text-[10px] font-bold leading-4 h-4 px-1.5 rounded-full shrink-0 ${
              isActive
                ? 'bg-blue-200 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                : 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300 group-hover:bg-stone-300 dark:group-hover:bg-stone-700'
            }`}
          >
            {badge > 999 ? '999+' : badge}
          </span>
        )}
      </button>
    );
  };

  const conteudo = (rec: boolean) => (
    <div className="flex flex-col h-full bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 border-r border-stone-200 dark:border-stone-800 select-none">
      {/* Marca — mesma altura do header da área de trabalho */}
      <div className={`h-[var(--altura-topo)] shrink-0 ${rec ? 'justify-center' : 'px-4 justify-between'} border-b border-stone-200 dark:border-stone-800/80 flex items-center gap-3 bg-stone-50/50 dark:bg-transparent`}>
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="h-9 px-3 min-w-11 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-[11px] tracking-widest shadow-md shrink-0"
            title={`${empresa.grupoApelido} — ${empresa.nome}`}
          >
            {(empresa.grupoApelido || 'PC').slice(0, rec ? 1 : 3).toUpperCase()}
          </div>
          <div className={rec ? 'hidden' : 'min-w-0'}>
            <h1 className="text-sm font-bold text-stone-900 dark:text-white leading-tight truncate">PrintControl</h1>
            <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate" title={`Servidor ${servidor?.id ?? '?'}${servidor?.descricao ? ` (${servidor.descricao})` : ''} • Grupo/Empresa ativos: ${empresa.grupoId}/${empresa.id}`}>
              {empresa.apelido || empresa.nome}
            </p>
          </div>
        </div>

        <button
          onClick={onCloseMobile}
          id="btn-close-sidebar-mobile"
          title="Fechar menu lateral"
          className="lg:hidden p-1.5 rounded-lg text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navegação */}
      <div className="flex-1 overflow-y-auto py-4">
        {gruposDoMenu(usuario).map((g, i) => (
          <div key={g.titulo} className={i ? 'pt-3' : ''}>
            {tituloGrupo(g.titulo, rec, !i)}
            {g.itens.map((it) => renderNavButton(it.id, it.label, it.descricao, it.icone, recordCounts[it.id], rec))}
          </div>
        ))}
      </div>

      {/* Usuário & sair */}
      <div className={`p-3 border-t border-stone-200 dark:border-stone-800/80 flex ${rec ? 'flex-col' : ''} items-center justify-between gap-2 bg-stone-50 dark:bg-stone-950/60`}>
        <div className="flex items-center gap-2.5 min-w-0" title={rec ? usuario?.nome : undefined}>
          <div className="w-8 h-8 rounded-lg bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300 flex items-center justify-center font-semibold text-xs shrink-0">
            {usuario?.nome ? usuario.nome.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
          </div>
          <div className={rec ? 'hidden' : 'min-w-0'}>
            <div className="text-xs font-semibold text-stone-900 dark:text-white truncate leading-tight">
              {usuario?.nome || 'Usuário'}
            </div>
            <div className="text-[10px] text-stone-500 dark:text-stone-400 truncate mt-0.5">
              {usuario.id}-{usuario.email} · nível {usuario.nivel}
            </div>
          </div>
        </div>

        <div className={`flex ${rec ? 'flex-col' : ''} items-center gap-1 shrink-0`}>
          <button
            onClick={() => setMeusDados(true)}
            title="Meus Dados: e-mail de acesso, senha e página inicial"
            className="p-1.5 rounded-lg transition-colors cursor-pointer shrink-0 text-stone-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-950/50"
          >
            <UserPen className="w-4 h-4" />
          </button>
          <button
            id="sidebar-btn-logout"
            onClick={onLogout}
            title="Sair do Sistema"
            className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/50 transition-colors cursor-pointer shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Sidebar fixa no desktop */}
      <aside className={`hidden lg:flex flex-col ${recolhido ? 'w-16' : 'w-64'} shrink-0 h-screen sticky top-0 z-30 transition-[width] duration-200`}>
        {conteudo(recolhido)}
        <button
          type="button"
          id="sidebar-btn-recolher"
          onClick={alternar}
          title={recolhido ? 'Abrir o menu' : 'Esconder o menu'}
          className="absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-14 rounded-full flex items-center justify-center bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-stone-500 hover:text-blue-600 dark:text-stone-400 dark:hover:text-blue-400 shadow-sm cursor-pointer"
        >
          {recolhido ? <ChevronRight className="w-2.5 h-2.5 shrink-0" strokeWidth={3} /> : <ChevronLeft className="w-2.5 h-2.5 shrink-0" strokeWidth={3} />}
        </button>
      </aside>

      {/* Drawer no mobile */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs transition-opacity"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative flex-1 flex flex-col max-w-xs w-full h-full shadow-2xl z-10">
            {conteudo(false)}
          </div>
        </div>
      )}

      {meusDados && (
        <MeusDados
          usuario={usuario}
          onFechar={() => setMeusDados(false)}
          onFeito={() => {
            setMeusDados(false);
            // Como no Delphi, depois de gravar volta ao login (e-mail e senha podem ter mudado)
            onToast('Dados gravados. Entre novamente.');
            onLogout();
          }}
        />
      )}
    </>
  );
};

/** Meus Dados (Delphi): e-mail de acesso, nova senha (opcional, digitada duas vezes) e página inicial */
const MeusDados: React.FC<{ usuario: Usuario; onFechar: () => void; onFeito: () => void }> = ({ usuario, onFechar, onFeito }) => {
  const [v, setV] = useState({ email: usuario.email, senha: '', redigite: '', paginaWeb: usuario.paginaWeb ?? '' });
  const campo = (k: keyof typeof v, rotulo: string, tipo = 'text', primeiro = false) => (
    <div className={FIELD_CLASS}>
      <label htmlFor={`meus-${k}`} className={LABEL_CLASS}>{rotulo}</label>
      <input
        id={`meus-${k}`}
        type={tipo}
        autoFocus={primeiro}
        maxLength={k === 'paginaWeb' ? 80 : k === 'email' ? 50 : 15}
        autoComplete={tipo === 'password' ? 'new-password' : 'off'}
        value={v[k]}
        onChange={(e) => setV({ ...v, [k]: e.target.value })}
        onFocus={(e) => e.target.select()}
        className={`${INPUT_CLASS} w-full`}
      />
    </div>
  );
  return (
    <ConfirmDialog
      titulo="Meus Dados"
      mensagem="Senha em branco mantém a atual. Depois de gravar, entre novamente."
      confirmar="Gravar"
      tom="normal"
      onConfirmar={async () => {
        if (v.senha !== v.redigite) throw new Error('Senha não conferem!');
        await salvarMeusDados(v);
        onFeito();
      }}
      onCancelar={onFechar}
    >
      <div className="flex flex-col gap-3">
        {campo('email', 'Seu e-mail de acesso', 'email', true)}
        {campo('senha', 'Digite a senha', 'password')}
        {campo('redigite', 'Redigite', 'password')}
        {campo('paginaWeb', 'Home-page inicial')}
      </div>
    </ConfirmDialog>
  );
};
