/* Gera o par de chaves VAPID das notificações push.
   Rode uma vez e guarde nas variáveis de ambiente do servidor:
     node scripts/gerar-vapid.js
   Trocar as chaves depois invalida todas as inscrições já feitas. */
const webpush = require("web-push");

const chaves = webpush.generateVAPIDKeys();
console.log("Cole no Render, em Environment:\n");
console.log(`VAPID_PUBLIC_KEY=${chaves.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${chaves.privateKey}`);
console.log(`VAPID_CONTATO=mailto:seu-email@bionorte.com.br`);
