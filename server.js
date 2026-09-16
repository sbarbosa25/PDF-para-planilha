/**
 * Web app interno: sobe o PDF, o Claude extrai os dados, você revisa e
 * corrige na tela, e salva de quatro formas:
 *   - planilha em branco (baixa um arquivo novo)
 *   - template enviado na hora (baixa preenchido)
 *   - planilha do servidor (anexa no mesmo arquivo, sem baixar)
 *   - arquivo local do usuário (grava de volta pelo navegador, sem baixar)
 *
 * Rodar:
 *   npm install
 *   cp .env.example .env   (e preencha a chave)
 *   npm start
 */

require("dotenv").config();

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const extracao = require("./lib/extracao");
const excel = require("./lib/excel");

const app = express();
const PORTA = process.env.PORT || 8000;

// Pasta de trabalho por sessão (temporária).
const DIR_TRABALHO = path.join(os.tmpdir(), "leitor_pdf_excel");
fs.mkdirSync(DIR_TRABALHO, { recursive: true });

// Pasta das planilhas de destino que ficam no servidor. Pode apontar
// para uma pasta de rede que o servidor enxerga (variável DATA_DIR).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data", "planilhas");
fs.mkdirSync(DATA_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 35 * 1024 * 1024 },
});

app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.join(__dirname, "public")));

// --- Trava simples por arquivo, pra dois usuários não gravarem ao
// --- mesmo tempo na mesma planilha do servidor.
const travas = new Map();
function comTrava(chave, fn) {
  const anterior = travas.get(chave) || Promise.resolve();
  const proximo = anterior.catch(() => {}).then(fn);
  travas.set(
    chave,
    proximo.catch(() => {})
  );
  return proximo;
}

// nome de arquivo seguro (evita path traversal)
function nomeSeguro(nome) {
  return path.basename(String(nome)).replace(/[^\w.\- ]+/g, "_");
}

// ---------- Planilhas do servidor ----------

