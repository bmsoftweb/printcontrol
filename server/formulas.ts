/**
 * Fórmulas de imposto "Portugol" (nfe_impostos_formulas.script_calculo), reimplementadas sem eval.
 *
 * No Delphi o script passava por TiraComentario + SemEspaco + Portugol2Pascal e era executado pelo
 * TInterpreter/TCalcul (Jan Tungli): IF … THEN { … } [ELSE { … }], WHILE … DO { … }, PROCEDURE nome { … },
 * EXEC nome, BREAK, CONTINUE, EXIT, END., atribuição "x:=expr", fórmulas separadas por ";" e variáveis
 * "grupo.campo". Aqui o script vira tokens, depois uma árvore, e a árvore é interpretada com limite de laço.
 *
 * Expressões: + - * / ^ div mod, = <> < > <= >=, AND OR NOT, "x in [a,b]", "s || t", "s like t" (% e _),
 * strings "..." ou '...', booleanos 1/0 e as funções mais usadas do TCalcul (ver FUNCOES).
 */

export type Valor = number | string;
export type Variaveis = Record<string, Valor>;

// ---------------------------------------------------------------------------
// Preparação do texto (TiraComentario / Portugol2Pascal)
// ---------------------------------------------------------------------------

/** Tira comentários // e /* *\/ fora de strings */
export function tirarComentarios(s: string): string {
  let r = '';
  let aspas: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (aspas) {
      r += c;
      if (c === aspas) aspas = null;
      continue;
    }
    if (c === '"' || c === "'") {
      aspas = c;
      r += c;
      continue;
    }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      r += '\n';
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      const fim = s.indexOf('*/', i + 2);
      i = fim < 0 ? s.length : fim + 1;
      r += ' ';
      continue;
    }
    r += c;
  }
  return r;
}

/** Portugol2Pascal: marcadores <SE>, <ENTAO>, <SENAO>, <FIM>, <PROC>, <fimscript> */
export function portugolParaPascal(s: string): string {
  return s
    .replace(/<PROC>/gi, 'PROCEDURE')
    .replace(/<SE>/gi, 'IF')
    .replace(/<ENTAO>/gi, 'THEN {')
    .replace(/<SENAO>/gi, '} ELSE {')
    .replace(/<FIM>/gi, '}')
    .replace(/<fimscript>/gi, 'END.');
}

/** Script como o Delphi gravava em vendas_produtos.calculo_imposto_formula */
export const prepararScript = (script: string) => portugolParaPascal(tirarComentarios(script ?? '')).replace(/\s*:=\s*/g, ':=');

// ---------------------------------------------------------------------------
// Variáveis em texto (variaveis.txt / calculo_imposto_variaveis)
// ---------------------------------------------------------------------------

/** "nome=valor" por linha; strings entre aspas, números com ponto */
export function lerVariaveis(texto: string): Variaveis {
  const v: Variaveis = {};
  for (const bruta of tirarComentarios(texto).split(/\r?\n/)) {
    const linha = bruta.trim();
    const p = linha.indexOf('=');
    if (!linha || p <= 0) continue;
    const nome = linha.slice(0, p).trim();
    const valor = linha.slice(p + 1).trim();
    const str = valor.match(/^"(.*)"$/) || valor.match(/^'(.*)'$/);
    v[nome] = str ? str[1] : valor === '' ? '' : Number.isFinite(Number(valor)) ? Number(valor) : valor;
  }
  return v;
}

