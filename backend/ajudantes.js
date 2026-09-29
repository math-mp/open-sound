// ============================================================
// ajudantes.js
//
// Funções pequenas e isoladas que são reutilizadas pelo server.js.
// NÃO é um segundo server.js: aqui mora apenas lógica sem rota,
// sem regra de negócio e sem estado. As rotas continuam todas no
// server.js.
//
// Helpers:
//   tamanhoEmCaracteres  -> conta texto como o Postgres conta
//   detectarTipoImagem   -> valida a imagem pelos bytes, não pelo MIME
//   comTravaDoUsuario    -> transação com trava de linha por usuário
//   removerArquivoDoStorage -> apaga um arquivo do bucket (melhor-esforço)
//   ehViolacaoDeChave   -> identifica erro de integridade do Postgres
// ============================================================

// ---------- contagem de caracteres ----------

// O `.length` do JavaScript conta unidades UTF-16, então um emoji conta 2
// (o par substituto) enquanto o Postgres (que conta pontos de código) conta
// 1. Espalhar as duas contagens faz o limite aceito pelo servidor divergir do
// que o usuário vê no contador do front. O spread converte em pontos de
// código, que é exatamente a unidade que o banco usa.
const tamanhoEmCaracteres = (texto) => [...texto].length;

// ---------- validação real de imagem ----------

// Formatos que o projeto aceita, por assinatura real de arquivo.
// Chaveado pelo mime detectado, e não pelo que o cliente declarou.
const TIPOS_IMAGEM = {
  'image/png': { extensao: 'png' },
  'image/jpeg': { extensao: 'jpg' },
  'image/webp': { extensao: 'webp' }
};

// O `file.mimetype` do Multer vem do cabeçalho Content-Type enviado pelo
// cliente: é uma declaração, não uma prova, e é trivial de forjar
// ("declare image/png, envie qualquer coisa"). Como o bucket do Storage é
// público, aceitar isso na confiança significaria hospedar arquivo arbitrário
// sob uma URL de imagem. Aqui a decisão é tomada pelos primeiros bytes, que
// o cliente não consegue forjar sem produzir um arquivo de verdade.
//
// Cada formato tem um cabeçalho fixo e conhecido:
//   PNG  -> 89 50 4E 47 0D 0A 1A 0A
//   JPEG -> FF D8 FF
//   WEBP -> "RIFF" .... "WEBP"
function detectarTipoImagem(buffer) {
  if (!buffer || buffer.length < 12) return null;

  const assinaturaPng = buffer.subarray(0, 8);
  if (assinaturaPng.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ...TIPOS_IMAGEM['image/png'] };
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ...TIPOS_IMAGEM['image/jpeg'] };
  }

  // Só os 4 primeiros bytes cabem no WebP; o `length < 12` acima já
  // garante que ler os bytes 8..12 é seguro.
  const ehRiff = buffer.subarray(0, 4).toString('ascii') === 'RIFF';
  const ehWebp = buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (ehRiff && ehWebp) {
    return { mime: 'image/webp', ...TIPOS_IMAGEM['image/webp'] };
  }

  return null;
}

// ---------- integridade referencial ----------

// Códigos do Postgres que o projeto encontra de verdade:
//   23503 -> violação de chave estrangeira (a linha referenciada sumiu)
//   23505 -> violação de restrição única (duplicata)
//   23514 -> violação de check
const ehViolacaoDeChave = (erro, codigos = ['23503', '23505']) =>
  Boolean(erro) && codigos.includes(erro.code);

// ---------- transação com trava de linha ----------

// Executa `trabalho` numa transação que antes TRAVA a linha do próprio usuário.
// Duas requisições do mesmo usuário passam a rodar em fila (a segunda espera a
// primeira terminar); usuários diferentes continuam totalmente paralelos.
//
// Sem isso, PUT /api/usuarios/eu/curtidas tinha uma corrida real: cada
// requisição faz DELETE da lista inteira e depois reinsere. Duas requisições
// simultâneas do MESMO usuário podiam intercalar o INSERT de uma dentro da
// lista da outra, violando o UNIQUE(usuario_id, musica_id) e devolvendo 500 —
// ou, sem violação, gravando uma lista misturada das duas.
//
// "FOR NO KEY UPDATE" em vez de "FOR UPDATE": ambos travam a linha, mas o
// primeiro NÃO conflita com o lock de FOR KEY SHARE que o próprio Postgres
// toma na linha de `usuarios` para validar a chave estrangeira quando os
// INSERTs em perfil_curtidas acontecem. "FOR UPDATE" conflitaria com essa
// validação e criaria risco de deadlock sem ganhar nada aqui, já que só a
// própria transação insere filhos.
class UsuarioInexistente extends Error {}

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

// ---------- limpeza de arquivos no Storage ----------

// Apaga um arquivo do bucket a partir da URL pública. É "melhor-esforço":
// um arquivo órfão não pode impedir a operação que chamou isso (trocar
// avatar, excluir conta/música). Retorna true se apagou, false se não havia
// caminho reconhecível ou se o Storage recusou.
async function removerArquivoDoStorage(supabase, bucket, urlPublica) {
  if (!urlPublica) return false;

  const marcador = `/storage/v1/object/public/${bucket}/`;
  const indice = urlPublica.indexOf(marcador);
  if (indice === -1) return false;

  const caminho = urlPublica.slice(indice + marcador.length);

  const { error } = await supabase.storage.from(bucket).remove([caminho]);
  if (error) {
    console.error('Não foi possível apagar o arquivo do Storage:', error);
    return false;
  }
  return true;
}

module.exports = {
  tamanhoEmCaracteres,
  detectarTipoImagem,
  TIPOS_IMAGEM,
  comTravaDoUsuario,
  UsuarioInexistente,
  removerArquivoDoStorage,
  ehViolacaoDeChave
};
