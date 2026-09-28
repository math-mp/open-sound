// Testa backend/perfil.routes.js de ponta a ponta contra um PostgreSQL REAL
// (cada teste ganha um schema isolado, descartado no fim). O Supabase Storage é um serviço externo, então aqui ele
// é substituído por um "duplo de teste" que guarda os arquivos num Map —
// isso existe só nos testes e não vai pro projeto.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const { criarTabelasPerfil, registrarRotasPerfil, detectarTipoImagem, LIMITES } = require('../backend/perfil.routes');

const JWT_SECRET = 'segredo-so-de-teste';
const BUCKET = 'musicas';

// ---------- fixtures binárias mínimas (assinaturas reais de cada formato) ----------
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(64, 3)]);

// ---------- Storage falso ----------
function criarStorageFalso() {
  const fake = { arquivos: new Map(), falharProximoUpload: false };
  fake.storage = {
    from: (bucket) => ({
      upload: async (caminho, buffer, opcoes) => {
        if (fake.falharProximoUpload) return { error: new Error('upload falhou de propósito') };
        fake.arquivos.set(caminho, { buffer, opcoes });
        return { error: null };
      },
      getPublicUrl: (caminho) => ({
        data: { publicUrl: `http://storage.local/storage/v1/object/public/${bucket}/${caminho}` }
      }),
      remove: async (caminhos) => {
        caminhos.forEach((c) => fake.arquivos.delete(c));
        return { error: null };
      }
    })
  };
  return fake;
}

// ---------- Postgres real, um schema isolado por teste ----------
const CONEXAO = process.env.TEST_DATABASE_URL || 'postgres://opensound_teste:teste123@127.0.0.1:5432/opensound_teste';
let contadorSchema = 0;

// Mesmas definições de usuarios/musicas do database.js do projeto.
const DDL_BASE = `
  CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    senha VARCHAR(255) NOT NULL,
    nome_usuario VARCHAR(255),
    verificado BOOLEAN DEFAULT FALSE,
    eh_artista BOOLEAN DEFAULT FALSE,
    nome_artista VARCHAR(255),
    senha_redefinida_em TIMESTAMP,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS musicas (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(255) NOT NULL,
    artista VARCHAR(255) NOT NULL,
    url_audio TEXT NOT NULL,
    url_capa TEXT,
    usuario_id INTEGER REFERENCES usuarios(id),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reproducoes INTEGER DEFAULT 0
  );
`;

async function criarSchemaIsolado() {
  const schema = `t_${process.pid}_${Date.now()}_${contadorSchema++}`;
  const admin = new Pool({ connectionString: CONEXAO, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();

  const pool = new Pool({ connectionString: CONEXAO, options: `-c search_path=${schema}`, max: 10 });
  const descartar = async () => {
    await pool.end();
    const limpeza = new Pool({ connectionString: CONEXAO, max: 1 });
    await limpeza.query(`DROP SCHEMA ${schema} CASCADE`);
    await limpeza.end();
  };
  return { pool, descartar };
}

// ---------- ambiente completo ----------
async function subirAmbiente() {
  const { pool, descartar } = await criarSchemaIsolado();
  await pool.query(DDL_BASE);
  await criarTabelasPerfil(pool);

  const supabase = criarStorageFalso();

  // Mesmo verificarAutenticacao do server.js real.
  function verificarAutenticacao(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ status: 'erro', mensagem: 'Faça login para acessar este recurso.' });
    }
    try {
      req.usuario = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
      next();
    } catch (erro) {
      return res.status(401).json({ status: 'erro', mensagem: 'Sessão inválida ou expirada. Faça login novamente.' });
    }
  }

  const app = express();
  app.use(express.json());
  registrarRotasPerfil(app, { pool, verificarAutenticacao, supabase, SUPABASE_BUCKET: BUCKET });

  const servidor = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${servidor.address().port}`;

  async function criarUsuario(email, nome) {
    const r = await pool.query(
      'INSERT INTO usuarios (email, senha, nome_usuario, verificado) VALUES ($1, $2, $3, TRUE) RETURNING id',
      [email, 'hash', nome]
    );
    const id = r.rows[0].id;
    const token = jwt.sign({ id, email }, JWT_SECRET, { expiresIn: '1h' });
    return { id, token };
  }

  async function criarMusica(titulo, artista, usuarioId, capa = null) {
    const r = await pool.query(
      'INSERT INTO musicas (titulo, artista, url_audio, url_capa, usuario_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [titulo, artista, `http://storage.local/storage/v1/object/public/${BUCKET}/audio/${titulo}.mp3`, capa, usuarioId]
    );
    return r.rows[0].id;
  }

  async function chamar(metodo, caminho, { token, json, form } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let body;
    // fetch não aceita corpo em GET/HEAD
    if (json !== undefined && metodo !== 'GET') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      body = form;
    }
    const resposta = await fetch(base + caminho, { method: metodo, headers, body });
    const corpo = await resposta.json().catch(() => null);
    return { status: resposta.status, corpo };
  }

  const fechar = async () => {
    servidor.closeAllConnections?.();
    await new Promise((resolve) => servidor.close(resolve));
    await descartar();
  };

  return { pool, supabase, servidor, chamar, criarUsuario, criarMusica, fechar };
}

