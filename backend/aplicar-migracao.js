// Executa a migração do esquema chamando EXATAMENTE o que o servidor
// chama no boot (pool.pronto em database.js) e depois encerra o pool.
// Nada aqui é específico: a mesma lógica roda em todo start.

// database.js lê process.env direto e NÃO carrega o .env sozinho — quem faz
// isso é o server.js, na primeira linha, antes de importar o banco. Sem esta
// linha o pool cairia no localhost padrão e a conexão seria recusada.
require('dotenv').config();

const pool = require('./database');

(async () => {
  const ok = await pool.pronto;
  console.log('\n=== resultado do pool.pronto ===');
  console.log(ok ? 'esquema verificado/criado com sucesso' : 'FALHOU (o servidor subiria assim mesmo)');
  await pool.end();
  process.exit(ok ? 0 : 1);
})();