export function variaveisParaTexto(v: Variaveis): string {
  return Object.entries(v)
    .map(([k, x]) => `${k}=${typeof x === 'number' ? String(Number(x.toFixed(10))) : `"${x}"`}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type Tok = { t: 'num'; v: number; p: number } | { t: 'str'; v: string; p: number } | { t: 'id'; v: string; p: number } | { t: 'op'; v: string; p: number };

const OPS = [':=', '<>', '<=', '>=', '||', '=', '<', '>', '+', '-', '*', '/', '^', '(', ')', '[', ']', ',', ';', '{', '}'];

export class ErroFormula extends Error {}

function tokens(s: string): Tok[] {
  const r: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const fim = s.indexOf(c, i + 1);
      if (fim < 0) throw new ErroFormula(`Texto sem aspas de fechamento perto do caracter ${i + 1}`);
      r.push({ t: 'str', v: s.slice(i + 1, fim), p: i });
      i = fim + 1;
      continue;
    }
    const num = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (num) {
      r.push({ t: 'num', v: Number(num[0]), p: i });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][\w.]*/.exec(s.slice(i));
    if (id) {
      // "END." é o fim do programa; "x." no fim de um nome não faz parte dele
      let nome = id[0];
      if (nome.toUpperCase() !== 'END.' && nome.endsWith('.')) nome = nome.replace(/\.+$/, '');
      r.push({ t: 'id', v: nome, p: i });
      i += nome.length;
      continue;
    }
    const op = OPS.find((o) => s.startsWith(o, i));
    if (!op) throw new ErroFormula(`Caracter inválido "${c}" perto do caracter ${i + 1}`);
    r.push({ t: 'op', v: op, p: i });
    i += op.length;
  }
  return r;
}

// ---------------------------------------------------------------------------
// Árvore
// ---------------------------------------------------------------------------

type Expr =
  | { k: 'lit'; v: Valor }
  | { k: 'var'; n: string }
  | { k: 'un'; op: string; e: Expr }
  | { k: 'bin'; op: string; a: Expr; b: Expr }
  | { k: 'in'; a: Expr; lista: Expr[] }
  | { k: 'fn'; n: string; args: Expr[] };

type Cmd =
  | { k: 'set'; n: string; e: Expr }
  | { k: 'expr'; e: Expr }
  | { k: 'if'; c: Expr; entao: Cmd[]; senao: Cmd[] }
  | { k: 'while'; c: Expr; corpo: Cmd[] }
  | { k: 'exec'; n: string }
  | { k: 'break' }
  | { k: 'continue' }
  | { k: 'exit' }
  | { k: 'end' };

const PALAVRAS = new Set(['IF', 'THEN', 'ELSE', 'WHILE', 'DO', 'PROCEDURE', 'EXEC', 'BREAK', 'CONTINUE', 'EXIT', 'BEEP', 'END.', 'END', 'AND', 'OR', 'NOT', 'DIV', 'MOD', 'IN', 'LIKE']);

class Parser {
  i = 0;
  procs: Record<string, Cmd[]> = {};
  constructor(private tk: Tok[]) {}

  private veja(): Tok | undefined {
    return this.tk[this.i];
  }
  private ehOp(v: string) {
    const t = this.veja();
    return t?.t === 'op' && t.v === v;
  }
  private ehPalavra(v: string) {
    const t = this.veja();
    return t?.t === 'id' && t.v.toUpperCase() === v;
  }
  private esperarOp(v: string) {
    if (!this.ehOp(v)) throw new ErroFormula(`Erro de sintaxe: esperado "${v}" ${this.onde()}`);
    this.i++;
  }
  private esperarPalavra(v: string) {
    if (!this.ehPalavra(v)) throw new ErroFormula(`Erro de sintaxe: falta "${v}" ${this.onde()}`);
    this.i++;
  }
  private onde() {
    const t = this.veja();
    return t ? `perto do caracter ${t.p + 1}` : 'no fim do script';
  }

  programa(): Cmd[] {
    const cmds: Cmd[] = [];
    while (this.i < this.tk.length) {
      const c = this.comando();
      if (c) cmds.push(c);
    }
    return cmds;
  }

  private bloco(): Cmd[] {
    this.esperarOp('{');
    const cmds: Cmd[] = [];
    while (!this.ehOp('}')) {
      if (this.i >= this.tk.length) throw new ErroFormula('Erro de sintaxe, contagem de chaves errada (falta "}")');
      const c = this.comando();
      if (c) cmds.push(c);
    }
    this.i++;
    return cmds;
  }

  private comando(): Cmd | null {
    const t = this.veja()!;
    if (t.t === 'op' && t.v === ';') {
      this.i++;
      return null;
    }
    if (t.t === 'op' && t.v === '}') throw new ErroFormula(`Erro de sintaxe "}" sobrando perto do caracter ${t.p + 1}`);
    if (t.t === 'id') {
      const p = t.v.toUpperCase();
      if (p === 'IF') {
        this.i++;
        const c = this.expr();
        this.esperarPalavra('THEN');
        const entao = this.bloco();
        let senao: Cmd[] = [];
        if (this.ehPalavra('ELSE')) {
          this.i++;
          senao = this.bloco();
        }
        return { k: 'if', c, entao, senao };
      }
      if (p === 'WHILE') {
        this.i++;
        const c = this.expr();
        this.esperarPalavra('DO');
        return { k: 'while', c, corpo: this.bloco() };
      }
      if (p === 'PROCEDURE') {
        this.i++;
        const nome = this.veja();
        if (nome?.t !== 'id') throw new ErroFormula(`Definição de procedure inválida ${this.onde()}`);
        this.i++;
        this.procs[nome.v.toUpperCase()] = this.bloco();
        return null;
      }
      if (p === 'EXEC') {
        this.i++;
        const nome = this.veja();
        if (nome?.t !== 'id') throw new ErroFormula(`Nome inválido da procedure em "EXEC" ${this.onde()}`);
        this.i++;
        return { k: 'exec', n: nome.v.toUpperCase() };
      }
      if (p === 'BREAK' || p === 'CONTINUE' || p === 'EXIT') {
        this.i++;
        return { k: p.toLowerCase() as 'break' };
      }
      if (p === 'BEEP') {
        this.i++;
        return null;
      }
      if (p === 'END.' || p === 'END') {
        this.i++;
        return { k: 'end' };
      }
      const prox = this.tk[this.i + 1];
      if (prox?.t === 'op' && prox.v === ':=') {
        this.i += 2;
        return { k: 'set', n: t.v, e: this.expr() };
      }
    }
    return { k: 'expr', e: this.expr() };
  }

  // Precedência: OR < AND < NOT < comparação < + - || < * / div mod < ^ < unário
  expr(): Expr {
    let a = this.e_and();
    while (this.ehPalavra('OR')) {
      this.i++;
      a = { k: 'bin', op: 'OR', a, b: this.e_and() };
    }
    return a;
  }
  private e_and(): Expr {
    let a = this.e_not();
    while (this.ehPalavra('AND')) {
      this.i++;
      a = { k: 'bin', op: 'AND', a, b: this.e_not() };
    }
    return a;
  }
  private e_not(): Expr {
    if (this.ehPalavra('NOT')) {
      this.i++;
      return { k: 'un', op: 'NOT', e: this.e_not() };
    }
    return this.e_cmp();
  }
  private e_cmp(): Expr {
    const a = this.e_add();
    const t = this.veja();
    if (t?.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) {
      this.i++;
      return { k: 'bin', op: t.v, a, b: this.e_add() };
    }
    if (this.ehPalavra('LIKE')) {
      this.i++;
      return { k: 'bin', op: 'LIKE', a, b: this.e_add() };
    }
    if (this.ehPalavra('IN')) {
      this.i++;
      this.esperarOp('[');
      const lista: Expr[] = [];
      while (!this.ehOp(']')) {
        lista.push(this.expr());
        if (this.ehOp(',')) this.i++;
        else if (!this.ehOp(']')) throw new ErroFormula(`Erro de sintaxe na lista do IN ${this.onde()}`);
      }
      this.i++;
      return { k: 'in', a, lista };
    }
    return a;
  }
  private e_add(): Expr {
    let a = this.e_mul();
    for (;;) {
      const t = this.veja();
      if (t?.t === 'op' && (t.v === '+' || t.v === '-' || t.v === '||')) {
        this.i++;
        a = { k: 'bin', op: t.v, a, b: this.e_mul() };
      } else return a;
    }
  }
  private e_mul(): Expr {
    let a = this.e_pot();
    for (;;) {
      const t = this.veja();
      if (t?.t === 'op' && (t.v === '*' || t.v === '/')) {
        this.i++;
        a = { k: 'bin', op: t.v, a, b: this.e_pot() };
      } else if (this.ehPalavra('DIV') || this.ehPalavra('MOD')) {
        const op = String(this.veja()!.v).toUpperCase();
        this.i++;
        a = { k: 'bin', op, a, b: this.e_pot() };
      } else return a;
    }
  }
  private e_pot(): Expr {
    const a = this.e_un();
    if (this.ehOp('^')) {
      this.i++;
      return { k: 'bin', op: '^', a, b: this.e_pot() };
    }
    return a;
  }
  private e_un(): Expr {
    if (this.ehOp('-') || this.ehOp('+')) {
      const op = String(this.veja()!.v);
      this.i++;
      return { k: 'un', op, e: this.e_un() };
    }
    return this.primario();
  }
  private primario(): Expr {
    const t = this.veja();
    if (!t) throw new ErroFormula('Fórmula incompleta no fim do script');
    if (t.t === 'num' || t.t === 'str') {
      this.i++;
      return { k: 'lit', v: t.v };
    }
    if (t.t === 'op' && t.v === '(') {
      this.i++;
      const e = this.expr();
      this.esperarOp(')');
      return e;
    }
    if (t.t === 'id') {
      if (PALAVRAS.has(t.v.toUpperCase())) throw new ErroFormula(`Erro de sintaxe: "${t.v}" inesperado perto do caracter ${t.p + 1}`);
      this.i++;
      if (this.ehOp('(')) {
        this.i++;
        const args: Expr[] = [];
        while (!this.ehOp(')')) {
          args.push(this.expr());
          if (this.ehOp(',')) this.i++;
          else if (!this.ehOp(')')) throw new ErroFormula(`Erro de sintaxe nos argumentos de ${t.v} ${this.onde()}`);
        }
        this.i++;
        return { k: 'fn', n: t.v.toLowerCase(), args };
      }
      return { k: 'var', n: t.v };
    }
    throw new ErroFormula(`Erro de sintaxe: "${t.v}" inesperado perto do caracter ${t.p + 1}`);
  }
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

const MAX_WHILE = 65000;
const MAX_PASSOS = 1_000_000;

const num = (v: Valor): number => {
  if (typeof v === 'number') return v;
  const n = Number(String(v).trim().replace(',', '.'));
  if (String(v).trim() === '' || !Number.isFinite(n)) throw new ErroFormula(`Valor não numérico: "${v}"`);
  return n;
};
const str = (v: Valor) => (typeof v === 'number' ? String(Number(v.toFixed(10))) : v);
const bool = (v: Valor) => (typeof v === 'number' ? v !== 0 : v !== '' && v !== '0');
const b = (x: boolean) => (x ? 1 : 0);

/** Arredondamento comercial sem o erro binário de toFixed (1.005 → 1.01) */
export const arred = (v: number, casas = 2) => {
  const s = v < 0 ? -1 : 1;
  return s * Number(`${Math.round(Number(`${Math.abs(v)}e${casas}`))}e-${casas}`);
};

const FUNCOES: Record<string, (a: Valor[], vars: Variaveis) => Valor> = {
  abs: ([x]) => Math.abs(num(x)),
  trunc: ([x]) => Math.trunc(num(x)),
  frac: ([x]) => num(x) - Math.trunc(num(x)),
  round: ([x, c]) => arred(num(x), c === undefined ? 0 : num(c)),
  arredonda: ([x, c]) => arred(num(x), c === undefined ? 2 : num(c)),
  sqrt: ([x]) => Math.sqrt(num(x)),
  sign: ([x]) => Math.sign(num(x)),
  h: ([x]) => (num(x) >= 0 ? 1 : 0),
  heaviside: ([x]) => (num(x) >= 0 ? 1 : 0),
  maxval: (a) => Math.max(...a.map(num)),
  minval: (a) => Math.min(...a.map(num)),
  sumval: (a) => a.map(num).reduce((s, x) => s + x, 0),
  avgval: (a) => (a.length ? a.map(num).reduce((s, x) => s + x, 0) / a.length : 0),
  logic: ([x]) => b(bool(x)),
  numeric: ([x]) => num(x),
  string: ([x]) => str(x),
  length: ([s]) => str(s).length,
  pos: ([t, s]) => str(s).indexOf(str(t)) + 1,
  trim: ([s]) => str(s).trim(),
  trimleft: ([s]) => str(s).trimStart(),
  trimright: ([s]) => str(s).trimEnd(),
  upper: ([s]) => str(s).toUpperCase(),
  lower: ([s]) => str(s).toLowerCase(),
  copy: ([s, x, y]) => str(s).substr(num(x) - 1, y === undefined ? undefined : num(y)),
  iff: ([a, s, t]) => (bool(a) ? s : t),
  replace: ([s, t, v]) => str(s).split(str(t)).join(str(v)),
  prefix: ([n, c, s]) => str(s).padStart(num(n), str(c) || ' '),
  existvar: ([n], vars) => b(Object.prototype.hasOwnProperty.call(vars, str(n))),
};

function like(s: string, padrao: string) {
  const re = padrao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${re}$`, 'i').test(s);
}

