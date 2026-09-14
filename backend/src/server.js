require("dotenv").config();
const express = require("express");
const cors = require("cors");

const pessoasRouter = require("./routes/pessoas");
const colaboradoresRouter = require("./routes/colaboradores");
const transportadorasRouter = require("./routes/transportadoras");
const produtosRouter = require("./routes/produtos");
const documentosFiscaisRouter = require("./routes/documentosFiscais");
const ncmsRouter = require("./routes/ncms");
const authRouter = require("./routes/auth");
const { autenticar } = require("./middleware/auth");

const app = express();

app.use(cors());
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
app.use("/produtos", produtosRouter);
app.use("/documentos-fiscais", documentosFiscaisRouter);
app.use("/ncms", ncmsRouter);

app.use((erro, req, res, next) => {
  console.error(erro);
  res.status(500).json({ erro: "Erro interno", detalhe: erro.message });
});

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => console.log(`Backend rodando em http://localhost:${PORT}`));
