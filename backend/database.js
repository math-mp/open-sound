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
      verificado BOOLEAN DEFAULT FALSE,
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
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Tabela para armazenar verificações 2FA temporárias (cadastro)
  // Substitui o uso de JWT temporário para não expor dados sensíveis já que o math deixou eles no JWT 
  const queryVerificacoes2FA = `
    CREATE TABLE IF NOT EXISTS verificacoes_2fa (
      id UUID PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      senha_hash VARCHAR(255) NOT NULL,
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
    console.log('Tabelas "usuarios", "musicas" e "verificacoes_2fa" verificadas/criadas com sucesso no PostgreSQL.');
  } catch (erro) {
    console.error('Erro ao criar tabelas no PostgreSQL:', erro);
  }
};

criarTabelas();

module.exports = pool;