class Parar {
  constructor(public tipo: 'break' | 'continue' | 'exit' | 'end') {}
}

class Maquina {
  passos = 0;
  constructor(public vars: Variaveis, private procs: Record<string, Cmd[]>) {}

  private achar(n: string): string | undefined {
    if (Object.prototype.hasOwnProperty.call(this.vars, n)) return n;
    const baixo = n.toLowerCase();
    return Object.keys(this.vars).find((k) => k.toLowerCase() === baixo);
  }

  avaliar(e: Expr): Valor {
    if (++this.passos > MAX_PASSOS) throw new ErroFormula('Script excedeu o limite de execução');
    switch (e.k) {
      case 'lit':
        return e.v;
      case 'var': {
        const k = this.achar(e.n);
        if (k === undefined) {
          const sys = e.n.toUpperCase();
          if (sys === '_PI') return Math.PI;
          if (sys === 'TRUE') return 1;
          if (sys === 'FALSE') return 0;
          throw new ErroFormula(`Variável desconhecida: ${e.n}`);
        }
        return this.vars[k];
      }
      case 'un': {
        const v = this.avaliar(e.e);
        if (e.op === 'NOT') return b(!bool(v));
        return e.op === '-' ? -num(v) : num(v);
      }
      case 'in': {
        const v = this.avaliar(e.a);
        return b(e.lista.some((x) => igual(v, this.avaliar(x))));
      }
      case 'fn': {
        const f = FUNCOES[e.n];
        if (!f) throw new ErroFormula(`Função desconhecida: ${e.n}`);
        return f(e.args.map((a) => this.avaliar(a)), this.vars);
      }
      case 'bin': {
        if (e.op === 'AND') return b(bool(this.avaliar(e.a)) && bool(this.avaliar(e.b)));
        if (e.op === 'OR') return b(bool(this.avaliar(e.a)) || bool(this.avaliar(e.b)));
        const x = this.avaliar(e.a);
        const y = this.avaliar(e.b);
        switch (e.op) {
          case '+':
            return typeof x === 'string' || typeof y === 'string' ? str(x) + str(y) : x + y;
          case '||':
            return str(x) + str(y);
          case '-':
            return num(x) - num(y);
          case '*':
            return num(x) * num(y);
          case '/': {
            if (num(y) === 0) throw new ErroFormula('Divisão por zero');
            return num(x) / num(y);
          }
          case 'DIV':
            if (num(y) === 0) throw new ErroFormula('Divisão por zero');
            return Math.trunc(num(x) / num(y));
          case 'MOD':
            if (num(y) === 0) throw new ErroFormula('Divisão por zero');
            return Math.trunc(num(x)) % Math.trunc(num(y));
          case '^':
            return Math.pow(num(x), num(y));
          case 'LIKE':
            return b(like(str(x), str(y)));
          default:
            return b(comparar(x, y, e.op));
        }
      }
    }
  }

