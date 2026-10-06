import { Router, Request, Response } from 'express';
import { pool } from './db.js';
import { contexto, temNivel } from './crud.js';
import { vencimentoEsperado } from '../src/modulos/locacoes/calculos.js';

/** Hoje no horário de Brasília */
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/**
 * Painel da tela Início: o que está pendente na empresa ativa. Cada bloco só vem para quem tem o nível da tela
 * correspondente (Locações/Faturamento/Financeiro = A; Ordens Serviço = T).
 */
export function createPainelRouter() {
  const router = Router();

  router.get('/painel', async (_req: Request, res: Response) => {
    try {
      const { grupoId, empresaId } = contexto(res);
      const escopo = [grupoId, empresaId];
      const painel: Record<string, unknown> = {};

      if (temNivel(res, 'A')) {
        // Leituras do mês: mesma regra da Conferência (vencimento esperado de cada contrato ativo neste mês)
        const [ano, mes, dia] = hoje().split('-').map(Number);
        const [contratos] = await pool.query<any[]>(
          `SELECT id, dia_leitura, dia_vencimento FROM locacao_contratos
            WHERE id_grupo = ? AND id_empresa = ? AND ativo = 'S' AND dia_leitura BETWEEN 1 AND 31`,
          escopo,
        );
        let pendentes = 0;
        let atrasadas = 0;
        if (contratos.length) {
          const [lidas] = await pool.query<any[]>(
            `SELECT id_contrato, data_vencimento FROM locacao_leituras
              WHERE id_contrato IN (?) AND data_vencimento >= DATE_SUB(CURDATE(), INTERVAL 70 DAY)`,
            [contratos.map((c) => c.id)],
          );
          const feitas = new Set(lidas.map((l) => `${l.id_contrato}|${String(l.data_vencimento).slice(0, 10)}`));
          for (const c of contratos) {
            const venc = vencimentoEsperado(ano, mes, Number(c.dia_leitura), Number(c.dia_vencimento));
            if (feitas.has(`${c.id}|${venc}`)) continue;
            pendentes++;
            if (Number(c.dia_leitura) <= dia) atrasadas++;
          }
        }
        painel.leituras = { contratos: contratos.length, pendentes, atrasadas };

        const [[aFaturar]] = await pool.query<any[]>(
          `SELECT COUNT(*) AS quantidade, COALESCE(SUM(L.valor_total_geral), 0) AS valor
             FROM locacao_leituras L JOIN locacao_contratos C ON C.id = L.id_contrato
            WHERE L.status_fatur = 'N' AND C.id_grupo = ? AND C.id_empresa = ?`,
          escopo,
        );
        painel.aFaturar = aFaturar;

        const [[notas]] = await pool.query<any[]>(
          `SELECT SUM(data_vencimento < CURDATE()) AS vencidas,
                  COALESCE(SUM(IF(data_vencimento < CURDATE(), total_liquido, 0)), 0) AS valor_vencidas,
                  SUM(data_vencimento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)) AS a_vencer,
                  COALESCE(SUM(IF(data_vencimento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY), total_liquido, 0)), 0) AS valor_a_vencer
             FROM fatur_notas
            WHERE id_grupo = ? AND id_empresa = ? AND status = 'A' AND COALESCE(cancelado, 'N') <> 'S'`,
          escopo,
        );
        painel.notas = {
          vencidas: Number(notas.vencidas) || 0,
          valorVencidas: notas.valor_vencidas,
          aVencer: Number(notas.a_vencer) || 0,
          valorAVencer: notas.valor_a_vencer,
        };
      }

      if (temNivel(res, 'T')) {
        const [[os]] = await pool.query<any[]>(
          `SELECT SUM(status = 'A') AS abertas, SUM(status = 'E') AS executando
             FROM os WHERE id_grupo = ? AND id_empresa = ? AND status IN ('A', 'E')`,
          escopo,
        );
        painel.os = { abertas: Number(os.abertas) || 0, executando: Number(os.executando) || 0 };
      }

      res.json(painel);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
