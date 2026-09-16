/**
 * Geração da planilha com ExcelJS.
 *
 *   - criarPlanilhaNova: monta um Excel do zero, cabeçalho em negrito e
 *     largura de coluna ajustada.
 *   - preencherTemplate: abre o Excel do usuário, acha a linha de
 *     cabeçalho e escreve os registros embaixo, mapeando por nome de
 *     coluna, preservando formatação, fórmulas e demais abas.
 */

const ExcelJS = require("exceljs");

// Uma célula do ExcelJS pode vir como objeto (texto rico, fórmula com
// resultado, hyperlink). Isto normaliza tudo para texto.
function valorTexto(v) {
  if (v == null) return "";
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((p) => p.text).join("");
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v.hyperlink != null) return String(v.hyperlink);
    return "";
  }
  return String(v);
}

// Normaliza um nome de coluna para comparação tolerante: tira acento,
// caixa e espaço extra. Assim "Razão Social", "razao social" e
// "RAZÃO  SOCIAL" viram a mesma chave.
function normalizar(s) {
  return String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function acharCabecalho(ws) {
  const limite = Math.min(10, ws.rowCount || 10);
  for (let r = 1; r <= limite; r++) {
    const row = ws.getRow(r);
    const total = Math.max(ws.columnCount, row.cellCount, 1);
    const vals = [];
    for (let c = 1; c <= total; c++) {
      vals.push(valorTexto(row.getCell(c).value).trim());
    }
    if (vals.filter((v) => v !== "").length >= 2) {
      while (vals.length && vals[vals.length - 1] === "") vals.pop();
      return { colunas: vals, linhaCabecalho: r };
    }
  }
  throw new Error(
    "Não encontrei uma linha de cabeçalho clara no template. " +
      "Confira se a planilha tem os nomes das colunas no topo."
  );
}

async function lerCabecalhos(caminhoTemplate) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminhoTemplate);
  return acharCabecalho(wb.worksheets[0]);
}

function estilizarCabecalho(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function ajustarLarguras(ws) {
  ws.columns.forEach((col) => {
    let maior = 10;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = valorTexto(cell.value).length;
      if (len > maior) maior = len;
    });
    col.width = Math.min(maior + 2, 60);
  });
}

async function criarPlanilhaNova(colunas, linhas, caminhoSaida) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Dados");

  ws.addRow(colunas);
  for (const linha of linhas) {
    ws.addRow(colunas.map((c) => (linha[c] != null ? linha[c] : "")));
  }

  estilizarCabecalho(ws.getRow(1));
  ajustarLarguras(ws);
  ws.views = [{ state: "frozen", ySplit: 1 }];

  await wb.xlsx.writeFile(caminhoSaida);
  return caminhoSaida;
}

async function preencherTemplate(caminhoTemplate, colunas, linhas, caminhoSaida) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminhoTemplate);
  const ws = wb.worksheets[0];

  const { linhaCabecalho } = acharCabecalho(ws);

  // mapa: nome da coluna -> índice da coluna na planilha
  const mapa = {};
  const rowCab = ws.getRow(linhaCabecalho);
  const total = Math.max(ws.columnCount, rowCab.cellCount, 1);
  for (let c = 1; c <= total; c++) {
    const nome = valorTexto(rowCab.getCell(c).value).trim();
    if (nome !== "") mapa[normalizar(nome)] = c;
  }

  // primeira linha vazia depois dos dados existentes
  let proxima = linhaCabecalho + 1;
  const temConteudo = (r) => {
    const row = ws.getRow(r);
    for (const c of Object.values(mapa)) {
      if (valorTexto(row.getCell(c).value).trim() !== "") return true;
    }
    return false;
  };
  while (temConteudo(proxima)) proxima++;

  for (const linha of linhas) {
    const row = ws.getRow(proxima);
    for (const [nomeColuna, valor] of Object.entries(linha)) {
      const colIdx = mapa[normalizar(nomeColuna)];
      if (colIdx) row.getCell(colIdx).value = valor === "" ? null : valor;
    }
    row.commit && row.commit();
    proxima++;
  }

  await wb.xlsx.writeFile(caminhoSaida);
  return caminhoSaida;
}

// Conta quantas linhas de dados (fora o cabeçalho) já existem no arquivo.
async function contarRegistros(caminho) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);
  const ws = wb.worksheets[0];
  const { linhaCabecalho } = acharCabecalho(ws);

  const rowCab = ws.getRow(linhaCabecalho);
  const total = Math.max(ws.columnCount, rowCab.cellCount, 1);
  const cols = [];
  for (let c = 1; c <= total; c++) {
    if (valorTexto(rowCab.getCell(c).value).trim() !== "") cols.push(c);
  }

  let n = 0;
  for (let r = linhaCabecalho + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (cols.some((c) => valorTexto(row.getCell(c).value).trim() !== "")) n++;
  }
  return n;
}

module.exports = {
  criarPlanilhaNova,
  lerCabecalhos,
  preencherTemplate,
  contarRegistros,
};
