import { Usuario, EmpresaSessao, ClienteSessao, ServidorSessao } from '../types';

/**
 * Sessão e opção "Lembrar neste dispositivo".
 *
 * - Marcada: a sessão fica no localStorage (sobrevive ao fechar o navegador) e o
 *   e-mail é guardado para vir preenchido no próximo login.
 * - Desmarcada: a sessão fica no sessionStorage (termina ao fechar o navegador).
 *
 * A sessão guarda só o token assinado pelo servidor. Com "Lembrar" marcado, o
 * e-mail e a senha também ficam neste navegador (ver lerLembrete/salvarLembrete).
 */

const SESSAO = 'printcontrol_sessao';
const LEMBRETE = 'printcontrol_lembrar_email';

/** Usuário interno (usuario + empresa ativa) ou cliente da Área do Cliente */
export interface Sessao {
  token: string;
  servidor?: ServidorSessao;
  usuario?: Usuario;
  empresa?: EmpresaSessao;
  cliente?: ClienteSessao;
}

/** O acesso ao storage pode lançar exceção (modo privado, bloqueio de cookies) */
function seguro<T>(fn: () => T, padrao: T): T {
  try {
    return fn();
  } catch {
    return padrao;
  }
}

export function lerSessao(): Sessao | null {
  return seguro(() => {
    const bruto = localStorage.getItem(SESSAO) ?? sessionStorage.getItem(SESSAO);
    const s = bruto ? (JSON.parse(bruto) as Sessao) : null;
    return s?.token && ((s.usuario?.nivel && s.empresa) || s.cliente) ? s : null;
  }, null);
}

export function salvarSessao(sessao: Sessao, lembrar: boolean) {
  seguro(() => {
    (lembrar ? localStorage : sessionStorage).setItem(SESSAO, JSON.stringify(sessao));
    // Evita que sobre uma cópia no armazenamento que não foi escolhido
    (lembrar ? sessionStorage : localStorage).removeItem(SESSAO);
  }, undefined);
}

export function limparSessao() {
  seguro(() => {
    localStorage.removeItem(SESSAO);
    sessionStorage.removeItem(SESSAO);
  }, undefined);
}

/**
 * Último acesso com "Lembrar neste dispositivo" marcado: e-mail e senha.
 *
 * ATENÇÃO: a senha fica no localStorage deste navegador. O base64 só evita que ela
 * apareça legível de relance nas ferramentas do navegador — NÃO é criptografia: quem
 * tiver acesso ao computador (ou a uma extensão) consegue ler. Desmarcar a opção,
 * ou entrar com ela desmarcada, apaga o que estava guardado.
 */
export interface Lembrete {
  servidor: string;
  email: string;
  senha: string;
}

export function lerLembrete(): Lembrete | null {
  return seguro(() => {
    const bruto = localStorage.getItem(LEMBRETE);
    if (!bruto) return null;
    // Formato antigo: só o e-mail, em texto puro
    if (!bruto.startsWith('{')) return { servidor: '', email: bruto, senha: '' };
    const l = JSON.parse(bruto) as { servidor?: string; email?: string; senha?: string };
    return { servidor: String(l.servidor || ''), email: String(l.email || ''), senha: l.senha ? decodeURIComponent(escape(atob(l.senha))) : '' };
  }, null);
}

export function salvarLembrete(servidor: string, email: string, senha: string) {
  seguro(
    () => localStorage.setItem(LEMBRETE, JSON.stringify({ servidor, email, senha: senha ? btoa(unescape(encodeURIComponent(senha))) : '' })),
    undefined,
  );
}

export function limparLembrete() {
  seguro(() => localStorage.removeItem(LEMBRETE), undefined);
}
