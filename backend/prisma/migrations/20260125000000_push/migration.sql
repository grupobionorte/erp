-- Inscrições de notificação push, uma por aparelho.
CREATE TABLE "inscricoes_push" (
  "id"           SERIAL PRIMARY KEY,
  "endpoint"     TEXT NOT NULL UNIQUE,
  "p256dh"       TEXT NOT NULL,
  "auth"         TEXT NOT NULL,
  "aparelho"     TEXT,
  "usuario_id"   INTEGER NOT NULL REFERENCES "usuarios"("id") ON DELETE CASCADE,
  "criado_em"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ultimo_envio" TIMESTAMP(3)
);
CREATE INDEX "inscricoes_push_usuario_idx" ON "inscricoes_push"("usuario_id");