  executar(cmds: Cmd[], nivel = 0) {
    if (nivel > 50) throw new ErroFormula('Chamadas de procedure aninhadas demais (EXEC recursivo?)');
    for (const c of cmds) {
      switch (c.k) {
        case 'set': {
          this.vars[this.achar(c.n) ?? c.n] = this.avaliar(c.e);
          break;
        }
        case 'expr':
          this.avaliar(c.e);
          break;
        case 'if':
          this.executar(bool(this.avaliar(c.c)) ? c.entao : c.senao, nivel);
          break;
        case 'while': {
          let n = 0;
          while (bool(this.avaliar(c.c))) {
            if (++n > MAX_WHILE) throw new ErroFormula(`Estouro no limite da contagem WHILE (max. ${MAX_WHILE})`);
            try {
              this.executar(c.corpo, nivel);
            } catch (p) {
              if (p instanceof Parar && p.tipo === 'break') break;
              if (p instanceof Parar && p.tipo === 'continue') continue;
              throw p;
            }
          }
          break;
        }
        case 'exec': {
          const corpo = this.procs[c.n];
          if (!corpo) throw new ErroFormula(`Procedure não definida: ${c.n}`);
          try {
            this.executar(corpo, nivel + 1);
          } catch (p) {
            if (!(p instanceof Parar && p.tipo === 'exit')) throw p;
          }
          break;
        }
        default:
          throw new Parar(c.k);
      }
    }
  }
}

