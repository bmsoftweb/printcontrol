/**
 * Monta o DocumentoNFe (entrada do gerarNFe) a partir da venda: vendas + vendas_produtos +
 * nfe_impostos_produtos (calculados pelas fórmulas) + areceber (duplicatas). É o mapeamento que estava
 * comentado no btn_gerar_XML do Delphi, com as correções: IE do destinatário tirada de pessoas.rg só
 * para pessoa jurídica, NFref com a chave da nota de origem na devolução (no Delphi era fixa de teste).
 */
import type { DocumentoNFe, ImpostoItem, ItemNFe } from './gerarNFe.js';

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const opcional = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : n(v));
const txt = (v: unknown) => String(v ?? '').trim();

export interface DadosVendaNFe {
  venda: Record<string, any>;
  operacao: Record<string, any>;
  cliente: Record<string, any>;
  itens: Record<string, any>[];
  /** nfe_impostos_produtos por id_vendas_produtos */
  impostos: Record<number, Record<string, any>>;
  parcelas: Record<string, any>[];
  /** Chaves das NF-e de origem (devolução) */
  referencias: string[];
  apelidoPlano?: string;
}

function impostoDoItem(ip: Record<string, any> | undefined): ImpostoItem {
  const i = ip || {};
  const imposto: ImpostoItem = {
    origem: n(i.icms_orig),
    cst: txt(i.icms_CST) || undefined,
    csosn: txt(i.icms_CSOSN) || undefined,
    modBC: opcional(i.icms_modBC),
    baseCalculo: opcional(i.icms_vBC),
    aliquota: opcional(i.icms_pICMS),
    valor: opcional(i.icms_vICMS),
    reducaoBC: opcional(i.icms_pRedBC) || undefined,
    modBCST: opcional(i.icms_modBCST),
    mvaST: opcional(i.icms_pMVAST) || undefined,
    reducaoBCST: opcional(i.icms_pRedBCST) || undefined,
    baseCalculoST: n(i.icms_vBCST) ? n(i.icms_vBCST) : undefined,
    aliquotaST: opcional(i.icms_pICMSST) || undefined,
    valorST: n(i.icms_vBCST) ? n(i.icms_vICMSST) : undefined,
    aliquotaFCPST: opcional(i.icms_pFCPST) || undefined,
    aliquotaCredito: opcional(i.icms_pCredSN),
    valorCredito: opcional(i.icms_vCredICMSSN),
    pis: { cst: txt(i.pis_CST) || '07', base: opcional(i.pis_vBC), aliquota: opcional(i.pis_pPIS), valor: opcional(i.pis_vPIS) },
    cofins: { cst: txt(i.cofins_CST) || '07', base: opcional(i.cofins_vBC), aliquota: opcional(i.cofins_pCOFINS), valor: opcional(i.cofins_vCOFINS) },
  };
  if (n(i.icms_vBCSTRet) || n(i.icms_vICMSSTRet)) {
    imposto.baseSTRetido = n(i.icms_vBCSTRet);
    imposto.aliquotaSTRetido = n(i.icms_pST);
    imposto.valorSubstituto = opcional(i.icms_vICMSSubstituto);
    imposto.valorSTRetido = n(i.icms_vICMSSTRet);
  }
  if (txt(i.ipi_cst)) imposto.ipi = { cst: txt(i.ipi_cst), codigoEnquadramento: txt(i.ipi_cEnq) || undefined, base: opcional(i.ipi_vBC), aliquota: opcional(i.ipi_pIPI), valor: opcional(i.ipi_vIPI) };
  if (n(i.ii_vII)) imposto.ii = { base: n(i.ii_vBC), despesasAduaneiras: n(i.ii_vDespAdu), valor: n(i.ii_vII), iof: n(i.ii_vIOF) };
  return imposto;
}

/** "2026-10-05" + "14:30" → "2026-10-05T14:30" (formato aceito por dataDoDocumento) */
function dataHora(data: unknown, hora: unknown): string | undefined {
  const d = txt(data).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return undefined;
  const h = txt(hora);
  return /^\d{2}:\d{2}$/.test(h) ? `${d}T${h}` : d;
}

