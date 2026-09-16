/**
 * Módulo de extração.
 *
 * Envia o PDF para a API da Anthropic e recebe os dados já estruturados
 * em colunas e linhas. A leitura de PDF é nativa: cada página é
 * processada como texto e como imagem, então documento digital e
 * escaneado passam pelo mesmo caminho, sem OCR à parte.
 *
 * Dois modos:
 *   - sem template: o Claude decide quais são as colunas.
 *   - com template: você passa os cabeçalhos e ele encaixa os dados
 *     nessas colunas, deixando em branco o que não achar.
 */

const fs = require("fs");
const Anthropic = require("@anthropic-ai/sdk");

// Modelo configurável por variável de ambiente. Use um Sonnet atual,
// que lê PDF e imagem. Confira o ID vigente na doc da Anthropic.
const MODELO = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

// Limite defensivo. A API aceita até cerca de 32 MB e 100 páginas por
// requisição. Acima disso, divida o PDF antes (ver README).
const MAX_BYTES = 30 * 1024 * 1024;

const cliente = new Anthropic(); // lê ANTHROPIC_API_KEY do ambiente

// A "ferramenta" abaixo força o Claude a devolver JSON no formato que a
// gente controla, em vez de texto livre. É o jeito mais confiável de
// receber dado estruturado.
const FERRAMENTA = {
  name: "registrar_extracao",
  description:
    "Registra os dados tabulares extraídos do documento. " +
    "Toda informação relevante do documento vira uma linha.",
  input_schema: {
    type: "object",
    properties: {
      colunas: {
        type: "array",
        description:
          "Nomes das colunas, na ordem em que devem aparecer na planilha.",
        items: { type: "string" },
      },
      linhas: {
        type: "array",
        description:
          "Cada item é um registro. As chaves de cada objeto devem ser " +
          "exatamente os nomes listados em 'colunas'. Campo não " +
          "encontrado deve vir como string vazia.",
        items: { type: "object" },
      },
      observacoes: {
        type: "string",
        description:
          "Qualquer aviso útil: baixa qualidade do scan, ambiguidade " +
          "nos dados, campos que ficaram em dúvida.",
      },
    },
    required: ["colunas", "linhas"],
  },
};

function lerPdfBase64(caminhoPdf) {
  const conteudo = fs.readFileSync(caminhoPdf);
  if (conteudo.length > MAX_BYTES) {
    throw new Error(
      "PDF grande demais para uma requisição única. " +
        "Divida o arquivo em partes menores (ver README)."
    );
  }
  return conteudo.toString("base64");
}

function montarPrompt(colunasAlvo, instrucoesExtra = "") {
  let base;
  if (colunasAlvo && colunasAlvo.length) {
    const colunasTxt = colunasAlvo.map((c) => `"${c}"`).join(", ");
    base =
      "Você vai preencher uma planilha que já tem as colunas definidas: " +
      `${colunasTxt}.\n\n` +
      "Leia o documento anexado e extraia todos os registros que " +
      "encaixam nessas colunas. Use EXATAMENTE esses nomes de coluna, na " +
      "mesma ordem. Quando um dado não existir no documento, deixe o " +
      "campo como string vazia. Não invente valores e não crie colunas " +
      "novas.";
  } else {
    base =
      "Leia o documento anexado, entenda a estrutura dele e extraia as " +
      "informações em formato de tabela.\n\n" +
      "Decida quais são as colunas mais naturais para esse documento " +
      "(por exemplo: descrição do item, quantidade, valor, data, número " +
      "do processo, o que fizer sentido). Se o documento tiver uma tabela " +
      "clara, respeite as colunas dela. Cada registro vira uma linha. " +
      "Normalize datas para DD/MM/AAAA e mantenha números como número " +
      "quando possível.";
  }

  const comum =
    "\n\nSe o documento for um scan ou foto de baixa qualidade, faça o " +
    "seu melhor e registre a dúvida em 'observacoes'. Chame a ferramenta " +
    "'registrar_extracao' com o resultado.";

  return base + comum + (instrucoesExtra ? "\n\n" + instrucoesExtra : "");
}

/**
 * Extrai os dados do PDF.
 * @param {string} caminhoPdf
 * @param {string[]|null} colunasAlvo cabeçalhos quando há template; null para deixar o Claude decidir
 * @param {string} instrucoesExtra
 * @returns {Promise<{colunas:string[], linhas:object[], observacoes:string}>}
 */
async function extrair(caminhoPdf, colunasAlvo = null, instrucoesExtra = "") {
  const pdfB64 = lerPdfBase64(caminhoPdf);

  const resposta = await cliente.messages.create({
    model: MODELO,
    max_tokens: 8192,
    tools: [FERRAMENTA],
    tool_choice: { type: "tool", name: "registrar_extracao" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfB64,
            },
          },
          {
            type: "text",
            text: montarPrompt(colunasAlvo, instrucoesExtra),
          },
        ],
      },
    ],
  });

  for (const bloco of resposta.content) {
    if (bloco.type === "tool_use" && bloco.name === "registrar_extracao") {
      const dados = bloco.input || {};
      return {
        colunas: dados.colunas || colunasAlvo || [],
        linhas: dados.linhas || [],
        observacoes: dados.observacoes || "",
      };
    }
  }

  throw new Error(
    "O modelo não retornou os dados no formato esperado. " +
      "Tente de novo ou revise o documento."
  );
}

module.exports = { extrair };
