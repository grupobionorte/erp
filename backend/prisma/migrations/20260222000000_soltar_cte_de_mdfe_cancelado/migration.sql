-- CT-e que ficou preso a um MDF-e cancelado (excluído antes de autorizar, ou
-- cancelado na SEFAZ) aparecia com "MDF-e já gerado" e não podia ganhar
-- manifesto novo. Solta esses vínculos; dali em diante o próprio cancelamento
-- já solta.
UPDATE "documentos_fiscais" AS cte
SET "mdfe_id" = NULL
FROM "documentos_fiscais" AS mdfe
WHERE cte."mdfe_id" = mdfe."id"
  AND mdfe."tipo" = 'MDFe'
  AND mdfe."status" = 'cancelado';
