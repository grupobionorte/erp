// Envolve uma rota assíncrona: se a Promise rejeitar (erro do Prisma,
// bug, o que for), a exceção vai pro handler de erro do Express via
// next(err) em vez de virar uma "unhandled rejection" — que no Node 24
// derruba o processo inteiro (foi isso que tirou o backend do ar).
module.exports = function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
