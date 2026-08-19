const { Pool } = require('pg');

// Configuração de conexão com o seu servidor PostgreSQL
const pool = new Pool({
  user: 'postgres',        // Seu usuário do PostgreSQL
  host: 'localhost',       // Endereço do servidor
  database: 'opensound_db',  // Nome do banco de dados criado
  password: '1M2m3m4m5m!',   // Sua senha do PostgreSQL
  port: 5434,              // Porta padrão do PostgreSQL
});

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