function formComImagem(buffer, tipoDeclarado = 'image/png', nome = 'foto.png') {
  const form = new FormData();
  form.append('avatar', new Blob([buffer], { type: tipoDeclarado }), nome);
  return form;
}

// ============================================================
// TESTES
// ============================================================

test('migração é idempotente (roda três vezes sem erro e sem duplicar nada)', async () => {
  const amb = await subirAmbiente();
  await criarTabelasPerfil(amb.pool);
  await criarTabelasPerfil(amb.pool);
  const tabelas = await amb.pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() ORDER BY table_name`
  );
  assert.deepEqual(
    tabelas.rows.map((r) => r.table_name),
    ['musicas', 'perfil_curtidas', 'perfil_favorita', 'playlist_musicas', 'playlists', 'usuarios']
  );
  await amb.fechar();
});

test('migração recupera bancos antigos: acrescenta colunas que faltavam sem apagar dados', async () => {
  const { pool, descartar } = await criarSchemaIsolado();
  // banco "antigo": sem nome_usuario, sem reproducoes, com dados dentro
  await pool.query(`
    CREATE TABLE usuarios (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, senha VARCHAR(255) NOT NULL);
    CREATE TABLE musicas (id SERIAL PRIMARY KEY, titulo VARCHAR(255) NOT NULL, artista VARCHAR(255) NOT NULL,
                          url_audio TEXT NOT NULL, url_capa TEXT, usuario_id INTEGER REFERENCES usuarios(id));
    INSERT INTO usuarios (email, senha) VALUES ('velho@teste.com', 'hash');
    INSERT INTO musicas (titulo, artista, url_audio, usuario_id) VALUES ('Antiga', 'Alguém', 'u', 1);
  `);
  await criarTabelasPerfil(pool);
  const u = await pool.query('SELECT email, nome_usuario, bio, avatar_url FROM usuarios');
  assert.deepEqual(u.rows, [{ email: 'velho@teste.com', nome_usuario: null, bio: null, avatar_url: null }]);
  const m = await pool.query('SELECT titulo, reproducoes FROM musicas');
  assert.equal(m.rows[0].titulo, 'Antiga');
  await descartar();
});

test('migração espera as tabelas base aparecerem (corrida com o database.js)', async () => {
  const { pool, descartar } = await criarSchemaIsolado();

  const promessa = criarTabelasPerfil(pool, { tentativas: 40, intervaloMs: 50 });

  // Só depois de um tempinho as tabelas base "aparecem".
  await new Promise((r) => setTimeout(r, 300));
  await pool.query(DDL_BASE);

  await promessa; // se nunca resolvesse, o teste estouraria o timeout
  const ok = await pool.query(`SELECT to_regclass('perfil_favorita') AS t`);
  assert.ok(ok.rows[0].t);
  await descartar();
});

test('migração desiste com erro claro se as tabelas base nunca aparecem', async () => {
  const { pool, descartar } = await criarSchemaIsolado();
  await assert.rejects(criarTabelasPerfil(pool, { tentativas: 3, intervaloMs: 10 }), (erro) => erro.code === '42P01');
  await descartar();
});

test('todas as rotas exigem login (401 sem token, 401 com token inválido)', async () => {
  const amb = await subirAmbiente();
  const rotas = [
    ['GET', '/api/perfil'],
    ['PUT', '/api/perfil/bio'],
    ['POST', '/api/perfil/avatar'],
    ['DELETE', '/api/perfil/avatar'],
    ['PUT', '/api/perfil/favorita'],
    ['DELETE', '/api/perfil/favorita'],
    ['PUT', '/api/perfil/curtidas'],
    ['POST', '/api/perfil/playlists'],
    ['DELETE', '/api/perfil/playlists/1']
  ];
  for (const [metodo, caminho] of rotas) {
    const semToken = await amb.chamar(metodo, caminho, { json: {} });
    assert.equal(semToken.status, 401, `${metodo} ${caminho} sem token`);
    const tokenRuim = await amb.chamar(metodo, caminho, { token: 'lixo.lixo.lixo', json: {} });
    assert.equal(tokenRuim.status, 401, `${metodo} ${caminho} com token inválido`);
  }
  await amb.fechar();
});

test('GET /api/perfil: conta nova volta tudo vazio, sem inventar nada', async () => {
  const amb = await subirAmbiente();
  const { token } = await amb.criarUsuario('a@teste.com', 'ana');

  const { status, corpo } = await amb.chamar('GET', '/api/perfil', { token });
  assert.equal(status, 200);
  const p = corpo.perfil;
  assert.equal(p.usuario.nome_usuario, 'ana');
  assert.equal(p.usuario.bio, null);
  assert.equal(p.usuario.avatar_url, null);
  assert.equal(p.favorita, null);
  assert.deepEqual(p.curtidas, []);
  assert.deepEqual(p.playlists, []);
  assert.deepEqual(p.estatisticas, { musicas_enviadas: 0, reproducoes: 0 });
  // nunca expõe e-mail nem hash
  assert.equal('email' in p.usuario, false);
  assert.equal('senha' in p.usuario, false);
  await amb.fechar();
});

test('GET /api/perfil: token válido de conta apagada -> 404', async () => {
  const amb = await subirAmbiente();
  const { id, token } = await amb.criarUsuario('a@teste.com', 'ana');
  await amb.pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
  const { status } = await amb.chamar('GET', '/api/perfil', { token });
  assert.equal(status, 404);
  await amb.fechar();
});

test('bio: salva, apara espaços, normaliza CRLF, apaga com vazio, recusa longa e tipo errado', async () => {
  const amb = await subirAmbiente();
  const { token } = await amb.criarUsuario('a@teste.com', 'ana');

  let r = await amb.chamar('PUT', '/api/perfil/bio', { token, json: { bio: '  oi\r\nmundo  ' } });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.bio, 'oi\nmundo');

  r = await amb.chamar('GET', '/api/perfil', { token });
  assert.equal(r.corpo.perfil.usuario.bio, 'oi\nmundo');

  r = await amb.chamar('PUT', '/api/perfil/bio', { token, json: { bio: '   ' } });
  assert.equal(r.corpo.bio, null);

  r = await amb.chamar('PUT', '/api/perfil/bio', { token, json: { bio: null } });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.bio, null);

  // exatamente no limite passa; um a mais não
  r = await amb.chamar('PUT', '/api/perfil/bio', { token, json: { bio: 'x'.repeat(LIMITES.BIO_MAX) } });
  assert.equal(r.status, 200);
  r = await amb.chamar('PUT', '/api/perfil/bio', { token, json: { bio: 'x'.repeat(LIMITES.BIO_MAX + 1) } });
  assert.equal(r.status, 400);

  // emoji conta 1 caractere (como no Postgres), não 2 (como no JS)
  r = await amb.chamar('PUT', '/api/perfil/bio', { token, json: { bio: '🎧'.repeat(LIMITES.BIO_MAX) } });
  assert.equal(r.status, 200);

  for (const invalido of [123, { a: 1 }, ['x'], true]) {
    r = await amb.chamar('PUT', '/api/perfil/bio', { token, json: { bio: invalido } });
    assert.equal(r.status, 400, `bio=${JSON.stringify(invalido)}`);
  }
  r = await amb.chamar('PUT', '/api/perfil/bio', { token, json: {} });
  assert.equal(r.status, 400);
  await amb.fechar();
});

test('bio guarda texto perigoso como texto (sem interpretar)', async () => {
  const amb = await subirAmbiente();
  const { token } = await amb.criarUsuario('a@teste.com', 'ana');
  const perigo = `<img src=x onerror=alert(1)>'; DROP TABLE usuarios; --`;
  await amb.chamar('PUT', '/api/perfil/bio', { token, json: { bio: perigo } });
  const r = await amb.chamar('GET', '/api/perfil', { token });
  assert.equal(r.corpo.perfil.usuario.bio, perigo);
  // a tabela continua lá
  const t = await amb.pool.query('SELECT COUNT(*) AS n FROM usuarios');
  assert.equal(Number(t.rows[0].n), 1);
  await amb.fechar();
});

