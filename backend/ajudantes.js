// ajudantes.js
// Funções pequenas e reutilizáveis pelo server.js. Sem rotas e sem estado.


// ---------- Sistema de Logs de Desenvolvimento ----------
const DEBUG_LOGS = process.env.DEBUG_LOGS === 'true' || process.env.LOG_LEVEL === 'debug';

function logTimestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(prefixo, nivel, mensagem, dados = null) {
  const ts = logTimestamp();
  const saida = `[${ts}] [${prefixo}] ${mensagem}${dados ? ` ${JSON.stringify(dados)}` : ''}`;
  if (nivel === 'error') {
    console.error(saida);
  } else if (nivel === 'warn') {
    console.warn(saida);
  } else if (DEBUG_LOGS) {
    console.log(saida);
  }
}

function logInfo(prefixo, mensagem, dados = null) {
  log(prefixo, 'info', mensagem, dados);
}

function logWarn(prefixo, mensagem, dados = null) {
  log(prefixo, 'warn', mensagem, dados);
}

function logError(prefixo, mensagem, dados = null) {
  log(prefixo, 'error', mensagem, dados);
}

// ---------- erros de regra de negócio ----------
// Lançados dentro de transações; as rotas traduzem cada um para o status certo.
class UsuarioInexistente extends Error {}
class MusicaInexistente extends Error {}
class LimiteDePlaylists extends Error {}

// ---------- contagem de caracteres ----------
// `.length` conta unidades UTF-16 (emoji = 2); o Postgres conta pontos de
// código (emoji = 1). O spread converte em pontos de código.
const tamanhoEmCaracteres = (texto) => [...texto].length;

// Aceita só inteiros positivos "de verdade" (nada de "12abc", 1.5 ou "").
function paraIdValido(valor) {
  const numero = typeof valor === 'string' && /^\d+$/.test(valor) ? Number(valor) : valor;
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

// ---------- validação real de arquivos (pelos bytes, não pelo MIME) ----------

const TIPOS_IMAGEM = {
  'image/png': { extensao: 'png' },
  'image/jpeg': { extensao: 'jpg' },
  'image/webp': { extensao: 'webp' }
};

// O mimetype enviado pelo cliente é só uma declaração e é trivial de forjar.
// Como o bucket é público, decidimos pelos primeiros bytes.
function detectarTipoImagem(buffer) {
  if (!buffer || buffer.length < 12) return null;

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ...TIPOS_IMAGEM['image/png'] };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ...TIPOS_IMAGEM['image/jpeg'] };
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mime: 'image/webp', ...TIPOS_IMAGEM['image/webp'] };
  }
  return null;
}

// MP3 (com ou sem tag ID3), WAV e OGG.
function detectarTipoAudio(buffer) {
  if (!buffer || buffer.length < 12) return null;

  const inicio = buffer.subarray(0, 4).toString('ascii');
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) {
    return { mime: 'audio/mpeg', extensao: 'mp3' };
  }
  if (inicio === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') {
    return { mime: 'audio/wav', extensao: 'wav' };
  }
  if (inicio === 'OggS') {
    return { mime: 'audio/ogg', extensao: 'ogg' };
  }
  return null;
}

// ---------- integridade referencial ----------
//   23503 -> chave estrangeira (a linha referenciada sumiu)
//   23505 -> restrição única (duplicata)
const ehViolacaoDeChave = (erro, codigos = ['23503', '23505']) =>
  Boolean(erro) && codigos.includes(erro.code);

const ehMusicaSumida = (erro) =>
  erro instanceof MusicaInexistente || ehViolacaoDeChave(erro, ['23503']);

// ---------- transação com trava de linha por usuário ----------
// Requisições do MESMO usuário rodam em fila; usuários diferentes seguem em
// paralelo. FOR NO KEY UPDATE (e não FOR UPDATE) para não conflitar com o
// FOR KEY SHARE que o Postgres toma ao validar chaves estrangeiras.
async function comTravaDoUsuario(pool, usuarioId, trabalho) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const trava = await client.query(
      'SELECT id FROM usuarios WHERE id = $1 FOR NO KEY UPDATE',
      [usuarioId]
    );
    if (trava.rows.length === 0) throw new UsuarioInexistente();

    const resultado = await trabalho(client);

    await client.query('COMMIT');
    return resultado;
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}

// ---------- limpeza de arquivos no Storage (melhor-esforço) ----------

// Transforma a URL pública de volta no caminho dentro do bucket.
function extrairCaminhoNoBucket(urlPublica, bucket) {
  if (!urlPublica) return null;
  const marcador = `/storage/v1/object/public/${bucket}/`;
  const indice = urlPublica.indexOf(marcador);
  if (indice === -1) return null;
  return urlPublica.slice(indice + marcador.length);
}

// Apaga vários arquivos de uma vez. Nunca lança: um arquivo órfão não pode
// impedir a operação que chamou isto.
async function removerArquivosDoStorage(supabase, bucket, urlsPublicas) {
  const caminhos = urlsPublicas
    .map((url) => extrairCaminhoNoBucket(url, bucket))
    .filter(Boolean);

  if (caminhos.length === 0) return false;

  let tudoCerto = true;
  for (let i = 0; i < caminhos.length; i += 100) {
    const { error } = await supabase.storage.from(bucket).remove(caminhos.slice(i, i + 100));
    if (error) {
      console.error('Não foi possível apagar arquivos do Storage:', error);
      tudoCerto = false;
    }
  }
  return tudoCerto;
}

const removerArquivoDoStorage = (supabase, bucket, urlPublica) =>
  removerArquivosDoStorage(supabase, bucket, [urlPublica]);

module.exports = {
  UsuarioInexistente,
  MusicaInexistente,
  LimiteDePlaylists,
  tamanhoEmCaracteres,
  paraIdValido,
  TIPOS_IMAGEM,
  detectarTipoImagem,
  detectarTipoAudio,
  ehViolacaoDeChave,
  ehMusicaSumida,
  comTravaDoUsuario,
  extrairCaminhoNoBucket,
  removerArquivosDoStorage,
  removerArquivoDoStorage,
  logInfo,
  logWarn,
  logError,
  DEBUG_LOGS
};