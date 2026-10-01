/* Confere se as chaves VAPID cadastradas no ambiente são válidas.
   Rode no Shell do servidor:  node scripts/conferir-vapid.js */
const crypto = require("crypto");

const publica = String(process.env.VAPID_PUBLIC_KEY || "").trim();
const privada = String(process.env.VAPID_PRIVATE_KEY || "").trim();
const contato = String(process.env.VAPID_CONTATO || "").trim();

console.log(`VAPID_PUBLIC_KEY : ${publica.length} caracteres`);
console.log(`VAPID_PRIVATE_KEY: ${privada.length} caracteres`);
console.log(`VAPID_CONTATO    : ${contato || "(vazio)"}`);

if (!publica || !privada) {
  console.error("\nFaltam chaves no ambiente.");
  process.exit(1);
}

const bytes = Buffer.from(publica, "base64url");
console.log(`\nChave pública: ${bytes.length} bytes, começa com ${bytes[0]}`);

try {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPublicKey(bytes);
  console.log("Ponto na curva P-256: VÁLIDO");
} catch {
  console.error(
    "Ponto na curva P-256: INVÁLIDO\n" +
    "A chave tem o tamanho certo mas está corrompida — algum caractere foi trocado na cópia.\n" +
    "Gere o par de novo e copie DIRETO do terminal."
  );
  process.exit(1);
}

// As duas precisam ser do mesmo par: a pública derivada da privada tem que
// bater com a cadastrada.
try {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(privada, "base64url"));
  const derivada = ecdh.getPublicKey().toString("base64url");
  console.log(derivada === publica
    ? "Par de chaves: CONFEREM"
    : "Par de chaves: NÃO CONFEREM — a pública e a privada são de pares diferentes.");
} catch (e) {
  console.error("Não foi possível conferir o par:", e.message);
}

if (contato && !/^(mailto:|https?:)/i.test(contato)) {
  console.warn("\nAviso: VAPID_CONTATO deveria começar com mailto: — o sistema corrige sozinho.");
}