test('favorita: define, troca (upsert), lê no perfil, remove; recusa inexistente e id inválido', async () => {
  const amb = await subirAmbiente();
  const { id, token } = await amb.criarUsuario('a@teste.com', 'ana');
  const m1 = await amb.criarMusica('Um', 'Banda', id, 'http://c/1.png');
  const m2 = await amb.criarMusica('Dois', 'Banda', id);

  let r = await amb.chamar('PUT', '/api/perfil/favorita', { token, json: { musicaId: m1 } });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.favorita.titulo, 'Um');
  assert.deepEqual(Object.keys(r.corpo.favorita).sort(), ['artista', 'id', 'titulo', 'url_audio', 'url_capa']);

  r = await amb.chamar('PUT', '/api/perfil/favorita', { token, json: { musicaId: m2 } });
  assert.equal(r.corpo.favorita.titulo, 'Dois');
  const linhas = await amb.pool.query('SELECT COUNT(*) AS n FROM perfil_favorita WHERE usuario_id = $1', [id]);
  assert.equal(Number(linhas.rows[0].n), 1, 'troca não pode criar 2 linhas');

  r = await amb.chamar('GET', '/api/perfil', { token });
  assert.equal(r.corpo.perfil.favorita.id, m2);

  assert.equal((await amb.chamar('PUT', '/api/perfil/favorita', { token, json: { musicaId: 99999 } })).status, 404);
  for (const ruim of [undefined, null, 0, -1, 1.5, 'abc', '12abc', [], {}]) {
    const x = await amb.chamar('PUT', '/api/perfil/favorita', { token, json: { musicaId: ruim } });
    assert.equal(x.status, 400, `musicaId=${JSON.stringify(ruim)}`);
  }

  r = await amb.chamar('DELETE', '/api/perfil/favorita', { token });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.favorita, null);
  r = await amb.chamar('GET', '/api/perfil', { token });
  assert.equal(r.corpo.perfil.favorita, null);
  await amb.fechar();
});