app.get("/planilhas", (req, res) => {
  try {
    const arquivos = fs
      .readdirSync(DATA_DIR)
      .filter((f) => /\.xlsx$/i.test(f))
      .sort();
    res.json({ arquivos });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.post("/planilhas", upload.single("arquivo"), (req, res) => {
  if (!req.file || !/\.xlsx$/i.test(req.file.originalname)) {
    return res.status(400).json({ erro: "Envie um arquivo .xlsx." });
  }
  const nome = nomeSeguro(req.file.originalname);
  fs.writeFileSync(path.join(DATA_DIR, nome), req.file.buffer);
  res.json({ ok: true, nome });
});

// ---------- Extração ----------

app.post(
  "/extrair",
  upload.fields([
    { name: "pdf", maxCount: 1 },
    { name: "template", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const pdf = req.files && req.files.pdf && req.files.pdf[0];
      if (!pdf || !pdf.originalname.toLowerCase().endsWith(".pdf")) {
        return res.status(400).json({ erro: "Envie um arquivo PDF." });
      }

      const sessao = crypto.randomUUID().replace(/-/g, "");
      const pasta = path.join(DIR_TRABALHO, sessao);
      fs.mkdirSync(pasta, { recursive: true });

      const caminhoPdf = path.join(pasta, "documento.pdf");
      fs.writeFileSync(caminhoPdf, pdf.buffer);

      let colunasAlvo = null;
      const destino = { tipo: "branco" }; // branco | template | servidor

      const tpl = req.files && req.files.template && req.files.template[0];
      const planilhaServidor = req.body && req.body.planilhaServidor;

      if (tpl && tpl.originalname) {
        // template enviado na hora (download) OU arquivo local (grava via navegador)
        if (!/\.(xlsx|xlsm)$/i.test(tpl.originalname)) {
          return res.status(400).json({ erro: "O template precisa ser .xlsx." });
        }
        const caminhoTemplate = path.join(pasta, "template.xlsx");
        fs.writeFileSync(caminhoTemplate, tpl.buffer);
        try {
          colunasAlvo = (await excel.lerCabecalhos(caminhoTemplate)).colunas;
        } catch (e) {
          return res.status(400).json({ erro: e.message });
        }
        destino.tipo = "template";
      } else if (planilhaServidor) {
        // planilha que já mora no servidor
        const nome = nomeSeguro(planilhaServidor);
        const caminho = path.join(DATA_DIR, nome);
        if (!fs.existsSync(caminho)) {
          return res.status(400).json({ erro: "Planilha do servidor não encontrada." });
        }
        try {
          colunasAlvo = (await excel.lerCabecalhos(caminho)).colunas;
        } catch (e) {
          return res.status(400).json({ erro: e.message });
        }
        destino.tipo = "servidor";
        destino.planilha = nome;
      }

      fs.writeFileSync(path.join(pasta, "destino.json"), JSON.stringify(destino));

      const resultado = await extracao.extrair(caminhoPdf, colunasAlvo);
      resultado.temTemplate = colunasAlvo !== null;
      resultado.destino = destino.tipo;
      resultado.sessao = sessao;
      return res.json(resultado);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ erro: "Falha na extração: " + e.message });
    }
  }
);

// ---------- Gerar arquivo para baixar (branco, template, local) ----------

app.post("/gerar", async (req, res) => {
  try {
    const { sessao, colunas, linhas } = req.body || {};
    if (!sessao || !Array.isArray(colunas) || !Array.isArray(linhas)) {
      return res.status(400).json({ erro: "Dados incompletos." });
    }

    const pasta = path.join(DIR_TRABALHO, sessao);
    if (!fs.existsSync(pasta)) {
      return res.status(404).json({ erro: "Sessão não encontrada. Refaça a leitura." });
    }

    const saida = path.join(pasta, "planilha_preenchida.xlsx");
    const caminhoTemplate = path.join(pasta, "template.xlsx");

    if (fs.existsSync(caminhoTemplate)) {
      await excel.preencherTemplate(caminhoTemplate, colunas, linhas, saida);
    } else {
      await excel.criarPlanilhaNova(colunas, linhas, saida);
    }

    return res.download(saida, "planilha_preenchida.xlsx");
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: "Falha ao gerar o Excel: " + e.message });
  }
});

// ---------- Salvar anexando na planilha do servidor ----------

app.post("/salvar-servidor", async (req, res) => {
  try {
    const { sessao, colunas, linhas } = req.body || {};
    if (!sessao || !Array.isArray(colunas) || !Array.isArray(linhas)) {
      return res.status(400).json({ erro: "Dados incompletos." });
    }

    const pasta = path.join(DIR_TRABALHO, sessao);
    const destinoPath = path.join(pasta, "destino.json");
    if (!fs.existsSync(destinoPath)) {
      return res.status(404).json({ erro: "Sessão não encontrada. Refaça a leitura." });
    }
    const destino = JSON.parse(fs.readFileSync(destinoPath, "utf-8"));
    if (destino.tipo !== "servidor" || !destino.planilha) {
      return res.status(400).json({ erro: "Esta leitura não é de uma planilha do servidor." });
    }

    const caminho = path.join(DATA_DIR, destino.planilha);
    if (!fs.existsSync(caminho)) {
      return res.status(404).json({ erro: "Planilha do servidor não encontrada." });
    }

    const resultado = await comTrava(caminho, async () => {
      const antes = await excel.contarRegistros(caminho);
      await excel.preencherTemplate(caminho, colunas, linhas, caminho); // anexa no mesmo arquivo
      const depois = await excel.contarRegistros(caminho);
      return { adicionadas: depois - antes, total: depois };
    });

    return res.json({ ok: true, arquivo: destino.planilha, ...resultado });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: "Falha ao salvar na planilha: " + e.message });
  }
});

app.listen(PORTA, "0.0.0.0", () => {
  console.log(`Leitor de PDF para Excel rodando em http://localhost:${PORTA}`);
});
