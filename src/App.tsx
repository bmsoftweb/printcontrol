import { useCallback, useEffect, useState } from 'react';
import { ResourceDef, DbConnectionStatus } from './types';
import { setTokenSessao, setAoExpirarSessao, fetchResources, fetchDbStatus, invalidateOptions, validarSessao } from './services/api';
import { limparConfigListas } from './utils/configListas';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { LoginView } from './components/LoginView';
import { CrudView } from './components/CrudView';
import { podeAcessar, itemDoMenu } from './utils/menu';
import { ThemeMode, getInitialTheme, applyTheme } from './utils/theme';
import { Sessao, lerSessao, salvarSessao, limparSessao } from './utils/session';
import { TELAS } from './modulos';
import type { TelaProps } from './modulos/tipos';
import { AreaCliente } from './modulos/areaCliente';

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  const handleToggleTheme = useCallback(() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark')), []);

  // Sessão (token assinado pelo servidor, guardado no navegador)
  const [sessao, setSessao] = useState<Sessao | null>(() => {
    const s = lerSessao();
    // O token precisa estar no cliente HTTP antes da primeira chamada
    setTokenSessao(s?.token ?? null);
    return s;
  });
  const usuario = sessao?.usuario ?? null;
  const empresa = sessao?.empresa ?? null;

  const [activeTab, setActiveTab] = useState<string>('inicio');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [resources, setResources] = useState<ResourceDef[]>([]);
  const [recordCounts, setRecordCounts] = useState<Record<string, number>>({});
  const [dbStatus, setDbStatus] = useState<DbConnectionStatus | null>(null);

  const [refreshToken, setRefreshToken] = useState(0);
  const [createToken, setCreateToken] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  /** Motivo exibido na tela de login quando a sessão é recusada */
  const [avisoLogin, setAvisoLogin] = useState<string | null>(null);

  /** Troca de tela; o gatilho do botão "Novo" zera para a tela nova não abrir uma inclusão sozinha */
  const navegar = useCallback((tab: string) => {
    setCreateToken(0);
    setActiveTab(tab);
  }, []);

  const handleLogout = useCallback(() => {
    setSessao(null);
    setResources([]);
    setRecordCounts({});
    setActiveTab('inicio');
    invalidateOptions();
    setTokenSessao(null);
    limparConfigListas();
    limparSessao();
  }, []);

  // Qualquer 401 da API (token expirado, usuário desativado) volta para o login
  useEffect(() => {
    setAoExpirarSessao((msg) => {
      handleLogout();
      setAvisoLogin(msg);
    });
    return () => setAoExpirarSessao(null);
  }, [handleLogout]);

  // Sessão guardada no navegador é conferida ao abrir: o usuário pode ter sido desativado
  useEffect(() => {
    if (!sessao) return;
    validarSessao(Boolean(sessao.cliente)).then(({ valida, error }) => {
      if (valida === false) {
        handleLogout();
        setAvisoLogin(error || 'Sua sessão expirou. Entre novamente.');
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessao?.token]);

  // Metadados dos recursos e saúde do banco
  useEffect(() => {
    if (!sessao?.usuario) return;
    let alive = true;
    fetchResources()
      .then((list) => alive && setResources(list))
      .catch((err) => console.warn('Falha ao carregar os metadados dos recursos:', err));
    fetchDbStatus().then((s) => alive && setDbStatus(s));
    return () => {
      alive = false;
    };
  }, [sessao?.token]);

  const handleCountChange = useCallback((resourceName: string, total: number) => {
    setRecordCounts((prev) => (prev[resourceName] === total ? prev : { ...prev, [resourceName]: total }));
  }, []);

  if (!sessao) {
    return (
      <LoginView
        avisoInicial={avisoLogin}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onLoginSuccess={(nova, lembrar) => {
          setTokenSessao(nova.token);
          setSessao(nova);
          setActiveTab('inicio');
          salvarSessao(nova, lembrar);
          setAvisoLogin(null);
          showToast(`Bem-vindo, ${nova.usuario?.nome ?? nova.cliente?.fantasia ?? nova.cliente?.nome}!`);
        }}
      />
    );
  }

  // Cliente: só a Área do Cliente (o menu principal nunca aparece para ele)
  if (sessao.cliente) {
    return <AreaCliente cliente={sessao.cliente} onSair={handleLogout} theme={theme} onToggleTheme={handleToggleTheme} />;
  }

  if (!usuario || !empresa) return null;

  const tab = podeAcessar(usuario, activeTab) ? activeTab : 'inicio';
  const tela = TELAS[tab];
  const item = itemDoMenu(tab);
  const recurso = tela?.recurso ? resources.find((r) => r.name === tela.recurso) || null : null;
  const [headerTitle, headerSubtitle] = tela?.titulo ?? [item?.label ?? 'PrintControl', item?.descricao ?? ''];

  const props: TelaProps = {
    usuario,
    empresa,
    resources,
    onToast: showToast,
    refreshToken,
    createToken,
    onNavigate: navegar,
    onCountChange: handleCountChange,
  };

  return (
    <div className="h-screen overflow-hidden bg-stone-100/70 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex font-sans antialiased selection:bg-blue-600 selection:text-white">
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-[70] bg-stone-900 text-white text-xs font-semibold py-3 px-4 rounded-xl shadow-2xl border border-stone-800 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      <Sidebar
        activeTab={tab}
        setActiveTab={navegar}
        recordCounts={recordCounts}
        usuario={usuario}
        empresa={empresa}
        servidor={sessao.servidor}
        onLogout={handleLogout}
        onToast={showToast}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <Header
          title={headerTitle}
          subtitle={headerSubtitle}
          dbStatus={dbStatus}
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          onRefresh={() => setRefreshToken((t) => t + 1)}
          onCreate={recurso?.canCreate ? () => setCreateToken((t) => t + 1) : undefined}
          createLabel={recurso ? `Novo ${recurso.labelSingular}` : undefined}
          theme={theme}
          onToggleTheme={handleToggleTheme}
        />

        <main className="flex-1 flex flex-col min-h-0 w-full">
          {tela?.componente ? (
            <tela.componente key={tab} {...props} />
          ) : recurso ? (
            <CrudView
              key={recurso.name}
              resource={recurso}
              allResources={resources}
              refreshToken={refreshToken}
              createToken={createToken}
              onToast={showToast}
              onCountChange={handleCountChange}
              onNavigate={navegar}
              usuario={usuario}
              {...(tela?.ganchos?.(props) ?? {})}
            />
          ) : (
            <div className="py-24 text-center text-sm text-stone-500 dark:text-stone-400">
              {tela ? 'Carregando a estrutura da tela…' : 'Esta opção ainda não foi convertida.'}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
