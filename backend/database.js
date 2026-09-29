// Conexão com o PostgreSQL + criação/migração de TODAS as tabelas.
// Este arquivo é a única fonte da verdade do schema (o perfil.routes.js
// não é mais necessário).
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: false
  }
});

// Tudo é idempotente ("IF NOT EXISTS" / "ADD COLUMN IF NOT EXISTS"): roda em
// toda subida do servidor, em banco novo ou antigo, sem apagar nada.
// Colunas de data são TIMESTAMPTZ para não haver deslocamento de fuso entre
// o que o Postgres grava (CURRENT_TIMESTAMP) e o que o Node lê.
const COMANDOS = [
  // ---------- usuários ----------
  `CREATE TABLE IF NOT EXISTS usuarios (
     id SERIAL PRIMARY KEY,
     email VARCHAR(255) UNIQUE NOT NULL,
     senha VARCHAR(255) NOT NULL,
     nome_usuario VARCHAR(255),
     verificado BOOLEAN DEFAULT FALSE,
     eh_artista BOOLEAN DEFAULT FALSE,
     nome_artista VARCHAR(255),
     senha_redefinida_em TIMESTAMPTZ,
     bio TEXT,
     url_avatar TEXT,
     tema VARCHAR(10) DEFAULT 'dark',
     criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
   )`,
  // Bancos criados antes: o CREATE acima nunca altera tabela existente.
  'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nome_usuario VARCHAR(255)',
  'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS bio TEXT',
  'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS url_avatar TEXT',
  `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tema VARCHAR(10) DEFAULT 'dark'`,
  `UPDATE usuarios SET tema = 'dark' WHERE tema IS NULL`,

  // ---------- músicas (só metadados; os arquivos ficam no Storage) ----------
  `CREATE TABLE IF NOT EXISTS musicas (
     id SERIAL PRIMARY KEY,
     titulo VARCHAR(255) NOT NULL,
     artista VARCHAR(255) NOT NULL,
     url_audio TEXT NOT NULL,
     url_capa TEXT,
     usuario_id INTEGER REFERENCES usuarios(id),
     criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
     reproducoes INTEGER NOT NULL DEFAULT 0
   )`,
  'ALTER TABLE musicas ADD COLUMN IF NOT EXISTS reproducoes INTEGER DEFAULT 0',
  'UPDATE musicas SET reproducoes = 0 WHERE reproducoes IS NULL',
  'ALTER TABLE musicas ALTER COLUMN reproducoes SET DEFAULT 0',
  'ALTER TABLE musicas ALTER COLUMN reproducoes SET NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_musicas_usuario ON musicas(usuario_id)',
  'CREATE INDEX IF NOT EXISTS idx_musicas_ranking ON musicas(reproducoes DESC, criado_em DESC)',

  // ---------- verificações temporárias ----------
  `CREATE TABLE IF NOT EXISTS verificacoes_2fa (
     id UUID PRIMARY KEY,
     email VARCHAR(255) NOT NULL,
     senha_hash VARCHAR(255) NOT NULL,
     nome_usuario VARCHAR(255),
     codigo_hash VARCHAR(255) NOT NULL,
     tentativas INTEGER DEFAULT 0,
     criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
     expira_em TIMESTAMPTZ NOT NULL,
     ultimo_envio_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS redefinicoes_senha (
     id UUID PRIMARY KEY,
     usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
     nova_senha_hash VARCHAR(255) NOT NULL,
     codigo_hash VARCHAR(255) NOT NULL,
     tentativas INTEGER DEFAULT 0,
     criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
     expira_em TIMESTAMPTZ NOT NULL,
     ultimo_envio_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS recuperacoes_senha (
     id UUID PRIMARY KEY,
     email VARCHAR(255) NOT NULL,
     codigo_hash VARCHAR(255) NOT NULL,
     tentativas INTEGER DEFAULT 0,
     verificado BOOLEAN DEFAULT FALSE,
     criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
     expira_em TIMESTAMPTZ NOT NULL,
     ultimo_envio_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
   )`,
  'ALTER TABLE recuperacoes_senha ADD COLUMN IF NOT EXISTS verificado BOOLEAN DEFAULT FALSE',
  `CREATE TABLE IF NOT EXISTS historico_redefinicoes_senha (
     id SERIAL PRIMARY KEY,
     usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
     origem VARCHAR(20) NOT NULL,
     criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
   )`,

  // ---------- playlists ("Favoritos" é criada sob demanda, eh_favoritos = TRUE) ----------
  `CREATE TABLE IF NOT EXISTS playlists (
     id SERIAL PRIMARY KEY,
     nome VARCHAR(255) NOT NULL,
     url_capa TEXT,
     usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
     eh_favoritos BOOLEAN NOT NULL DEFAULT FALSE,
     publica BOOLEAN NOT NULL DEFAULT TRUE,
     criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
   )`,
  // Bancos antigos não tinham "publica" (era o que quebrava o GET /api/perfil).
  'ALTER TABLE playlists ADD COLUMN IF NOT EXISTS url_capa TEXT',
  'ALTER TABLE playlists ADD COLUMN IF NOT EXISTS eh_favoritos BOOLEAN DEFAULT FALSE',
  'UPDATE playlists SET eh_favoritos = FALSE WHERE eh_favoritos IS NULL',
  'ALTER TABLE playlists ADD COLUMN IF NOT EXISTS publica BOOLEAN NOT NULL DEFAULT TRUE',
  'CREATE INDEX IF NOT EXISTS idx_playlists_usuario ON playlists(usuario_id)',

  `CREATE TABLE IF NOT EXISTS playlist_musicas (
     id SERIAL PRIMARY KEY,
     playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
     musica_id INTEGER REFERENCES musicas(id) ON DELETE CASCADE,
     adicionado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
     UNIQUE(playlist_id, musica_id)
   )`,
  'CREATE INDEX IF NOT EXISTS idx_playlist_musicas_musica ON playlist_musicas(musica_id)',

  // ---------- perfil: música favorita (no máximo UMA por usuário) ----------
  `CREATE TABLE IF NOT EXISTS perfil_favorita (
     usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
     musica_id INTEGER NOT NULL REFERENCES musicas(id) ON DELETE CASCADE,
     atualizado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
   )`,

  // ---------- perfil: até 4 músicas em destaque, com ordem ----------
  `CREATE TABLE IF NOT EXISTS perfil_curtidas (
     id SERIAL PRIMARY KEY,
     usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
     musica_id INTEGER NOT NULL REFERENCES musicas(id) ON DELETE CASCADE,
     posicao SMALLINT NOT NULL,
     UNIQUE(usuario_id, musica_id)
   )`,

  // ---------- player global: estado de reprodução e fila por usuário ----------
  `CREATE TABLE IF NOT EXISTS user_player_state (
     user_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
     current_track_id INTEGER REFERENCES musicas(id) ON DELETE SET NULL,
     progress_ms INTEGER NOT NULL DEFAULT 0,
     is_playing BOOLEAN NOT NULL DEFAULT FALSE,
     queue JSONB NOT NULL DEFAULT '[]'::jsonb,
     updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS idx_user_player_state_updated ON user_player_state(updated_at DESC)`
];

