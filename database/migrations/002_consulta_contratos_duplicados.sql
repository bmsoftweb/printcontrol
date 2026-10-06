-- PrintControl Web: a consulta "Contratos Duplicados" (consultas.id = 2 no banco antigo) usava tabela temporária
-- (DROP/CREATE TEMPORARY TABLE + DELETE), que a web recusa por segurança (Consultas só executam SELECT/WITH).
-- Mesma resposta só com SELECT; o Delphi também roda esta versão. Rodar só depois de conferir o id no banco de produção.
UPDATE consultas SET
  sql1 = 'SELECT COUNT(*) CONTAGEM, NR_SERIE, COLOR\nFROM LOCACAO_CONTRATOS A\nWHERE ATIVO = ''S'' AND ID_EMPRESA = :id_empresa\nGROUP BY NR_SERIE, COLOR\nHAVING COUNT(*) > 1\nORDER BY NR_SERIE',
  sql2 = 'SELECT A.ID, A.NR_SERIE, A.COLOR, A.ID_CLIENTE, P.NOME\nFROM LOCACAO_CONTRATOS A\nLEFT JOIN PESSOAS P ON P.ID = A.ID_CLIENTE\nWHERE A.ID_EMPRESA = :id_empresa AND A.ATIVO = ''S''\n  AND A.NR_SERIE IN (SELECT NR_SERIE FROM LOCACAO_CONTRATOS\n                                 WHERE ATIVO = ''S'' AND ID_EMPRESA = :id_empresa\n                                 GROUP BY NR_SERIE, COLOR HAVING COUNT(*) > 1)\nORDER BY A.NR_SERIE'
WHERE id = 2 AND descricao_resumida = 'Contratos Duplicados';
