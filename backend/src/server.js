require("dotenv").config();
const express = require("express");
const cors = require("cors");

const pessoasRouter = require("./routes/pessoas");
const colaboradoresRouter = require("./routes/colaboradores");
const transportadorasRouter = require("./routes/transportadoras");
const veiculosRouter = require("./routes/veiculos");
const produtosRouter = require("./routes/produtos");
const documentosFiscaisRouter = require("./routes/documentosFiscais");
const ncmsRouter = require("./routes/ncms");
const cfopsRouter = require("./routes/cfops");
const authRouter = require("./routes/auth");
const usuariosRouter = require("./routes/usuarios");
const empresasRouter = require("./routes/empresas");
const { autenticar } = require("./middleware/auth");

const app = express();

// Em produção, só a tela publicada pode chamar essa API. Sem Origin
// (curl, Postman, chamadas de servidor pra servidor) sempre passa —
// é só o navegador que envia Origin, então isso não afeta scripts/testes.
const origensPermitidas = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || origensPermitidas.length === 0 || origensPermitidas.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origem não permitida pelo CORS"));
  },
}));
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

// /auth fica de fora da autenticação (é como se entra e como se cria o
// primeiro usuário). Tudo abaixo disso exige token válido.
app.use("/auth", authRouter);

app.use(autenticar);

// Clientes e fornecedores compartilham a rota /pessoas (use ?papel=cliente
// ou ?papel=fornecedor para filtrar) porque são a mesma entidade no banco.
app.use("/pessoas", pessoasRouter);
app.use("/colaboradores", colaboradoresRouter);
app.use("/transportadoras", transportadorasRouter);
app.use("/veiculos", veiculosRouter);
app.use("/produtos", produtosRouter);
app.use("/documentos-fiscais", documentosFiscaisRouter);
app.use("/ncms", ncmsRouter);
app.use("/cfops", cfopsRouter);
app.use("/usuarios", usuariosRouter);
app.use("/empresas", empresasRouter);

app.use((erro, req, res, next) => {
  console.error(erro);
  res.status(500).json({ erro: "Erro interno", detalhe: erro.message });
});

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => console.log(`Backend rodando em http://localhost:${PORT}`));
