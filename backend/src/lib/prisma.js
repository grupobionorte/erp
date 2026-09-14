const { PrismaClient } = require("@prisma/client");

// Instância única compartilhada por toda a aplicação — evita abrir uma
// conexão nova com o banco a cada requisição.
const prisma = new PrismaClient();

module.exports = prisma;
