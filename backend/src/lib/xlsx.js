const archiver = require("archiver");

/* ---------------------------------------------------------------------------
   Planilha Excel (.xlsx) mínima, sem biblioteca: o .xlsx é um zip de XMLs,
   e o archiver (já usado no pacote de XMLs fiscais) monta o zip. Texto vai
   inline (sem tabela de textos compartilhados), número vai como número —
   o Excel soma e formata como moeda conforme o idioma de quem abre.

   Célula: valor simples, ou { v, estilo } com estilo em ESTILOS.
--------------------------------------------------------------------------- */

// Índices de cellXfs em styles.xml (a ordem importa).
const ESTILOS = { normal: 0, negrito: 1, moeda: 2, moedaNegrito: 3, numero: 4, titulo: 5 };

const esc = (t) => String(t ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  // Caracteres de controle invalidam o XML e o Excel recusa o arquivo.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function coluna(n) {
  let s = "";
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

function celula(valor, linha, col) {
  const c = valor !== null && typeof valor === "object" ? valor : { v: valor };
  if (c.v === null || c.v === undefined || c.v === "") {
    return c.estilo ? `<c r="${coluna(col)}${linha}" s="${ESTILOS[c.estilo] || 0}"/>` : "";
  }
  const ref = `${coluna(col)}${linha}`;
  const s = ESTILOS[c.estilo] || 0;
  if (typeof c.v === "number" && Number.isFinite(c.v)) return `<c r="${ref}" s="${s}"><v>${c.v}</v></c>`;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
}

function folha({ linhas, larguras = [] }) {
  const cols = larguras.length
    ? `<cols>${larguras.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const corpo = linhas.map((cels, i) =>
    `<row r="${i + 1}">${(cels || []).map((v, j) => celula(v, i + 1, j)).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${corpo}</sheetData></worksheet>`;
}

const ESTILOS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
<fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="13"/><name val="Arial"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * Gera o .xlsx. abas: [{ nome, linhas: [[célula, ...], ...], larguras }].
 * Devolve um Buffer.
 */
function gerarXlsx(abas) {
  // Nome de aba: até 31 caracteres, sem []:*?/\ e sem repetir.
  const nomes = abas.map((a, i) => (String(a.nome || `Planilha${i + 1}`).replace(/[[\]:*?/\\]/g, " ").slice(0, 31)) || `Planilha${i + 1}`);
  const arquivos = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${nomes.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    "xl/styles.xml": ESTILOS_XML,
  };
  abas.forEach((a, i) => { arquivos[`xl/worksheets/sheet${i + 1}.xml`] = folha(a); });

  return new Promise((ok, falha) => {
    const pacote = archiver("zip", { zlib: { level: 9 } });
    const partes = [];
    pacote.on("data", (d) => partes.push(d));
    pacote.on("end", () => ok(Buffer.concat(partes)));
    pacote.on("error", falha);
    for (const [nome, conteudo] of Object.entries(arquivos)) pacote.append(conteudo, { name: nome });
    pacote.finalize();
  });
}

module.exports = { gerarXlsx };