test('curtidas: guarda a ordem, substitui a lista, esvazia; recusa 5, repetidas, inexistentes e inválidas', async () => {
  const amb = await subirAmbiente();
  const { id, token } = await amb.criarUsuario('a@teste.com', 'ana');
  const ids = [];
  for (let i = 1; i <= 6; i++) ids.push(await amb.criarMusica(`M${i}`, 'Banda', id));

  let r = await amb.chamar('PUT', '/api/perfil/curtidas', { token, json: { musicaIds: [ids[2], ids[0], ids[3], ids[1]] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.curtidas.map((m) => m.titulo), ['M3', 'M1', 'M4', 'M2']);

  r = await amb.chamar('PUT', '/api/perfil/curtidas', { token, json: { musicaIds: [ids[5]] } });
  assert.deepEqual(r.corpo.curtidas.map((m) => m.titulo), ['M6']);

  r = await amb.chamar('GET', '/api/perfil', { token });
  assert.deepEqual(r.corpo.perfil.curtidas.map((m) => m.titulo), ['M6']);

  assert.equal((await amb.chamar('PUT', '/api/perfil/curtidas', { token, json: { musicaIds: ids.slice(0, 5) } })).status, 400);
  assert.equal((await amb.chamar('PUT', '/api/perfil/curtidas', { token, json: { musicaIds: [ids[0], ids[0]] } })).status, 400);
  assert.equal((await amb.chamar('PUT', '/api/perfil/curtidas', { token, json: { musicaIds: [ids[0], 99999] } })).status, 404);
  assert.equal((await amb.chamar('PUT', '/api/perfil/curtidas', { token, json: { musicaIds: ['x'] } })).status, 400);
  assert.equal((await amb.chamar('PUT', '/api/perfil/curtidas', { token, json: { musicaIds: 'nao-lista' } })).status, 400);
  assert.equal((await amb.chamar('PUT', '/api/perfil/curtidas', { token, json: {} })).status, 400);

  // as tentativas inválidas não podem ter alterado a lista salva
  r = await amb.chamar('GET', '/api/perfil', { token });
  assert.deepEqual(r.corpo.perfil.curtidas.map((m) => m.titulo), ['M6']);

  r = await amb.chamar('PUT', '/api/perfil/curtidas', { token, json: { musicaIds: [] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.curtidas, []);
  await amb.fechar();
});

test('playlists: cria, lista com contagem real de faixas, limite por usuário, exclusão', async () => {
  const amb = await subirAmbiente();
  const { id, token } = await amb.criarUsuario('a@teste.com', 'ana');
  const m1 = await amb.criarMusica('Um', 'Banda', id);
  const m2 = await amb.criarMusica('Dois', 'Banda', id);

  let r = await amb.chamar('POST', '/api/perfil/playlists', { token, json: { nome: '  madrugada   chill  ' } });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.playlist.nome, 'madrugada chill');
  assert.equal(r.corpo.playlist.total_faixas, 0);
  const idPl = r.corpo.playlist.id;

  // a contagem vem do banco (linhas em playlist_musicas), não de um número fixo
  await amb.pool.query('INSERT INTO playlist_musicas (playlist_id, musica_id, posicao) VALUES ($1, $2, 0), ($1, $3, 1)', [idPl, m1, m2]);
  // uma playlist privada não aparece no perfil
  await amb.pool.query('INSERT INTO playlists (usuario_id, nome, publica) VALUES ($1, $2, FALSE)', [id, 'secreta']);

  r = await amb.chamar('GET', '/api/perfil', { token });
  assert.equal(r.corpo.perfil.playlists.length, 1);
  assert.equal(r.corpo.perfil.playlists[0].nome, 'madrugada chill');
  assert.equal(r.corpo.perfil.playlists[0].total_faixas, 2);

  for (const ruim of [undefined, null, '', '   ', 5, {}, 'x'.repeat(LIMITES.PLAYLIST_NOME_MAX + 1)]) {
    const x = await amb.chamar('POST', '/api/perfil/playlists', { token, json: { nome: ruim } });
    assert.equal(x.status, 400, `nome=${JSON.stringify(ruim)}`);
  }
  assert.equal((await amb.chamar('POST', '/api/perfil/playlists', { token, json: { nome: 'x'.repeat(LIMITES.PLAYLIST_NOME_MAX) } })).status, 201);

  // enche até o limite (já existem 2 públicas + 1 privada = 3 no banco)
  for (let i = 0; i < LIMITES.PLAYLISTS_MAX_POR_USUARIO - 3; i++) {
    const x = await amb.chamar('POST', '/api/perfil/playlists', { token, json: { nome: `p${i}` } });
    assert.equal(x.status, 201, `criação ${i}`);
  }
  r = await amb.chamar('POST', '/api/perfil/playlists', { token, json: { nome: 'a mais' } });
  assert.equal(r.status, 409);

  r = await amb.chamar('DELETE', `/api/perfil/playlists/${idPl}`, { token });
  assert.equal(r.status, 200);
  const sobras = await amb.pool.query('SELECT COUNT(*) AS n FROM playlist_musicas WHERE playlist_id = $1', [idPl]);
  assert.equal(Number(sobras.rows[0].n), 0, 'apagar a playlist apaga as faixas dela (cascade)');

  assert.equal((await amb.chamar('DELETE', `/api/perfil/playlists/${idPl}`, { token })).status, 404);
  assert.equal((await amb.chamar('DELETE', '/api/perfil/playlists/abc', { token })).status, 400);
  await amb.fechar();
});

test('isolamento: um usuário não enxerga nem mexe nos dados do outro', async () => {
  const amb = await subirAmbiente();
  const a = await amb.criarUsuario('a@teste.com', 'ana');
  const b = await amb.criarUsuario('b@teste.com', 'beto');
  const musica = await amb.criarMusica('Um', 'Banda', a.id);

  await amb.chamar('PUT', '/api/perfil/bio', { token: a.token, json: { bio: 'bio da ana' } });
  await amb.chamar('PUT', '/api/perfil/favorita', { token: a.token, json: { musicaId: musica } });
  await amb.chamar('PUT', '/api/perfil/curtidas', { token: a.token, json: { musicaIds: [musica] } });
  const pl = await amb.chamar('POST', '/api/perfil/playlists', { token: a.token, json: { nome: 'da ana' } });

  const perfilB = (await amb.chamar('GET', '/api/perfil', { token: b.token })).corpo.perfil;
  assert.equal(perfilB.usuario.nome_usuario, 'beto');
  assert.equal(perfilB.usuario.bio, null);
  assert.equal(perfilB.favorita, null);
  assert.deepEqual(perfilB.curtidas, []);
  assert.deepEqual(perfilB.playlists, []);

  // beto tenta apagar a playlist da ana
  assert.equal((await amb.chamar('DELETE', `/api/perfil/playlists/${pl.corpo.playlist.id}`, { token: b.token })).status, 404);
  const aindaExiste = (await amb.chamar('GET', '/api/perfil', { token: a.token })).corpo.perfil.playlists;
  assert.equal(aindaExiste.length, 1);

  // beto tenta se passar pela ana mandando usuario_id no corpo: é ignorado
  await amb.chamar('PUT', '/api/perfil/bio', { token: b.token, json: { bio: 'bio do beto', usuario_id: a.id, id: a.id } });
  const ana = (await amb.chamar('GET', '/api/perfil', { token: a.token })).corpo.perfil;
  assert.equal(ana.usuario.bio, 'bio da ana');
  await amb.fechar();
});

test('estatísticas de artista vêm da soma real das músicas dele', async () => {
  const amb = await subirAmbiente();
  const { id, token } = await amb.criarUsuario('a@teste.com', 'ana');
  const outro = await amb.criarUsuario('b@teste.com', 'beto');
  const m1 = await amb.criarMusica('Um', 'Ana', id);
  const m2 = await amb.criarMusica('Dois', 'Ana', id);
  await amb.criarMusica('Alheia', 'Beto', outro.id);
  await amb.pool.query('UPDATE musicas SET reproducoes = 7 WHERE id = $1', [m1]);
  await amb.pool.query('UPDATE musicas SET reproducoes = 5 WHERE id = $1', [m2]);

  const r = await amb.chamar('GET', '/api/perfil', { token });
  assert.deepEqual(r.corpo.perfil.estatisticas, { musicas_enviadas: 2, reproducoes: 12 });
  await amb.fechar();
});

test('avatar: PNG/JPEG/WEBP sobem; troca apaga o arquivo antigo; remover limpa banco e bucket', async () => {
  const amb = await subirAmbiente();
  const { id, token } = await amb.criarUsuario('a@teste.com', 'ana');

  let r = await amb.chamar('POST', '/api/perfil/avatar', { token, form: formComImagem(PNG) });
  assert.equal(r.status, 200);
  const url1 = r.corpo.avatar_url;
  assert.match(url1, new RegExp(`/avatares/${id}-\\d+\\.png$`));
  assert.equal(amb.supabase.arquivos.size, 1);
  const [primeiroCaminho, primeiro] = [...amb.supabase.arquivos.entries()][0];
  assert.equal(primeiro.opcoes.contentType, 'image/png');

  // troca por JPEG: o PNG antigo sai do bucket
  await new Promise((res) => setTimeout(res, 5));
  r = await amb.chamar('POST', '/api/perfil/avatar', { token, form: formComImagem(JPG, 'image/jpeg', 'x.jpg') });
  assert.equal(r.status, 200);
  assert.equal(amb.supabase.arquivos.size, 1, 'não pode acumular avatares antigos');
  assert.equal(amb.supabase.arquivos.has(primeiroCaminho), false);

  r = await amb.chamar('GET', '/api/perfil', { token });
  assert.match(r.corpo.perfil.usuario.avatar_url, /\.jpg$/);

  await new Promise((res) => setTimeout(res, 5));
  r = await amb.chamar('POST', '/api/perfil/avatar', { token, form: formComImagem(WEBP, 'image/webp', 'x.webp') });
  assert.equal(r.status, 200);
  assert.match(r.corpo.avatar_url, /\.webp$/);

  r = await amb.chamar('DELETE', '/api/perfil/avatar', { token });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.avatar_url, null);
  assert.equal(amb.supabase.arquivos.size, 0);
  r = await amb.chamar('GET', '/api/perfil', { token });
  assert.equal(r.corpo.perfil.usuario.avatar_url, null);
  await amb.fechar();
});

test('avatar: recusa arquivo que só finge ser imagem, sem arquivo, grande demais e falha do Storage', async () => {
  const amb = await subirAmbiente();
  const { token } = await amb.criarUsuario('a@teste.com', 'ana');

  // texto declarado como image/png (mimetype falsificado)
  let r = await amb.chamar('POST', '/api/perfil/avatar', { token, form: formComImagem(Buffer.from('isto nao e uma imagem de verdade'), 'image/png') });
  assert.equal(r.status, 400);
  // GIF de verdade (formato fora da lista)
  r = await amb.chamar('POST', '/api/perfil/avatar', { token, form: formComImagem(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(64)]), 'image/gif', 'x.gif') });
  assert.equal(r.status, 400);
  // sem arquivo nenhum
  r = await amb.chamar('POST', '/api/perfil/avatar', { token, form: new FormData() });
  assert.equal(r.status, 400);
  // campo com nome errado
  const form = new FormData();
  form.append('foto', new Blob([PNG], { type: 'image/png' }), 'x.png');
  r = await amb.chamar('POST', '/api/perfil/avatar', { token, form });
  assert.equal(r.status, 400);
  // grande demais (PNG válido no começo, mas 2MB + 1)
  const grande = Buffer.concat([PNG, Buffer.alloc(LIMITES.AVATAR_MAX_BYTES, 9)]);
  r = await amb.chamar('POST', '/api/perfil/avatar', { token, form: formComImagem(grande) });
  assert.equal(r.status, 413);
  assert.equal(amb.supabase.arquivos.size, 0, 'nada disso pode ter ido pro bucket');

  // Storage fora do ar: erro limpo e o avatar antigo não é afetado
  await amb.chamar('POST', '/api/perfil/avatar', { token, form: formComImagem(PNG) });
  const antes = (await amb.chamar('GET', '/api/perfil', { token })).corpo.perfil.usuario.avatar_url;
  amb.supabase.falharProximoUpload = true;
  await new Promise((res) => setTimeout(res, 5));
  r = await amb.chamar('POST', '/api/perfil/avatar', { token, form: formComImagem(JPG, 'image/jpeg', 'x.jpg') });
  assert.equal(r.status, 500);
  amb.supabase.falharProximoUpload = false;
  const depois = (await amb.chamar('GET', '/api/perfil', { token })).corpo.perfil.usuario.avatar_url;
  assert.equal(depois, antes);
  assert.equal(amb.supabase.arquivos.size, 1);
  await amb.fechar();
});

