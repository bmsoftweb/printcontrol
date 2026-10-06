import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';

/**
 * PDF a partir de HTML (mesma solução do crmweb):
 * - Na Vercel (serverless, sem navegador instalado): Chromium do @sparticuz/chromium, controlado pelo puppeteer-core.
 * - Nos demais servidores: Edge/Chrome instalado, em modo headless. Caminho do navegador: NAVEGADOR_PDF no .env,
 *   ou o primeiro encontrado nos locais padrão.
 */
const CANDIDATOS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
];

function navegador(): string {
  const escolhido = process.env.NAVEGADOR_PDF || CANDIDATOS.find((c) => existsSync(c));
  if (!escolhido) throw new Error('Gerar PDF: nenhum Edge/Chrome encontrado no servidor. Informe NAVEGADOR_PDF no .env.');
  return escolhido;
}

/** Na Vercel: Chromium empacotado para serverless. Importado só aqui, para não pesar fora dela */
async function pdfServerless(html: string): Promise<Buffer> {
  const [{ default: chromium }, { default: puppeteer }] = await Promise.all([import('@sparticuz/chromium'), import('puppeteer-core')]);
  const browser = await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
    executablePath: await chromium.executablePath(),
    headless: 'shell',
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    return Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  } finally {
    await browser.close();
  }
}

export async function gerarPdf(html: string): Promise<Buffer> {
  if (process.env.VERCEL) {
    try {
      return await pdfServerless(html);
    } catch (err: any) {
      throw new Error(`Não foi possível gerar o PDF: ${err.message}`);
    }
  }
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'orcamentofacil-pdf-'));
  try {
    const entrada = path.join(pasta, 'doc.html');
    const saida = path.join(pasta, 'doc.pdf');
    await fs.writeFile(entrada, html, 'utf8');
    await promisify(execFile)(
      navegador(),
      [
        '--headless',
        '--disable-gpu',
        '--no-pdf-header-footer',
        // Perfil próprio: sem ele o Edge reaproveita a sessão aberta do usuário e não imprime
        `--user-data-dir=${path.join(pasta, 'perfil')}`,
        `--print-to-pdf=${saida}`,
        `file:///${entrada.replace(/\\/g, '/')}`,
      ],
      { timeout: 60_000 },
    );
    return await fs.readFile(saida);
  } catch (err: any) {
    throw new Error(`Não foi possível gerar o PDF: ${err.message}`);
  } finally {
    await fs.rm(pasta, { recursive: true, force: true }).catch(() => {});
  }
}
