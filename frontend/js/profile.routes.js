// ============================================================
// perfil.routes.js
//
// Tudo que a página de perfil precisa do banco, num arquivo só, pra
// entrar no server.js sem mexer nas rotas que já existem:
//
//   const { criarTabelasPerfil, registrarRotasPerfil } = require('./perfil.routes');
//   ...
//   registrarRotasPerfil(app, { pool, verificarAutenticacao, supabase, SUPABASE_BUCKET });
//   criarTabelasPerfil(pool).catch((erro) => console.error('Perfil:', erro));
//
// (o registrarRotasPerfil vai ANTES do app.use((erro, req, res, next) => ...)
//  final do server.js, pra o tratador de erros continuar sendo o último)
//
// Rotas (todas exigem login, mesmo padrão "Authorization: Bearer <token>"):
//   GET    /api/perfil                 -> perfil completo numa resposta só
//   PUT    /api/perfil/bio             -> { bio }
//   POST   /api/perfil/avatar          -> multipart, campo "avatar"
//   DELETE /api/perfil/avatar
//   PUT    /api/perfil/favorita        -> { musicaId }
//   DELETE /api/perfil/favorita
//   PUT    /api/perfil/curtidas        -> { musicaIds: [até 4 ids, em ordem] }
//   POST   /api/perfil/playlists       -> { nome }
//   DELETE /api/perfil/playlists/:id
//
// O usuário SEMPRE vem do token (req.usuario.id), nunca do corpo da
// requisição: ninguém consegue editar o perfil de outra pessoa.
// ============================================================

const multer = require('multer');
const rateLimit = require('express-rate-limit');

// ---------- limites de negócio (o front espelha esses mesmos números) ----------
const BIO_MAX = 220;
const CURTIDAS_MAX = 4;
const PLAYLIST_NOME_MAX = 60;
const PLAYLISTS_MAX_POR_USUARIO = 20;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

// Colunas de música que o perfil devolve. Propositalmente SEM usuario_id
// e SEM reproducoes: o perfil não precisa disso (e usuario_id sequencial
// exposto facilita enumerar contas).
const COLUNAS_MUSICA = 'm.id, m.titulo, m.artista, m.url_audio, m.url_capa';

// ============================================================
// MIGRAÇÃO
// ============================================================

// Tudo é "IF NOT EXISTS" / "ADD COLUMN IF NOT EXISTS": pode rodar em toda
// subida do servidor, em banco novo ou antigo, sem apagar nada.
//
// As chaves estrangeiras usam ON DELETE CASCADE de propósito: a rota que
// exclui conta (DELETE /api/usuarios/eu) e a que exclui música
// (DELETE /api/musicas/:id) continuam funcionando sem nenhuma alteração —
// o banco limpa favorita/curtidas/playlists sozinho, em vez de estourar
// erro de foreign key.
const COMANDOS_MIGRACAO = [
  // Colunas novas do perfil
  'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS bio VARCHAR(220)',
  'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS avatar_url TEXT',

  // Colunas que o perfil LÊ e que já deveriam existir (o database.js só
  // cria elas no CREATE TABLE; bancos criados antes nunca ganharam o
  // ALTER, principalmente porque o boot do database.js aborta antes).
  'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nome_usuario VARCHAR(255)',
  'ALTER TABLE musicas ADD COLUMN IF NOT EXISTS reproducoes INTEGER DEFAULT 0',

  // Música favorita: no máximo UMA por usuário (a PK já garante isso)
  `CREATE TABLE IF NOT EXISTS perfil_favorita (
     usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
     musica_id INTEGER NOT NULL REFERENCES musicas(id) ON DELETE CASCADE,
     atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   )`,

  // Músicas curtidas em destaque: até 4, com ordem (posicao)
  `CREATE TABLE IF NOT EXISTS perfil_curtidas (
     usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
     musica_id INTEGER NOT NULL REFERENCES musicas(id) ON DELETE CASCADE,
     posicao SMALLINT NOT NULL,
     criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (usuario_id, musica_id)
   )`,

  // Playlists. "publica" já existe pensando na futura página de playlists:
  // o perfil só lista as públicas.
  `CREATE TABLE IF NOT EXISTS playlists (
     id SERIAL PRIMARY KEY,
     usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
     nome VARCHAR(60) NOT NULL,
     publica BOOLEAN NOT NULL DEFAULT TRUE,
     criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS playlist_musicas (
     playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
     musica_id INTEGER NOT NULL REFERENCES musicas(id) ON DELETE CASCADE,
     posicao INTEGER NOT NULL DEFAULT 0,
     adicionada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (playlist_id, musica_id)
   )`
];

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// O database.js dispara o CREATE TABLE das tabelas base sem "await" ao ser
// importado. Se este módulo rodar antes disso terminar, "usuarios" ou
// "musicas" ainda não existem (erro 42P01 = tabela inexistente). Em vez de
// depender de ordem de boot, tenta de novo por até ~30s.
async function criarTabelasPerfil(pool, { tentativas = 30, intervaloMs = 1000 } = {}) {
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    try {
      for (const comando of COMANDOS_MIGRACAO) {
        await pool.query(comando);
      }
      console.log('Tabelas do perfil (favorita, curtidas, playlists) e colunas bio/avatar_url verificadas com sucesso.');
      return;
    } catch (erro) {
      const tabelaBaseAindaNaoExiste = erro && erro.code === '42P01';
      if (!tabelaBaseAindaNaoExiste || tentativa === tentativas) throw erro;
      await esperar(intervaloMs);
    }
  }
}