test('avatar: se o banco falha depois do upload, o arquivo é desfeito (sem órfão)', async () => {
  const amb = await subirAmbiente();
  const { token } = await amb.criarUsuario('a@teste.com', 'ana');

  // Faz o UPDATE de avatar falhar de propósito.
  const queryOriginal = amb.pool.query.bind(amb.pool);
  amb.pool.query = (sql, ...resto) => {
    if (typeof sql === 'string' && sql.startsWith('UPDATE usuarios SET avatar_url = $1')) {
      return Promise.reject(new Error('banco caiu'));
    }
    return queryOriginal(sql, ...resto);
  };

  const r = await amb.chamar('POST', '/api/perfil/avatar', { token, form: formComImagem(PNG) });
  assert.equal(r.status, 500);
  assert.equal(amb.supabase.arquivos.size, 0, 'upload precisa ter sido revertido');
  await amb.fechar();
});

test('cascade: apagar música limpa favorita/curtidas/playlists de todo mundo, e apagar conta não trava', async () => {
  const amb = await subirAmbiente();
  const a = await amb.criarUsuario('a@teste.com', 'ana');
  const b = await amb.criarUsuario('b@teste.com', 'beto');
  const m1 = await amb.criarMusica('Um', 'Ana', a.id);
  const m2 = await amb.criarMusica('Dois', 'Ana', a.id);

  await amb.chamar('PUT', '/api/perfil/favorita', { token: b.token, json: { musicaId: m1 } });
  await amb.chamar('PUT', '/api/perfil/curtidas', { token: b.token, json: { musicaIds: [m1, m2] } });
  const pl = await amb.chamar('POST', '/api/perfil/playlists', { token: b.token, json: { nome: 'do beto' } });
  await amb.pool.query('INSERT INTO playlist_musicas (playlist_id, musica_id) VALUES ($1, $2)', [pl.corpo.playlist.id, m1]);

  // o mesmo DELETE que a rota DELETE /api/musicas/:id do server.js faz
  await amb.pool.query('DELETE FROM musicas WHERE id = $1', [m1]);

  const perfilB = (await amb.chamar('GET', '/api/perfil', { token: b.token })).corpo.perfil;
  assert.equal(perfilB.favorita, null);
  assert.deepEqual(perfilB.curtidas.map((m) => m.titulo), ['Dois']);
  assert.equal(perfilB.playlists[0].total_faixas, 0);

  // a mesma sequência da rota DELETE /api/usuarios/eu do server.js:
  // apaga as músicas do usuário e depois o usuário
  await amb.chamar('PUT', '/api/perfil/favorita', { token: a.token, json: { musicaId: m2 } });
  await amb.chamar('POST', '/api/perfil/playlists', { token: a.token, json: { nome: 'da ana' } });
  const conexao = await amb.pool.connect();
  await conexao.query('BEGIN');
  await conexao.query('DELETE FROM musicas WHERE usuario_id = $1', [a.id]);
  await conexao.query('DELETE FROM usuarios WHERE id = $1', [a.id]);
  await conexao.query('COMMIT');
  conexao.release();

  for (const tabela of ['perfil_favorita', 'perfil_curtidas', 'playlists']) {
    const restam = await amb.pool.query(`SELECT COUNT(*) AS n FROM ${tabela} WHERE usuario_id = $1`, [a.id]);
    assert.equal(Number(restam.rows[0].n), 0, tabela);
  }
  await amb.fechar();
});

