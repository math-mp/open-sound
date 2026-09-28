// Configuração de conexão com o seu servidor PostgreSQL
const { Pool } = require('pg');

//usa as variaveis da env e configura a conexão com o bd
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

module.exports = pool;

// Criação das tabelas se não existirem
const criarTabelas = async () => {
  const queryUsuarios = `
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
  `;

  // NOVO: tabela de músicas. Guarda só metadados + URLs — o arquivo de
  // áudio/capa em si fica no Supabase Storage, nunca no Postgres.
  const queryMusicas = `
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

  // MIGRAÇÃO LEVE — a coluna `reproducoes` foi adicionada depois que a
  // tabela já existia em vários bancos. Como o CREATE TABLE acima é
  // "IF NOT EXISTS", ele NUNCA altera uma tabela que já está lá: quem já
  // tem o banco criado continuaria sem a coluna. O ALTER abaixo é o que
  // resolve isso sem apagar nada — ADD COLUMN IF NOT EXISTS só acrescenta
  // a coluna quando ela falta, preservando todas as músicas e o id de cada
  // uma. É seguro rodar toda vez que o servidor sobe.
  const queryColunaReproducoes = `
    ALTER TABLE musicas
    ADD COLUMN IF NOT EXISTS reproducoes INTEGER DEFAULT 0;
  `;

  // Segurança extra: a coluna é nulável, e somar em cima de NULL continua
  // NULL (viraria um "reproducoes = null" que o ranking não entenderia).
  // Esta query garante que nenhuma música fique sem valor.
  const queryNormalizarReproducoes = `
    UPDATE musicas SET reproducoes = 0 WHERE reproducoes IS NULL;
  `;

  // Tabela para armazenar verificações 2FA temporárias (cadastro)
  // Substitui o uso de JWT temporário para não expor dados sensíveis já que o math deixou eles no JWT 
  const queryVerificacoes2FA = `
    CREATE TABLE IF NOT EXISTS verificacoes_2fa (
      id UUID PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      senha_hash VARCHAR(255) NOT NULL,
      nome_usuario VARCHAR(255),
      codigo_hash VARCHAR(255) NOT NULL,
      tentativas INTEGER DEFAULT 0,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expira_em TIMESTAMP NOT NULL,
      ultimo_envio_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
      // redefine a senha
  const queryRedefinicoesSenha = `
    CREATE TABLE IF NOT EXISTS redefinicoes_senha (
      id UUID PRIMARY KEY,
      usuario_id INTEGER REFERENCES usuarios(id),
      nova_senha_hash VARCHAR(255) NOT NULL,
      codigo_hash VARCHAR(255) NOT NULL,
      tentativas INTEGER DEFAULT 0,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expira_em TIMESTAMP NOT NULL,
      ultimo_envio_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Playlists do usuário. "Favoritos" é criada sob demanda pelo servidor
  // e marcada com eh_favoritos = TRUE.
  const queryPlaylists = `
    CREATE TABLE IF NOT EXISTS playlists (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(255) NOT NULL,
      url_capa TEXT,
      usuario_id INTEGER REFERENCES usuarios(id),
      eh_favoritos BOOLEAN DEFAULT FALSE,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Junção playlist <-> música. UNIQUE evita duplicar a mesma música.
  const queryPlaylistMusicas = `
    CREATE TABLE IF NOT EXISTS playlist_musicas (
      id SERIAL PRIMARY KEY,
      playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
      musica_id INTEGER REFERENCES musicas(id) ON DELETE CASCADE,
      adicionado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(playlist_id, musica_id)
    );
  `;

  // NOVO: verificações temporárias de RECUPERAÇÃO de senha (esqueci minha senha)
  // Mesmo padrão da verificacoes_2fa: código hasheado, expira em 10min,
  // mas para usuários JÁ CADASTRADOS que esqueceram a senha (sem login).
  const queryRecuperacoesSenha = `
    CREATE TABLE IF NOT EXISTS recuperacoes_senha (
      id UUID PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      codigo_hash VARCHAR(255) NOT NULL,
      tentativas INTEGER DEFAULT 0,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expira_em TIMESTAMP NOT NULL,
      ultimo_envio_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    await pool.query(queryUsuarios);
    await pool.query(queryMusicas);
    await pool.query(queryVerificacoes2FA);   
    await pool.query(queryRecuperacoesSenha);
    await pool.query(queryPlaylists);
    await pool.query(queryPlaylistMusicas);

    // Migrações depois do CREATE: garantimos que a tabela musicas existe
    // antes de mexer nas colunas dela.
    await pool.query(queryColunaReproducoes);
    await pool.query(queryNormalizarReproducoes);

    console.log('Tabelas "usuarios", "musicas", "verificacoes_2fa", "redefinicoes_senha" e "recuperacoes_senha" verificadas/criadas com sucesso no PostgreSQL.');
    console.log('Coluna "musicas.reproducoes" verificada/criada com sucesso no PostgreSQL.');
  } catch (erro) {
    console.error('Erro ao criar tabelas no PostgreSQL:', erro);
  }
};

criarTabelas();