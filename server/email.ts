import nodemailer from 'nodemailer';

/**
 * Envio de e-mail por SMTP. O Delphi tinha o servidor fixo no código (nao_responda@bmsoft.com.br); aqui vem do .env,
 * com os mesmos nomes dos outros projetos: SMTP_HOST, SMTP_PORT (padrão 465), SMTP_USER, SMTP_PASS,
 * SMTP_FROM (padrão: o usuário), SMTP_SECURE (padrão: true na 465).
 */
export interface Anexo {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface Mensagem {
  para: string | string[];
  assunto: string;
  html: string;
  cc?: string | string[];
  /** Responder para (ex.: e-mail financeiro da empresa) */
  responderPara?: string;
  /** Nome que aparece como remetente (o endereço continua o do SMTP) */
  nomeRemetente?: string;
  anexos?: Anexo[];
}

export const emailConfigurado = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);

/** Separa listas "a@x.com; b@y.com" e descarta o que não parece e-mail */
export function enderecos(lista: string | string[] | null | undefined): string[] {
  return (Array.isArray(lista) ? lista : String(lista ?? '').split(/[;,\s]+/)).map((e) => e.trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
}

export async function enviarEmail(m: Mensagem) {
  if (!emailConfigurado()) throw Object.assign(new Error('E-mail não configurado no servidor (SMTP_HOST/SMTP_USER no .env).'), { status: 503 });
  const para = enderecos(m.para);
  if (!para.length) throw Object.assign(new Error('Nenhum e-mail de destino válido.'), { status: 400 });
  const port = Number(process.env.SMTP_PORT) || 465;
  const transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD },
  });
  const de = process.env.SMTP_FROM || process.env.SMTP_USER!;
  return transporte.sendMail({
    from: m.nomeRemetente ? { name: m.nomeRemetente, address: de } : de,
    to: para,
    cc: enderecos(m.cc),
    replyTo: m.responderPara,
    subject: m.assunto,
    html: m.html,
    attachments: m.anexos,
  });
}