test('detectarTipoImagem reconhece cada formato e rejeita o resto', () => {
  assert.equal(detectarTipoImagem(PNG).extensao, 'png');
  assert.equal(detectarTipoImagem(JPG).extensao, 'jpg');
  assert.equal(detectarTipoImagem(WEBP).extensao, 'webp');
  assert.equal(detectarTipoImagem(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(detectarTipoImagem(Buffer.alloc(0)), null);
  assert.equal(detectarTipoImagem(null), null);
  // RIFF que não é WEBP (ex.: WAV)
  assert.equal(detectarTipoImagem(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(8)])), null);
});

test('concorrência: várias trocas simultâneas de curtidas não dão erro e não misturam listas', async () => {
  const amb = await subirAmbiente();
  const { id, token } = await amb.criarUsuario('a@teste.com', 'ana');
  const ids = [];
  for (let i = 1; i <= 8; i++) ids.push(await amb.criarMusica(`M${i}`, 'Banda', id));

  const listas = [
    [ids[0], ids[1], ids[2], ids[3]],
    [ids[4], ids[5], ids[6], ids[7]],
    [ids[0], ids[4]],
    [ids[7], ids[1], ids[5]]
  ];
  const disparos = [];
  for (let rodada = 0; rodada < 6; rodada++) {
    for (const lista of listas) {
      disparos.push(amb.chamar('PUT', '/api/perfil/curtidas', { token, json: { musicaIds: lista } }));
    }
  }
  const respostas = await Promise.all(disparos);
  assert.deepEqual([...new Set(respostas.map((r) => r.status))], [200], 'nenhuma requisição pode falhar');

  const final = (await amb.chamar('GET', '/api/perfil', { token })).corpo.perfil.curtidas.map((m) => m.id);
  const casaComAlguma = listas.some((l) => JSON.stringify(l) === JSON.stringify(final));
  assert.ok(casaComAlguma, `lista final ${JSON.stringify(final)} não é nenhuma das enviadas (mistura de duas)`);
  await amb.fechar();
});

