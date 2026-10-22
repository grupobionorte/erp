-- Forma de contratação do colaborador: CLT ou PJ. Os atuais ficam como CLT.
ALTER TABLE "colaboradores" ADD COLUMN "tipo_contrato" TEXT NOT NULL DEFAULT 'clt';