export function montarDocumento(d: DadosVendaNFe): DocumentoNFe {
  const { venda: v, operacao: o, cliente: c } = d;
  const devolucao = txt(o.codigo) === 'DEV' || txt(o.tipo) === 'D';
  const doc = txt(c.cpf_cnpj).replace(/\D/g, '');
  const juridica = doc.length === 14;
  const ie = juridica ? txt(c.rg).replace(/[^\dA-Za-z]/g, '') : '';
  const indIEDest = ie && !/^ISENT/i.test(ie) ? 1 : juridica && /^ISENT/i.test(txt(c.rg)) ? 2 : 9;
  if (!txt(v.serie) || !n(v.numero)) throw new Error('A venda precisa estar finalizada (série e número) para gerar a NF-e.');
  if (!d.itens.length) throw new Error('A venda não tem itens.');

  const itens: ItemNFe[] = d.itens.map((it) => {
    const ip = d.impostos[it.id];
    const cfop = txt(ip?.cfop) || txt(it.cfop);
    if (!cfop) throw new Error(`Item ${it.item || it.id} (${txt(it.descricao)}) sem CFOP: calcule os impostos da venda.`);
    if (!txt(it.ncm)) throw new Error(`Produto ${it.id_produto} (${txt(it.descricao)}) sem NCM no cadastro.`);
    return {
      codigo: String(it.id_produto),
      ean: txt(it.cod_barra) || undefined,
      descricao: txt(it.descricao),
      ncm: txt(it.ncm),
      cest: txt(it.cest) || undefined,
      cfop,
      unidade: txt(it.un_venda) || 'UN',
      quantidade: n(it.qtdade),
      valorUnitario: n(it.preco_venda),
      valorTotal: n(it.valor_total_bruto),
      valorDesconto: n(it.valor_desconto_total) || undefined,
      valorOutros: n(it.valor_acrescimo_total) || undefined,
      informacoesAdicionais: txt(it.obs) || undefined,
      imposto: impostoDoItem(ip),
    };
  });

  const total = n(v.valor_total_liquido);
  const aPrazo = d.parcelas.length > 1 || d.parcelas.some((p) => txt(p.data_vencimento).slice(0, 10) > txt(v.data_venda).slice(0, 10));
  return {
    ide: {
      naturezaOperacao: txt(o.descricao) || txt(o.apelido) || 'VENDA',
      serie: n(v.serie),
      numero: n(v.numero),
      dataEmissao: txt(v.data_venda).slice(0, 10) || undefined,
      dataSaida: dataHora(v.data_saida, v.hora_saida),
      tipoDocumento: txt(v.es || o.es) === 'E' ? 0 : 1,
      finalidade: devolucao ? 4 : 1,
      consumidorFinal: indIEDest === 9 ? 1 : 0,
      presencial: 1,
      referencias: devolucao ? d.referencias : undefined,
    },
    destinatario: {
      cnpj: juridica ? doc : undefined,
      cpf: doc.length === 11 ? doc : undefined,
      nome: txt(c.nome),
      inscricaoEstadual: indIEDest === 1 ? ie : undefined,
      indIEDest,
      email: txt(c.email).split(/[;,\s]+/)[0] || undefined,
      endereco: {
        logradouro: txt(c.endereco),
        numero: txt(c.endereco_nr),
        complemento: txt(c.endereco_complemento),
        bairro: txt(c.endereco_bairro),
        codigoMunicipio: txt(c.endereco_cidade_ibge),
        municipio: txt(c.endereco_cidade),
        uf: txt(c.endereco_uf).toUpperCase(),
        cep: txt(c.endereco_cep),
        fone: txt(c.fone_fixo || c.fone_celular1),
      },
    },
    itens,
    transporte: { modalidadeFrete: 9 },
    cobranca:
      !devolucao && d.parcelas.length
        ? {
            numero: `${txt(v.serie)}/${txt(v.numero)}`,
            valorOriginal: total,
            duplicatas: d.parcelas.map((p, i) => ({ numero: String(i + 1).padStart(3, '0'), vencimento: txt(p.data_vencimento).slice(0, 10), valor: n(p.valor_areceber) })),
          }
        : undefined,
    pagamentos: devolucao ? [{ forma: '90' }] : [{ forma: '99', descricao: d.apelidoPlano || 'Conforme duplicatas', valor: total, indPag: aPrazo ? 1 : 0 }],
    informacoesAdicionais: { contribuinte: [txt(v.obs_fiscal), txt(c.obs_nf)].filter(Boolean).join(' - ') || undefined },
  };
}