function igual(x: Valor, y: Valor) {
  return comparar(x, y, '=');
}

function comparar(x: Valor, y: Valor, op: string): boolean {
  let a: number | string = x;
  let c: number | string = y;
  // Número com texto numérico compara como número; texto com texto, como texto
  if (typeof x !== typeof y) {
    const nx = Number(x);
    const ny = Number(y);
    if (String(x).trim() !== '' && String(y).trim() !== '' && Number.isFinite(nx) && Number.isFinite(ny)) {
      a = nx;
      c = ny;
    } else {
      a = str(x);
      c = str(y);
    }
  }
  switch (op) {
    case '=':
      return a === c;
    case '<>':
      return a !== c;
    case '<':
      return a < c;
    case '>':
      return a > c;
    case '<=':
      return a <= c;
    case '>=':
      return a >= c;
  }
  return false;
}

export interface ResultadoScript {
  variaveis: Variaveis;
  /** Mensagem de erro do script (como o alerta do Delphi; a execução para no erro) */
  erro?: string;
  /** Script já traduzido (vendas_produtos.calculo_imposto_formula) */
  script: string;
}

/** Executa o script (Portugol ou Pascal) sobre uma cópia das variáveis */
export function executarScript(script: string, variaveis: Variaveis): ResultadoScript {
  const preparado = prepararScript(script);
  const vars = { ...variaveis };
  try {
    const p = new Parser(tokens(preparado));
    const cmds = p.programa();
    try {
      new Maquina(vars, p.procs).executar(cmds);
    } catch (x) {
      if (!(x instanceof Parar)) throw x;
    }
    return { variaveis: vars, script: preparado };
  } catch (e: any) {
    return { variaveis: vars, erro: e instanceof ErroFormula ? e.message : `Fórmula inválida: ${e?.message || e}`, script: preparado };
  }
}