test('concorrência: favoritar a mesma música várias vezes ao mesmo tempo mantém uma linha só', async () => {
  const amb = await subirAmbiente();
  const { id, token } = await amb.criarUsuario('a@teste.com', 'ana');
  const m = await amb.criarMusica('Um', 'Banda', id);
  const respostas = await Promise.all(
    Array.from({ length: 15 }, () => amb.chamar('PUT', '/api/perfil/favorita', { token, json: { musicaId: m } }))
  );
  assert.deepEqual([...new Set(respostas.map((r) => r.status))], [200]);
  const n = await amb.pool.query('SELECT COUNT(*) AS n FROM perfil_favorita WHERE usuario_id = $1', [id]);
  assert.equal(Number(n.rows[0].n), 1);
  await amb.fechar();
});

test('concorrência: criar playlists em paralelo não passa do limite por usuário', async () => {
  const amb = await subirAmbiente();
  const { id, token } = await amb.criarUsuario('a@teste.com', 'ana');
  const respostas = await Promise.all(
    Array.from({ length: LIMITES.PLAYLISTS_MAX_POR_USUARIO + 10 }, (_, i) =>
      amb.chamar('POST', '/api/perfil/playlists', { token, json: { nome: `p${i}` } }))
  );
  const criadas = respostas.filter((r) => r.status === 201).length;
  const n = await amb.pool.query('SELECT COUNT(*) AS n FROM playlists WHERE usuario_id = $1', [id]);
  assert.equal(Number(n.rows[0].n), criadas);
  assert.ok(criadas <= LIMITES.PLAYLISTS_MAX_POR_USUARIO, `criou ${criadas}, o limite é ${LIMITES.PLAYLISTS_MAX_POR_USUARIO}`);
  await amb.fechar();
});