import React, { useState } from 'react';
import {
  Lock,
  ArrowRight,
  AlertCircle,
  Eye,
  EyeOff,
  CheckCircle,
  User,
  Printer,
  Building2,
  Database,
} from 'lucide-react';
import { EmpresaSessao } from '../types';
import { ThemeMode } from '../utils/theme';
import { ThemeToggle } from './ThemeToggle';
import { Toggle } from './Toggle';
import { login } from '../services/api';
import { INPUT_CLASS_LG } from '../utils/formStyles';
import { lerLembrete, salvarLembrete, limparLembrete, limparSessao, Sessao } from '../utils/session';
import { ConfirmDialog } from './ConfirmDialog';

interface LoginViewProps {
  /** Mensagem mostrada ao abrir a tela, ex.: sessão recusada pelo servidor */
  avisoInicial?: string | null;
  theme?: ThemeMode;
  onToggleTheme?: () => void;
  /** lembrar = "Lembrar neste dispositivo" marcado */
  onLoginSuccess: (sessao: Sessao, lembrar: boolean) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  avisoInicial,
  theme = 'light',
  onToggleTheme,
  onLoginSuccess,
}) => {
  // Um lembrete salvo pré-preenche e-mail e senha e já deixa a opção marcada
  const [lembrete] = useState(() => lerLembrete());
  const [servidor, setServidor] = useState(() => lembrete?.servidor ?? '');
  const [usuarioEmail, setUsuarioEmail] = useState(() => lembrete?.email ?? '');
  const [lembrar, setLembrar] = useState(() => Boolean(lembrete));
  const [senha, setSenha] = useState(() => lembrete?.senha ?? '');
  const [showPassword, setShowPassword] = useState(false);
  /** Há e-mail/senha guardados neste navegador */
  const [temDados, setTemDados] = useState(() => Boolean(lembrete));
  const [limpando, setLimpando] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(avisoInicial ?? null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  /** Usuário liberado para mais de uma empresa: escolhe antes de entrar (Escolha a Empresa do Delphi) */
  const [empresas, setEmpresas] = useState<EmpresaSessao[] | null>(null);
  const [empresaId, setEmpresaId] = useState<number | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailLimpo = usuarioEmail.trim().toLowerCase();
    const servidorLimpo = servidor.trim();

    if (!servidorLimpo) {
      setErrorMessage('Informe o número do servidor.');
      return;
    }
    if (!emailLimpo) {
      setErrorMessage('Informe o seu e-mail (ou o código de cliente).');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      const data = await login({ servidor: servidorLimpo, usuario: emailLimpo, senha, empresaId: empresas ? empresaId : null });
      if (data.escolherEmpresa) {
        setEmpresas(data.escolherEmpresa);
        setEmpresaId(data.escolherEmpresa[0]?.id ?? null);
        return;
      }

      // Só guarda usuário e senha depois de um login válido
      if (lembrar) salvarLembrete(servidorLimpo, emailLimpo, senha);
      else limparLembrete();
      setTemDados(lembrar);

      onLoginSuccess({ token: data.token!, servidor: data.servidor, usuario: data.usuario, empresa: data.empresa, cliente: data.cliente }, lembrar);
    } catch (err: any) {
      setErrorMessage(err.message || 'Não foi possível validar o acesso. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  /** Marca: ícone + nome, usada no painel esquerdo e, no celular, acima do formulário */
  const marca = (
    <div className="flex items-center gap-2.5">
      <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200/50 dark:shadow-none shrink-0">
        <Printer className="w-5 h-5 text-white" />
      </div>
      <span className="text-sm font-black tracking-wider uppercase text-stone-800 dark:text-stone-100">PrintControl</span>
    </div>
  );

  return (
    <div className="min-h-screen flex relative bg-white dark:bg-stone-900 text-stone-900 dark:text-white">
      {/* Painel esquerdo: identidade visual (oculto em telas pequenas) */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col p-12 bg-white dark:bg-stone-950 isolate">
        {/* Pano de fundo: impressora (bandeja de papel, corpo, saída com folha) */}
        <div className="absolute inset-0 -z-10 pointer-events-none overflow-hidden">
          <svg
            viewBox="0 0 380 420"
            aria-hidden="true"
            className="absolute top-1/2 right-[6%] -translate-y-1/2 w-[min(440px,70%)] text-indigo-200 dark:text-indigo-400/25"
          >
            <g fill="currentColor">
              <rect x="100" y="20" width="180" height="120" opacity=".35" />
              <rect x="30" y="130" width="320" height="170" rx="18" opacity=".8" />
              <rect x="70" y="250" width="240" height="20" rx="6" opacity=".45" />
              <rect x="100" y="270" width="180" height="120" opacity=".5" />
              <circle cx="300" cy="170" r="9" opacity=".9" />
              <circle cx="270" cy="170" r="9" opacity=".6" />
            </g>
            <g stroke="currentColor" strokeWidth="4" opacity=".7">
              <path d="M125 300 H255" />
              <path d="M125 325 H235" />
              <path d="M125 350 H245" />
            </g>
          </svg>
          <div className="absolute top-[15%] left-[10%] w-[280px] h-[280px] rounded-[40%] rotate-12 blur-3xl bg-indigo-100/70 dark:bg-indigo-500/10" />
          <div className="absolute bottom-[10%] right-[5%] w-[220px] h-[220px] rounded-[45%] -rotate-12 blur-2xl bg-blue-100/60 dark:bg-blue-500/10" />
        </div>

        {marca}

        <div className="flex-1 flex flex-col justify-center">
          <h1 className="text-6xl font-black leading-[0.95] tracking-tight text-stone-900 dark:text-white">
            Print
            <br />
            Control
          </h1>
          <p className="mt-4 text-sm font-medium max-w-xs text-stone-500 dark:text-stone-400">
            Controle de locação de impressoras: contratos, leituras, faturamento, boletos e ordens de serviço.
          </p>
        </div>
      </div>

      {/* Painel direito: formulário de login */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 relative bg-stone-50 dark:bg-stone-900">
        {onToggleTheme && (
          <div className="absolute top-6 right-6 z-20">
            <ThemeToggle theme={theme} onToggle={onToggleTheme} variant="login" />
          </div>
        )}

        <div className="w-full max-w-md">
          {/* Marca no celular (o painel esquerdo fica oculto) */}
          <div className="flex lg:hidden mb-8">{marca}</div>

          <h2 className="text-3xl font-black tracking-tight text-stone-900 dark:text-white">Login</h2>
          <p className="text-sm font-medium mt-1.5 text-stone-500 dark:text-stone-400">
            Servidor: o número informado pela BMSoft. Usuário: seu e-mail. Cliente: o seu código de cliente.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5 mt-8">
            {errorMessage && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 flex items-start gap-2.5 text-xs font-bold text-rose-700 dark:text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            {infoMessage && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 flex items-start gap-2.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                <span>{infoMessage}</span>
              </div>
            )}

            <div>
              <label htmlFor="input-login-servidor" className="block text-[10px] font-bold uppercase tracking-widest ml-1 mb-1.5 text-stone-400 dark:text-stone-500">
                Servidor
              </label>
              <div className="relative">
                <Database className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 dark:text-stone-500 pointer-events-none" />
                <input
                  id="input-login-servidor"
                  type="text"
                  inputMode="numeric"
                  value={servidor}
                  onChange={(e) => {
                    setServidor(e.target.value.trim());
                    setEmpresas(null);
                    setErrorMessage(null);
                  }}
                  onFocus={(e) => e.target.select()}
                  placeholder="Número do servidor"
                  autoComplete="off"
                  autoFocus={!servidor}
                  required
                  className={`${INPUT_CLASS_LG} w-full pl-11`}
                />
              </div>
            </div>

            <div>
              <label htmlFor="input-login-usuario" className="block text-[10px] font-bold uppercase tracking-widest ml-1 mb-1.5 text-stone-400 dark:text-stone-500">
                Usuário
              </label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 dark:text-stone-500 pointer-events-none" />
                <input
                  id="input-login-usuario"
                  type="text"
                  value={usuarioEmail}
                  onChange={(e) => {
                    setUsuarioEmail(e.target.value);
                    setEmpresas(null);
                    setErrorMessage(null);
                  }}
                  onFocus={(e) => e.target.select()}
                  placeholder="voce@empresa.com.br ou código do cliente"
                  autoFocus={Boolean(servidor) && !usuarioEmail}
                  autoComplete="username"
                  required
                  className={`${INPUT_CLASS_LG} w-full pl-11`}
                />
              </div>
            </div>

            <div>
              <label htmlFor="input-login-senha" className="block text-[10px] font-bold uppercase tracking-widest ml-1 mb-1.5 text-stone-400 dark:text-stone-500">
                Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 dark:text-stone-500 pointer-events-none" />
                <input
                  id="input-login-senha"
                  type={showPassword ? 'text' : 'password'}
                  value={senha}
                  onChange={(e) => {
                    setSenha(e.target.value);
                    setEmpresas(null);
                    setErrorMessage(null);
                  }}
                  onFocus={(e) => e.target.select()}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  autoFocus={Boolean(servidor && usuarioEmail) && !senha}
                  required
                  className={`${INPUT_CLASS_LG} w-full pl-11 pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-pointer"
                  tabIndex={-1}
                  title={showPassword ? 'Esconder a senha' : 'Mostrar a senha'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {empresas && (
              <div>
                <label htmlFor="input-login-empresa" className="block text-[10px] font-bold uppercase tracking-widest ml-1 mb-1.5 text-stone-400 dark:text-stone-500">
                  Escolha a empresa
                </label>
                <div className="relative">
                  <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 dark:text-stone-500 pointer-events-none" />
                  <select
                    id="input-login-empresa"
                    autoFocus
                    value={empresaId ?? ''}
                    onChange={(e) => setEmpresaId(Number(e.target.value))}
                    className={`${INPUT_CLASS_LG} w-full pl-11`}
                  >
                    {empresas.map((em) => (
                      <option key={em.id} value={em.id}>
                        {em.nome} [{em.grupoId}/{em.id}]
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setEmpresas(null)}
                  className="mt-2 ml-1 text-xs font-bold text-stone-500 hover:text-indigo-600 dark:text-stone-400 cursor-pointer"
                >
                  Voltar para Login
                </button>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 py-1">
              <Toggle
                id="input-login-lembrar"
                checked={lembrar}
                onChange={setLembrar}
                size="sm"
                label={<span className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">Lembrar neste dispositivo</span>}
                title="Mantém a sessão ativa ao fechar o navegador e já traz usuário e senha preenchidos no próximo acesso. A senha fica guardada neste navegador."
              />
              {temDados && (
                <button
                  type="button"
                  onClick={() => setLimpando(true)}
                  title="Apaga o e-mail, a senha e a sessão guardados neste navegador"
                  className="text-xs font-bold text-stone-500 hover:text-rose-600 dark:text-stone-400 dark:hover:text-rose-400 cursor-pointer shrink-0"
                >
                  Limpar
                </button>
              )}
            </div>

            <button
              id="btn-login-submit"
              type="submit"
              disabled={isLoading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-indigo-200 dark:shadow-none transition-all flex items-center justify-center gap-2 mt-2 group disabled:opacity-70 cursor-pointer"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span className="uppercase tracking-wide">Entrar</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          <div className="flex items-center justify-between mt-8 pt-4 border-t border-stone-200 dark:border-stone-800 text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
            <span>PrintControl by BMsoft Sistemas</span>
            <span className="normal-case">v{__APP_VERSION__} • © {new Date().getFullYear()}</span>
          </div>
        </div>
      </div>

      {limpando && (
        <ConfirmDialog
          titulo="Limpar os dados deste dispositivo?"
          mensagem="Apaga o servidor, o usuário, a senha e a sessão guardados neste navegador. Você precisará digitar tudo de novo no próximo acesso."
          confirmar="Limpar"
          onConfirmar={() => {
            limparLembrete();
            limparSessao();
            setServidor('');
            setUsuarioEmail('');
            setSenha('');
            setLembrar(false);
            setTemDados(false);
            setLimpando(false);
          }}
          onCancelar={() => setLimpando(false)}
        />
      )}
    </div>
  );
};