// ============================================================
// HELPERS
// ============================================================

// Conta "caracteres" do jeito do Postgres (pontos de código Unicode), não
// do jeito do JavaScript (unidades UTF-16, onde um emoji conta 2). Sem
// isso, uma bio de 220 emojis passaria no JS mas o comprimento real de
// VARCHAR(220) seria diferente do que o usuário vê no contador.
const tamanhoEmCaracteres = (texto) => [...texto].length;

// Identifica o tipo REAL da imagem pelos primeiros bytes do arquivo.
// O "mimetype" que o navegador manda é só uma declaração e pode ser
// falsificado; como o bucket é público, não queremos hospedar um arquivo
// qualquer só porque ele se declarou "image/png".
function detectarTipoImagem(buffer) {
  if (!buffer || buffer.length < 12) return null;

  const ehPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (ehPng) return { mime: 'image/png', extensao: 'png' };

  const ehJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (ehJpeg) return { mime: 'image/jpeg', extensao: 'jpg' };

  const ehWebp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
                 buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (ehWebp) return { mime: 'image/webp', extensao: 'webp' };

  return null;
}

// Inverso de getPublicUrl: transforma a URL pública de volta no caminho
// dentro do bucket (mesma lógica do extrairCaminhoStorage do server.js).
function caminhoNoBucket(urlPublica, bucket) {
  if (!urlPublica) return null;
  const marcador = `/storage/v1/object/public/${bucket}/`;
  const indice = urlPublica.indexOf(marcador);
  if (indice === -1) return null;
  return urlPublica.slice(indice + marcador.length);
}

