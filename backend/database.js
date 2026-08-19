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

// Criação da tabela de usuários se não existir
const criarTabela = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      senha VARCHAR(255) NOT NULL,
      codigo_2fa VARCHAR(10),
      verificado BOOLEAN DEFAULT FALSE,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    await pool.query(queryText);
    console.log('Tabela "usuarios" verificada/criada com sucesso no PostgreSQL.');
  } catch (erro) {
    console.error('Erro ao criar tabela no PostgreSQL:', erro);
  }
};

criarTabela();

module.exports = pool;