# Leitor de PDF para Excel (Node.js)

Ferramenta web interna: a pessoa sobe um PDF, a IA lê o documento,
identifica as informações e monta uma planilha Excel. Não precisa de
modelo fixo por setor, porque quem entende a estrutura é o Claude, não
uma regra escrita à mão para cada tipo de documento.

Backend em Node.js (Express), pronto para rodar em servidor que só tem
Node, como o HomeHost.

## O que faz

Quatro destinos, à escolha do usuário na tela:

- **Planilha em branco**: a IA decide as colunas naturais do documento
  e monta um Excel do zero, para baixar.
- **Template agora**: a pessoa sobe um .xlsx, a IA encaixa os dados nas
  colunas dele e devolve preenchido para baixar.
- **Planilha do servidor (anexar)**: a planilha de destino mora no
  servidor (ou numa pasta de rede). Cada leitura anexa na próxima linha
  em branco do mesmo arquivo, sem ninguém baixar nada. É a fonte única,
  vários usuários alimentam o mesmo arquivo.
- **Meu arquivo local (gravar)**: o usuário escolhe a planilha dele no
  navegador uma vez, autoriza a gravação, e cada leitura grava de volta
  naquele arquivo sem baixar cópia. Funciona no Chrome e no Edge, com o
  site em HTTPS ou em localhost.

Nos casos com template (as três últimas opções), o casamento das
colunas ignora maiúscula, minúscula, acento e espaço extra, e as linhas
que já existiam são preservadas.

PDF digital e escaneado passam pelo mesmo caminho. A API da Anthropic
lê o PDF nativamente, processando cada página como texto e como imagem,
então não tem pipeline de OCR à parte.

Depois da leitura, a tela mostra os dados numa **tabela editável**: dá
para corrigir qualquer célula, renomear colunas, adicionar e remover
linhas. Só quando você confirma é que o arquivo é gravado, já com as
suas correções.

## Sobre os dois modos de salvar sem gerar arquivo novo

**Planilha do servidor**: registre um .xlsx de destino pela própria
tela (botão "Registrar nova") ou deixe o arquivo direto na pasta
`data/planilhas` (ou na pasta que você definir em `DATA_DIR`). O app
lê o cabeçalho dessa planilha para guiar a extração e anexa os
registros no fim. Salvamentos simultâneos no mesmo arquivo são
serializados por uma trava, então dois usuários não se sobrescrevem.

**Arquivo local**: usa a File System Access API do navegador. Por isso
só funciona em Chrome ou Edge e exige contexto seguro (HTTPS ou
`localhost`). Em HTTP puro numa rede interna o navegador bloqueia a
gravação, e nesse caso vale usar a opção de planilha do servidor, ou
publicar o app com HTTPS.

## Como funciona por dentro

1. A pessoa sobe o PDF (e, se quiser, o template).
2. `lib/extracao.js` manda o PDF para o Claude usando *tool use*, que
   força a resposta a vir em JSON estruturado (colunas + linhas).
3. A tela mostra tudo numa tabela editável para conferência e ajuste.
4. `lib/excel.js` (ExcelJS) gera o .xlsx: preenche o template ou cria
   um novo, a partir dos dados já revisados.

## Instalação

```bash
cd leitor-pdf-excel-node
npm install
cp .env.example .env      # e preencha ANTHROPIC_API_KEY
```

## Rodar

```bash
npm start
```

O app sobe em `http://localhost:8000` e escuta em `0.0.0.0`, então a
equipe acessa pelo IP do servidor na rede interna. Para trocar a porta,
ajuste `PORT` no `.env`.

### Rodar no HomeHost

O HomeHost roda o app como um processo Node. Aponte o serviço para
`server.js` (ou `npm start`) e garanta que as variáveis do `.env`
estejam no painel de ambiente do provedor. Se o HomeHost já define a
porta por variável de ambiente, o app respeita `PORT` automaticamente.

## Limites e cuidados

- **Tamanho**: a API aceita até cerca de 32 MB e 100 páginas por
  requisição. Documentos maiores precisam ser divididos antes.
- **Custo**: cada leitura é uma chamada de API paga por tokens, e PDF
  escaneado pesa mais que o digital porque entra como imagem. Vale
  medir o custo médio por documento nos setores que mais usam.
- **Segurança**: por ser interno, rode atrás da rede da empresa ou de
  um login. Os arquivos ficam numa pasta temporária no servidor;
  configure uma limpeza periódica.
- **Concorrência**: se muita gente usar ao mesmo tempo, considere uma
  fila para não estourar limites da API.

## Estrutura

```
leitor-pdf-excel-node/
  server.js          Express: rotas /extrair e /gerar
  lib/
    extracao.js      chamada ao Claude com PDF + tool use
    excel.js         gera planilha nova ou preenche template (ExcelJS)
  public/
    index.html       interface da equipe (tabela editável)
  data/
    planilhas/       planilhas de destino do servidor (ou use DATA_DIR)
  package.json
  .env.example
```