// Aceita só inteiros positivos "de verdade" (nada de "12abc", 1.5 ou "").
function paraIdValido(valor) {
  const numero = typeof valor === 'string' && /^\d+$/.test(valor) ? Number(valor) : valor;
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

// Erros de regra de negócio lançados de dentro das transações; as rotas
// traduzem cada um para o status HTTP certo.
class UsuarioInexistente extends Error {}
class MusicaInexistente extends Error {}
class LimiteDePlaylists extends Error {}

// Roda "trabalho" dentro de uma transação que antes TRAVA a linha do próprio
// usuário. Duas requisições do mesmo usuário nunca rodam ao mesmo tempo
// (a segunda espera a primeira terminar); requisições de usuários
// diferentes continuam totalmente paralelas.
//
// Sem isso, dois casos reais falhavam nos testes contra Postgres:
//  - trocar as curtidas duas vezes seguidas (DELETE + INSERT de uma
//    atropelava o da outra e estourava a chave primária, gerando erro 500);
//  - o "conta quantas playlists tem, se couber, cria" deixava passar do
//    limite quando várias criações chegavam juntas.
//
// FOR NO KEY UPDATE (e não FOR UPDATE) porque ele não bloqueia as
// checagens de chave estrangeira que os INSERTs dos filhos fazem nessa
// mesma linha.
async function comTravaDoUsuario(pool, usuarioId, trabalho) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const trava = await client.query('SELECT id FROM usuarios WHERE id = $1 FOR NO KEY UPDATE', [usuarioId]);
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

// 23503 = violação de chave estrangeira: a música foi apagada por outra
// pessoa entre a checagem e o INSERT.
const ehMusicaSumida = (erro) => erro instanceof MusicaInexistente || (erro && erro.code === '23503');

// ============================================================
// ROTAS
// ============================================================

function registrarRotasPerfil(app, { pool, verificarAutenticacao, supabase, SUPABASE_BUCKET }) {
  const erro400 = (res, mensagem) => res.status(400).json({ status: 'erro', mensagem });
  const erro500 = (res, contexto, erro) => {
    console.error(`Erro em ${contexto}:`, erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  };

  // ---------- leituras reaproveitadas por várias rotas ----------

  async function lerFavorita(executor, usuarioId) {
    const resultado = await executor.query(
      `SELECT ${COLUNAS_MUSICA}
         FROM perfil_favorita f
         JOIN musicas m ON m.id = f.musica_id
        WHERE f.usuario_id = $1`,
      [usuarioId]
    );
    return resultado.rows[0] || null;
  }

  async function lerCurtidas(executor, usuarioId) {
    const resultado = await executor.query(
      `SELECT ${COLUNAS_MUSICA}
         FROM perfil_curtidas c
         JOIN musicas m ON m.id = c.musica_id
        WHERE c.usuario_id = $1
        ORDER BY c.posicao ASC`,
      [usuarioId]
    );
    return resultado.rows;
  }

  // ---------- GET /api/perfil ----------
  app.get('/api/perfil', verificarAutenticacao, async (req, res) => {
    const usuarioId = req.usuario.id;

    try {
      const usuarioQuery = pool.query(
        `SELECT id, nome_usuario, eh_artista, nome_artista, bio, avatar_url, criado_em
           FROM usuarios WHERE id = $1`,
        [usuarioId]
      );
      const playlistsQuery = pool.query(
        `SELECT p.id, p.nome, p.criado_em,
                CAST(COUNT(pm.musica_id) AS INTEGER) AS total_faixas
           FROM playlists p
           LEFT JOIN playlist_musicas pm ON pm.playlist_id = p.id
          WHERE p.usuario_id = $1 AND p.publica = TRUE
          GROUP BY p.id, p.nome, p.criado_em
          ORDER BY p.criado_em DESC, p.id DESC`,
        [usuarioId]
      );
      const estatisticasQuery = pool.query(
        `SELECT CAST(COUNT(*) AS INTEGER) AS musicas_enviadas,
                CAST(COALESCE(SUM(reproducoes), 0) AS INTEGER) AS reproducoes
           FROM musicas WHERE usuario_id = $1`,
        [usuarioId]
      );

      const [usuarioRes, favorita, curtidas, playlistsRes, estatisticasRes] = await Promise.all([
        usuarioQuery,
        lerFavorita(pool, usuarioId),
        lerCurtidas(pool, usuarioId),
        playlistsQuery,
        estatisticasQuery
      ]);

      const usuario = usuarioRes.rows[0];
      if (!usuario) {
        // Token válido de uma conta que já foi excluída.
        return res.status(404).json({ status: 'erro', mensagem: 'Usuário não encontrado.' });
      }

      return res.status(200).json({
        status: 'sucesso',
        perfil: {
          usuario,
          favorita,
          curtidas,
          playlists: playlistsRes.rows,
          estatisticas: estatisticasRes.rows[0]
        }
      });
    } catch (erro) {
      return erro500(res, 'GET /api/perfil', erro);
    }
  });

  // ---------- PUT /api/perfil/bio ----------
  app.put('/api/perfil/bio', verificarAutenticacao, async (req, res) => {
    const { bio } = req.body || {};

    if (bio !== null && typeof bio !== 'string') {
      return erro400(res, 'A bio precisa ser um texto.');
    }

    // Normaliza quebra de linha do Windows e apara as pontas. Texto vazio
    // vira NULL (bio "apagada"), não uma string vazia.
    const limpa = bio === null ? '' : bio.replace(/\r\n/g, '\n').trim();

    if (tamanhoEmCaracteres(limpa) > BIO_MAX) {
      return erro400(res, `A bio pode ter no máximo ${BIO_MAX} caracteres.`);
    }

    try {
      const resultado = await pool.query(
        'UPDATE usuarios SET bio = $1 WHERE id = $2 RETURNING bio',
        [limpa === '' ? null : limpa, req.usuario.id]
      );

      if (resultado.rows.length === 0) {
        return res.status(404).json({ status: 'erro', mensagem: 'Usuário não encontrado.' });
      }
      return res.status(200).json({ status: 'sucesso', bio: resultado.rows[0].bio });
    } catch (erro) {
      return erro500(res, 'PUT /api/perfil/bio', erro);
    }
  });

  // ---------- AVATAR ----------

  const uploadAvatar = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: AVATAR_MAX_BYTES, files: 1 }
  });

  const limitarAvatarIP = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 30,
    message: { status: 'erro', mensagem: 'Muitas trocas de avatar a partir deste IP. Tente novamente mais tarde.' },
    standardHeaders: true,
    legacyHeaders: false
  });

  // Traduz os erros do multer pra JSON em português (sem isso o cliente
  // receberia "File too large" cru do tratador de erros genérico).
  function receberAvatar(req, res, next) {
    uploadAvatar.single('avatar')(req, res, (erro) => {
      if (!erro) return next();
      if (erro instanceof multer.MulterError && erro.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          status: 'erro',
          mensagem: `A imagem passa de ${AVATAR_MAX_BYTES / (1024 * 1024)} MB. Escolha uma menor.`
        });
      }
      return erro400(res, 'Não foi possível ler o arquivo enviado.');
    });
  }

  async function removerDoBucket(urlPublica) {
    const caminho = caminhoNoBucket(urlPublica, SUPABASE_BUCKET);
    if (!caminho) return;
    // Limpeza é melhor-esforço (mesmo padrão das exclusões do server.js):
    // um arquivo órfão não pode travar a troca de avatar.
    const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove([caminho]);
    if (error) console.error('Não deu pra apagar arquivo antigo do Storage:', error);
  }

  app.post('/api/perfil/avatar', verificarAutenticacao, limitarAvatarIP, receberAvatar, async (req, res) => {
    const arquivo = req.file;
    if (!arquivo) return erro400(res, 'Envie uma imagem no campo "avatar".');

    const tipo = detectarTipoImagem(arquivo.buffer);
    if (!tipo) return erro400(res, 'Formato não suportado. Use JPEG, PNG ou WEBP.');

    const usuarioId = req.usuario.id;
    const caminhoNovo = `avatares/${usuarioId}-${Date.now()}.${tipo.extensao}`;

    try {
      const anterior = await pool.query('SELECT avatar_url FROM usuarios WHERE id = $1', [usuarioId]);
      if (anterior.rows.length === 0) {
        return res.status(404).json({ status: 'erro', mensagem: 'Usuário não encontrado.' });
      }
      const urlAnterior = anterior.rows[0].avatar_url;

      const { error: erroUpload } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(caminhoNovo, arquivo.buffer, { contentType: tipo.mime, cacheControl: '3600' });

      if (erroUpload) {
        console.error('Erro ao subir avatar pro Storage:', erroUpload);
        return res.status(500).json({ status: 'erro', mensagem: 'Falha ao enviar a imagem.' });
      }

      const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(caminhoNovo);
      const urlNova = data.publicUrl;

      try {
        await pool.query('UPDATE usuarios SET avatar_url = $1 WHERE id = $2', [urlNova, usuarioId]);
      } catch (erroBanco) {
        // O arquivo já subiu mas o banco não registrou: desfaz o upload
        // pra não deixar imagem órfã no bucket (é o buraco que o upload
        // de música ainda tem).
        await removerDoBucket(urlNova);
        throw erroBanco;
      }

      if (urlAnterior && urlAnterior !== urlNova) await removerDoBucket(urlAnterior);

      return res.status(200).json({ status: 'sucesso', avatar_url: urlNova });
    } catch (erro) {
      return erro500(res, 'POST /api/perfil/avatar', erro);
    }
  });

  app.delete('/api/perfil/avatar', verificarAutenticacao, async (req, res) => {
    try {
      const anterior = await pool.query('SELECT avatar_url FROM usuarios WHERE id = $1', [req.usuario.id]);
      if (anterior.rows.length === 0) {
        return res.status(404).json({ status: 'erro', mensagem: 'Usuário não encontrado.' });
      }

      await pool.query('UPDATE usuarios SET avatar_url = NULL WHERE id = $1', [req.usuario.id]);
      await removerDoBucket(anterior.rows[0].avatar_url);

      return res.status(200).json({ status: 'sucesso', avatar_url: null });
    } catch (erro) {
      return erro500(res, 'DELETE /api/perfil/avatar', erro);
    }
  });

  // ---------- FAVORITA ----------

  app.put('/api/perfil/favorita', verificarAutenticacao, async (req, res) => {
    const musicaId = paraIdValido((req.body || {}).musicaId);
    if (!musicaId) return erro400(res, 'Escolha uma música válida.');

    try {
      const existe = await pool.query('SELECT id FROM musicas WHERE id = $1', [musicaId]);
      if (existe.rows.length === 0) {
        return res.status(404).json({ status: 'erro', mensagem: 'Música não encontrada.' });
      }

      // Upsert: primeira vez insere, das próximas troca a música.
      await pool.query(
        `INSERT INTO perfil_favorita (usuario_id, musica_id)
         VALUES ($1, $2)
         ON CONFLICT (usuario_id)
         DO UPDATE SET musica_id = EXCLUDED.musica_id, atualizado_em = CURRENT_TIMESTAMP`,
        [req.usuario.id, musicaId]
      );

      return res.status(200).json({ status: 'sucesso', favorita: await lerFavorita(pool, req.usuario.id) });
    } catch (erro) {
      if (ehMusicaSumida(erro)) return res.status(404).json({ status: 'erro', mensagem: 'Música não encontrada.' });
      return erro500(res, 'PUT /api/perfil/favorita', erro);
    }
  });

  app.delete('/api/perfil/favorita', verificarAutenticacao, async (req, res) => {
    try {
      await pool.query('DELETE FROM perfil_favorita WHERE usuario_id = $1', [req.usuario.id]);
      return res.status(200).json({ status: 'sucesso', favorita: null });
    } catch (erro) {
      return erro500(res, 'DELETE /api/perfil/favorita', erro);
    }
  });

  // ---------- CURTIDAS (lista inteira substituída de uma vez) ----------

  app.put('/api/perfil/curtidas', verificarAutenticacao, async (req, res) => {
    const { musicaIds } = req.body || {};

    if (!Array.isArray(musicaIds)) return erro400(res, 'Envie a lista de músicas em "musicaIds".');
    if (musicaIds.length > CURTIDAS_MAX) return erro400(res, `Você pode destacar no máximo ${CURTIDAS_MAX} músicas.`);

    const ids = musicaIds.map(paraIdValido);
    if (ids.some((id) => id === null)) return erro400(res, 'A lista tem um id de música inválido.');
    if (new Set(ids).size !== ids.length) return erro400(res, 'A lista tem músicas repetidas.');

    try {
      const curtidas = await comTravaDoUsuario(pool, req.usuario.id, async (client) => {
        if (ids.length > 0) {
          const marcadores = ids.map((_, i) => `$${i + 1}`).join(', ');
          const existentes = await client.query(`SELECT id FROM musicas WHERE id IN (${marcadores})`, ids);
          if (existentes.rows.length !== ids.length) throw new MusicaInexistente();
        }

        // Tudo ou nada: a transação (aberta em comTravaDoUsuario) garante
        // que uma falha no meio não deixa metade da lista antiga e metade
        // da nova.
        await client.query('DELETE FROM perfil_curtidas WHERE usuario_id = $1', [req.usuario.id]);
        for (let posicao = 0; posicao < ids.length; posicao++) {
          await client.query(
            'INSERT INTO perfil_curtidas (usuario_id, musica_id, posicao) VALUES ($1, $2, $3)',
            [req.usuario.id, ids[posicao], posicao]
          );
        }
        return lerCurtidas(client, req.usuario.id);
      });

      return res.status(200).json({ status: 'sucesso', curtidas });
    } catch (erro) {
      if (erro instanceof UsuarioInexistente) return res.status(404).json({ status: 'erro', mensagem: 'Usuário não encontrado.' });
      if (ehMusicaSumida(erro)) return res.status(404).json({ status: 'erro', mensagem: 'Alguma das músicas não existe mais.' });
      return erro500(res, 'PUT /api/perfil/curtidas', erro);
    }
  });

  // ---------- PLAYLISTS ----------

  app.post('/api/perfil/playlists', verificarAutenticacao, async (req, res) => {
    const { nome } = req.body || {};
    if (typeof nome !== 'string') return erro400(res, 'Dê um nome para a playlist.');

    const limpo = nome.trim().replace(/\s+/g, ' ');
    if (limpo === '') return erro400(res, 'Dê um nome para a playlist.');
    if (tamanhoEmCaracteres(limpo) > PLAYLIST_NOME_MAX) {
      return erro400(res, `O nome pode ter no máximo ${PLAYLIST_NOME_MAX} caracteres.`);
    }

    try {
      const criada = await comTravaDoUsuario(pool, req.usuario.id, async (client) => {
        const total = await client.query(
          'SELECT CAST(COUNT(*) AS INTEGER) AS total FROM playlists WHERE usuario_id = $1',
          [req.usuario.id]
        );
        if (total.rows[0].total >= PLAYLISTS_MAX_POR_USUARIO) throw new LimiteDePlaylists();

        const resultado = await client.query(
          `INSERT INTO playlists (usuario_id, nome, publica)
           VALUES ($1, $2, TRUE)
           RETURNING id, nome, criado_em`,
          [req.usuario.id, limpo]
        );
        return resultado.rows[0];
      });

      return res.status(201).json({ status: 'sucesso', playlist: { ...criada, total_faixas: 0 } });
    } catch (erro) {
      if (erro instanceof UsuarioInexistente) return res.status(404).json({ status: 'erro', mensagem: 'Usuário não encontrado.' });
      if (erro instanceof LimiteDePlaylists) {
        return res.status(409).json({
          status: 'erro',
          mensagem: `Você já tem ${PLAYLISTS_MAX_POR_USUARIO} playlists. Exclua uma antes de criar outra.`
        });
      }
      return erro500(res, 'POST /api/perfil/playlists', erro);
    }
  });

  app.delete('/api/perfil/playlists/:id', verificarAutenticacao, async (req, res) => {
    const playlistId = paraIdValido(req.params.id);
    if (!playlistId) return erro400(res, 'Playlist inválida.');

    try {
      // "AND usuario_id" garante que só o dono apaga. Se a playlist é de
      // outra pessoa, a resposta é a mesma de "não existe": não revela
      // que o id pertence a alguém.
      const resultado = await pool.query(
        'DELETE FROM playlists WHERE id = $1 AND usuario_id = $2 RETURNING id',
        [playlistId, req.usuario.id]
      );

      if (resultado.rows.length === 0) {
        return res.status(404).json({ status: 'erro', mensagem: 'Playlist não encontrada.' });
      }
      return res.status(200).json({ status: 'sucesso', id: playlistId });
    } catch (erro) {
      return erro500(res, 'DELETE /api/perfil/playlists/:id', erro);
    }
  });
}

module.exports = {
  criarTabelasPerfil,
  registrarRotasPerfil,
  // exportados só pra teste
  detectarTipoImagem,
  caminhoNoBucket,
  LIMITES: { BIO_MAX, CURTIDAS_MAX, PLAYLIST_NOME_MAX, PLAYLISTS_MAX_POR_USUARIO, AVATAR_MAX_BYTES }
};