// ---------------------------------------------------------------------------
// Escolha da fórmula (7 níveis de prioridade)
// ---------------------------------------------------------------------------

export interface FormulaImposto {
  id: number;
  uf: string | null;
  operacao_codigo: string | null;
  ncm: string | null;
  id_produto: string | null;
  id_cliente: string | null;
  tipo_imposto_produto: string | null;
  tipo_imposto_cliente: string | null;
  script_calculo: string | null;
}

export interface DadosEscolha {
  uf: string;
  operacao: string;
  ncm: string;
  idProduto: string | number;
  idCliente: string | number;
  tipoProduto: string;
  tipoCliente: string;
}

/**
 * "Valor contido na lista da coluna". O Delphi usava POSITION (substring: id 5 casava com "15");
 * aqui a coluna é uma lista separada por ; , ou espaço e a comparação é por elemento.
 * Valor vazio casa com qualquer coluna (como o POSITION('' IN x) do Delphi).
 */
export function contido(valor: string | number | null | undefined, coluna: string | null | undefined): boolean {
  const v = String(valor ?? '').trim().toUpperCase();
  if (!v) return true;
  return String(coluna ?? '')
    .split(/[;,\s]+/)
    .map((x) => x.trim().toUpperCase())
    .includes(v);
}

/** Primeira fórmula (menor id) do nível mais específico que casar; null quando nenhuma serve */
export function escolherFormula<T extends FormulaImposto>(formulas: T[], d: DadosEscolha): T | null {
  const testes: ((f: T) => boolean)[] = [
    (f) => contido(d.uf, f.uf),
    (f) => contido(d.operacao, f.operacao_codigo),
    (f) => contido(d.ncm, f.ncm),
    (f) => contido(d.idProduto, f.id_produto),
    (f) => contido(d.idCliente, f.id_cliente),
    (f) => contido(d.tipoProduto, f.tipo_imposto_produto),
    (f) => contido(d.tipoCliente, f.tipo_imposto_cliente),
  ];
  const ordenadas = [...formulas].sort((a, b) => a.id - b.id);
  for (let n = 7; n >= 1; n--) {
    const achada = ordenadas.find((f) => testes.slice(0, n).every((t) => t(f)));
    if (achada) return achada;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Variáveis padrão (NFe\Scripts\variaveis.txt do Delphi)
// ---------------------------------------------------------------------------

export interface EntradaImposto {
  empresa: { cnpj: string; regime: string; uf: string };
  operacao: { id: number; es: string; codigo: string; tipo: string; apelido: string };
  cliente: { uf: string; tipo: string };
  produto: {
    id: number;
    ean: string;
    un: string;
    tipo: string;
    ncm: string;
    cest: string;
    origem: string;
    quantidade: number;
    valorBruto: number;
    acrescimo: number;
    desconto: number;
    valorLiquido: number;
  };
}

/** Saídas: nome da variável → [coluna de nfe_impostos_produtos, é texto] */
export const SAIDAS: [string, string, boolean][] = [
  ['icms.cst', 'icms_CST', true],
  ['icms.csosn', 'icms_CSOSN', true],
  ['icms.modBC', 'icms_modBC', true],
  ['icms.vBC', 'icms_vBC', false],
  ['icms.pICMS', 'icms_pICMS', false],
  ['icms.vICMS', 'icms_vICMS', false],
  ['icms.modBCST', 'icms_modBCST', true],
  ['icms.pMVAST', 'icms_pMVAST', false],
  ['icms.pRedBCST', 'icms_pRedBCST', false],
  ['icms.vBCST', 'icms_vBCST', false],
  ['icms.pICMSST', 'icms_pICMSST', false],
  ['icms.vICMSST', 'icms_vICMSST', false],
  ['icms.pRedBC', 'icms_pRedBC', false],
  ['icms.pCredSN', 'icms_pCredSN', false],
  ['icms.vCredICMSSN', 'icms_vCredICMSSN', false],
  ['icms.vBCFCPST', 'icms_vBCFCPST', false],
  ['icms.pFCPST', 'icms_pFCPST', false],
  ['icms.vFCPST', 'icms_vFCPST', false],
  ['icms.vBCSTRet', 'icms_vBCSTRet', false],
  ['icms.pST', 'icms_pST', false],
  ['icms.vICMSSubstituto', 'icms_vICMSSubstituto', false],
  ['icms.vICMSSTRet', 'icms_vICMSSTRet', false],
  ['icms.vBCFCPSTRet', 'icms_vBCFCPSTRet', false],
  ['icms.pFCPSTRet', 'icms_pFCPSTRet', false],
  ['icms.vFCPSTRet', 'icms_vFCPSTRet', false],
  ['icms.pRedBCEfet', 'icms_pRedBCEfet', false],
  ['icms.vBCEfet', 'icms_vBCEfet', false],
  ['icms.pICMSEfet', 'icms_pICMSEfet', false],
  ['icms.vICMSEfet', 'icms_vICMSEfet', false],
  // Partilha (o Delphi calculava e não gravava; aqui grava)
  ['icms.vBCUFDest', 'icms_vBCUFDest', false],
  ['icms.pFCPUFDest', 'icms_pFCPUFDest', false],
  ['icms.pICMSUFDest', 'icms_pICMSUFDest', false],
  ['icms.pICMSInter', 'icms_pICMSInter', false],
  ['icms.pICMSInterPart', 'icms_pICMSInterPart', false],
  ['icms.vFCPUFDest', 'icms_vFCPUFDest', false],
  ['icms.vICMSUFDest', 'icms_vICMSUFDest', false],
  ['icms.vICMSUFRemet', 'icms_vICMSUFRemet', false],
  ['ipi.CST', 'ipi_cst', true],
  ['ipi.clEnq', 'ipi_clEnq', true],
  ['ipi.CNPJProd', 'ipi_CNPJProd', true],
  ['ipi.cSelo', 'ipi_cSelo', true],
  ['ipi.qSelo', 'ipi_qSelo', false],
  ['ipi.cEnq', 'ipi_cEnq', true],
  ['ipi.vBC', 'ipi_vBC', false],
  ['ipi.qUnid', 'ipi_qUnid', false],
  ['ipi.vUnid', 'ipi_vUnid', false],
  ['ipi.pIPI', 'ipi_pIPI', false],
  ['ipi.vIPI', 'ipi_vIPI', false],
  ['ii.vBc', 'ii_vBC', false],
  ['ii.vDespAdu', 'ii_vDespAdu', false],
  ['ii.vII', 'ii_vII', false],
  ['ii.vIOF', 'ii_vIOF', false],
  ['pis.CST', 'pis_CST', true],
  ['pis.vBC', 'pis_vBC', false],
  ['pis.pPIS', 'pis_pPIS', false],
  ['pis.vPIS', 'pis_vPIS', false],
  ['pis.qBCProd', 'pis_qBCProd', false],
  ['pis.vAliqProd', 'pis_vAliqProd', false],
  ['pisst.vBc', 'pisst_vBc', false],
  ['pisst.pPis', 'pisst_pPIS', false],
  ['pisst.qBCProd', 'pisst_qBCProd', false],
  ['pisst.vAliqProd', 'pisst_vAliqProd', false],
  ['pisst.vPIS', 'pisst_vPIS', false],
  ['cofins.CST', 'cofins_CST', true],
  ['cofins.vBC', 'cofins_vBC', false],
  ['cofins.pCOFINS', 'cofins_pCOFINS', false],
  ['cofins.vCOFINS', 'cofins_vCOFINS', false],
  ['cofins.qBCProd', 'cofins_qBCProd', false],
  ['cofins.vAliqProd', 'cofins_vAliqProd', false],
  ['cofinsst.vBC', 'cofinsst_vBC', false],
  ['cofinsst.pCOFINS', 'cofinsst_pCOFINS', false],
  ['cofinsst.qBCProd', 'cofinsst_qBCProd', false],
  ['cofinsst.vAliqProd', 'cofinsst_vAliqProd', false],
  ['cofinsst.vCOFINS', 'cofinsst_vCOFINS', false],
];

export function variaveisIniciais(e: EntradaImposto): Variaveis {
  const v: Variaveis = {
    'empresa.cnpj': e.empresa.cnpj,
    'empresa.regime': e.empresa.regime,
    'empresa.uf': e.empresa.uf,
    'operacao.id': e.operacao.id,
    'operacao.es': e.operacao.es,
    'operacao.codigo': e.operacao.codigo,
    'operacao.tipo': e.operacao.tipo,
    'operacao.apelido': e.operacao.apelido,
    'cliente.uf': e.cliente.uf,
    'cliente.tipo': e.cliente.tipo,
    'produto.id': e.produto.id,
    'produto.ean': e.produto.ean,
    'produto.un': e.produto.un,
    'produto.tipo': e.produto.tipo,
    'produto.ncm': e.produto.ncm,
    'produto.cest': e.produto.cest,
    'produto.origem': e.produto.origem,
    'produto.quantidade': e.produto.quantidade,
    'produto.valorBruto': e.produto.valorBruto,
    'produto.acrescimo': e.produto.acrescimo,
    'produto.desconto': e.produto.desconto,
    'produto.valorLiquido': e.produto.valorLiquido,
    'produto.cfop': '',
  };
  for (const [nome, , texto] of SAIDAS) v[nome] = texto ? '' : 0;
  return v;
}

/** Variáveis finais → colunas de nfe_impostos_produtos (números arredondados como no banco) */
export function colunasImposto(vars: Variaveis): Record<string, string | number | null> {
  const r: Record<string, string | number | null> = {};
  const pegar = (n: string) => {
    const k = Object.keys(vars).find((x) => x.toLowerCase() === n.toLowerCase());
    return k === undefined ? undefined : vars[k];
  };
  for (const [nome, coluna, texto] of SAIDAS) {
    const v = pegar(nome);
    if (texto) r[coluna] = v === undefined || v === '' ? null : str(v);
    else {
      const n = v === undefined || v === '' ? 0 : Number(v);
      r[coluna] = Number.isFinite(n) ? arred(n, 4) : 0;
    }
  }
  return r;
}

export const variavelTexto = (vars: Variaveis, nome: string) => {
  const k = Object.keys(vars).find((x) => x.toLowerCase() === nome.toLowerCase());
  return k === undefined ? '' : str(vars[k]);
};