// Converte colunas antigas TIMESTAMP -> TIMESTAMPTZ (só as que ainda não
// foram convertidas, então é seguro rodar sempre). O valor antigo é lido no
// fuso da sessão, que é o mesmo em que o CURRENT_TIMESTAMP o gravou.
const CONVERTER_FUSO = `
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_name::text AS tabela, column_name::text AS coluna
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND data_type = 'timestamp without time zone'
       AND (table_name::text, column_name::text) IN (VALUES
         ('usuarios','criado_em'), ('usuarios','senha_redefinida_em'),
         ('musicas','criado_em'),
         ('verificacoes_2fa','criado_em'), ('verificacoes_2fa','expira_em'), ('verificacoes_2fa','ultimo_envio_em'),
         ('redefinicoes_senha','criado_em'), ('redefinicoes_senha','expira_em'), ('redefinicoes_senha','ultimo_envio_em'),
         ('recuperacoes_senha','criado_em'), ('recuperacoes_senha','expira_em'), ('recuperacoes_senha','ultimo_envio_em'),
         ('historico_redefinicoes_senha','criado_em'),
         ('playlists','criado_em'), ('playlist_musicas','adicionado_em'),
         ('perfil_favorita','atualizado_em'))
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE current_setting(''TimeZone'')',
      r.tabela, r.coluna, r.coluna);
  END LOOP;
END $$;
`;

const criarTabelas = async () => {
  for (const comando of COMANDOS) {
    await pool.query(comando);
  }

  // Passos "extras": se falharem, o servidor sobe mesmo assim.
  try {
    await pool.query(CONVERTER_FUSO);
  } catch (erro) {
    console.warn('Aviso: não foi possível converter colunas de data para TIMESTAMPTZ:', erro.message);
  }

  try {
    // Garante uma única playlist "Favoritos" por usuário (evita corrida na criação).
    await pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_playlists_favoritos_por_usuario ON playlists(usuario_id) WHERE eh_favoritos'
    );
  } catch (erro) {
    console.warn('Aviso: índice único de Favoritos não criado (há Favoritos duplicados?):', erro.message);
  }

  console.log('Tabelas e colunas verificadas/criadas com sucesso no PostgreSQL.');
};

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 42P01 -> relação não existe; 40001 / 40P01 -> serialização / deadlock.
const ERROS_REPETIVEIS = ['42P01', '40001', '40P01'];

const criarTabelasComRetry = async ({ tentativas = 10, intervaloMs = 1000 } = {}) => {
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    try {
      await criarTabelas();
      return true;
    } catch (erro) {
      const repetivel = erro && ERROS_REPETIVEIS.includes(erro.code);
      if (!repetivel || tentativa === tentativas) {
        console.error('Erro ao criar tabelas no PostgreSQL:', erro);
        return false;
      }
      console.warn(`Banco ainda não pronto (${erro.code}). Tentativa ${tentativa}/${tentativas}.`);
      await esperar(intervaloMs);
    }
  }
  return false;
};

// O server.js aguarda esta promise antes de começar a aceitar requisições.
pool.pronto = criarTabelasComRetry();

module.exports = pool;