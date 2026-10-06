-- PrintControl Web: nível T (técnico), usado no menu do Delphi (Ordens Serviço e Consultas) mas ausente em usuarios_niveis.
INSERT INTO usuarios_niveis (id, nivel, descricao)
SELECT 'T', 'T', 'TECNICO' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM usuarios_niveis WHERE id = 'T');
