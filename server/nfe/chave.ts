/**
 * Chave de acesso e dígitos verificadores.
 *
 * A chave tem 44 dígitos: cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9)
 * tpEmis(1) cNF(8) cDV(1). O dígito final é módulo 11 com pesos 2..9 girando
 * da direita para a esquerda, igual ao ACBrValidador.
 */
import { CODIGO_UF } from './servicos.js';
import { anoMesChave } from './datas.js';

export function digitoChave(chave43: string): number {
  const digitos = chave43.replace(/\D/g, '');
  let soma = 0;
  let peso = 2;

  for (let i = digitos.length - 1; i >= 0; i--) {
    soma += Number(digitos[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }

  const resto = soma % 11;
  return resto === 0 || resto === 1 ? 0 : 11 - resto;
}

export interface DadosChave {
  uf: string;
  /** Data de emissão; só ano e mês entram na chave */
  emissao: Date;
  cnpj: string;
  modelo: string;
  serie: number;
  numero: number;
  /** 1=Normal, 2=Contingência FS, 4=EPEC, 6=FS-DA, 7=SVC-AN, 9=Offline NFC-e */
  tipoEmissao: number;
  /** Código numérico aleatório; gerado quando não informado */
  codigoNumerico?: number;
}

export function montarChave(d: DadosChave): { chave: string; codigoNumerico: string } {
  const cUF = CODIGO_UF[d.uf.toUpperCase()];
  if (!cUF) throw new Error(`UF inválida na montagem da chave: "${d.uf}".`);

  // O cNF não pode ser igual ao nNF (rejeição 539)
  let cNF = d.codigoNumerico ?? Math.floor(Math.random() * 100_000_000);
  if (cNF === d.numero) cNF = (cNF + 1) % 100_000_000;
  const codigoNumerico = String(cNF).padStart(8, '0');

  const base =
    String(cUF).padStart(2, '0') +
    anoMesChave(d.emissao) +
    d.cnpj.replace(/\D/g, '').padStart(14, '0') +
    String(d.modelo).padStart(2, '0') +
    String(d.serie).padStart(3, '0') +
    String(d.numero).padStart(9, '0') +
    String(d.tipoEmissao) +
    codigoNumerico;

  return { chave: base + digitoChave(base), codigoNumerico };
}

export function chaveValida(chave: string): boolean {
  const c = String(chave || '').replace(/\D/g, '');
  return c.length === 44 && digitoChave(c.slice(0, 43)) === Number(c[43]);
}

/** Destrincha uma chave de acesso — usado nas consultas e na Distribuição DF-e */
export function lerChave(chave: string) {
  const c = chave.replace(/\D/g, '');
  if (c.length !== 44) throw new Error('A chave de acesso precisa ter 44 dígitos.');

  return {
    cUF: Number(c.slice(0, 2)),
    ano: 2000 + Number(c.slice(2, 4)),
    mes: Number(c.slice(4, 6)),
    cnpj: c.slice(6, 20),
    modelo: c.slice(20, 22),
    serie: Number(c.slice(22, 25)),
    numero: Number(c.slice(25, 34)),
    tipoEmissao: Number(c[34]),
    codigoNumerico: c.slice(35, 43),
    dv: Number(c[43]),
  };
}

// ---------------------------------------------------------------------------
// CNPJ / CPF
// ---------------------------------------------------------------------------

function digitosVerificadores(base: string, pesoInicial: number): string {
  let soma = 0;
  let peso = pesoInicial;
  for (const d of base) {
    soma += Number(d) * peso;
    peso = peso === 2 ? 9 : peso - 1;
  }
  const resto = soma % 11;
  return String(resto < 2 ? 0 : 11 - resto);
}

export function cnpjValido(valor: string): boolean {
  const c = String(valor || '').replace(/\D/g, '');
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const d1 = digitosVerificadores(c.slice(0, 12), 5);
  const d2 = digitosVerificadores(c.slice(0, 12) + d1, 6);
  return c.slice(12) === d1 + d2;
}

export function cpfValido(valor: string): boolean {
  const c = String(valor || '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;

  const calc = (ate: number) => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(c[i]) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return String(resto === 10 ? 0 : resto);
  };

  return c[9] === calc(9) && c[10] === calc(10);
}
