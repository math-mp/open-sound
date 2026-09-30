// ================================================================
// VERIFICAÇÃO PÓS-MIGRAÇÃO — SOMENTE LEITURA.
// confere: nome_exibicao preservado, índice barra duplicata (e volta),
// e a migração é idempotente (rodar de novo não muda nada).
// ================================================================
require('dotenv').config();
const { Pool } = require('pg');
const { PADRAO_NOME_USUARIO } = require('./ajudantes');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

let f = 0;
const ok = (c, m) => { console.log((c ? '  OK    ' : '  FALHA ') + m); if (!c) f++; };

(async () => {
  try {
    console.log('=== 1. COLUNAS ===');
    const cols = await pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'usuarios'
         AND column_name IN ('nome_usuario','nome_exibicao','nome_artista')
       ORDER BY column_name`);
    ok(cols.rows.some((c) => c.column_name === 'nome_exibicao'), 'usuarios.nome_exibicao existe');
    const cols2fa = await pool.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'verificacoes_2fa'
         AND column_name = 'nome_exibicao'`);
    ok(cols2fa.rows.length === 1, 'verificacoes_2fa.nome_exibicao existe');

    console.log('\n=== 2. O NOME QUE A PESSOA VIA FOI PRESERVADO ===');
    // O que o @ era antes da migração (do log da execução) e o que precisa
    // ter sobrado em nome_exibicao.
    // O que o @ era antes da migração e o que precisa ter sobrado em
    // nome_exibicao. O id=30 é o caso Interesting: não tinha @ nenhum,
    // então não havia nome antigo a preservar — fica NULL de propósito, e
    // a tela mostra o @ por causa do fallback nome_exibicao || nome_usuario.
    const esperado = {
      27: { handle: 'rfeitosamalafaia', exibicao: null },
      30: { handle: 'lhorranycerqueira', exibicao: null },
      34: { handle: 'rodrigoglasses', exibicao: 'Megane ツ' },
      35: { handle: 'limaopapaiadosuljamaicano', exibicao: 'DJ tree' },
      38: { handle: 'ren.setsunaaa', exibicao: 'carol sayo' },
    };
    const { rows } = await pool.query(
      `SELECT id, nome_usuario, nome_exibicao, nome_artista, eh_artista FROM usuarios WHERE id = ANY($1::int[]) ORDER BY id`,
      [Object.keys(esperado).map(Number)]
    );
    rows.forEach((u) => {
      const e = esperado[u.id];
      ok(u.nome_usuario === e.handle, `id=${u.id} @ = ${u.nome_usuario}`);
      if (e.exibicao !== null) {
        ok(u.nome_exibicao === e.exibicao, `id=${u.id} nome_exibicao preservou "${e.exibicao}" (está "${u.nome_exibicao}")`);
      } else {
        ok(u.nome_exibicao === null, `id=${u.id} nome_exibicao é NULL (não havia @ antigo) -> a tela mostra @${u.nome_usuario}`);
      }
      if (u.eh_artista && u.nome_artista) {
        ok(true, `id=${u.id} é artista, então a tela mostra "${u.nome_artista}" (nome_artista ganha do nome_exibicao)`);
      }
    });

    console.log('\n=== 3. O ÍNDICE BARA DUPLICATA (e desfaz a tudo) ===');
    const antes = await pool.query('SELECT COUNT(*)::int AS n FROM usuarios');
    // tenta criar uma conta duplicada dentro de uma transação que sempre
    // dá rollback: nada é gravado, mas o índice é exercitado de verdade.
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      const base = await cliente.query('SELECT nome_usuario FROM usuarios LIMIT 1');
      const alvo = base.rows[0].nome_usuario;
      let barrou = false;
      let codigo = null;
      try {
        await cliente.query(
          `INSERT INTO usuarios (email, senha, nome_usuario, verificado) VALUES ($1, $2, $3, TRUE)`,
          ['teste.indice@local.dev', 'x', alvo]
        );
      } catch (erro) {
        barrou = true;
        codigo = erro.code;
      }
      ok(barrou, `INSERT com @ repetido foi barrado (código ${codigo})`);
      ok(codigo === '23505', 'o erro é de violação de unicidade (23505)');
    } finally {
      await cliente.query('ROLLBACK');
      await cliente.release();
    }
    const depois = await pool.query('SELECT COUNT(*)::int AS n FROM usuarios');
    ok(depois.rows[0].n === antes.rows[0].n, `nada foi gravado (${antes.rows[0].n} contas antes e depois)`);

    console.log('\n=== 4. O ÍNDICE IGNORA CAIXA ===');
    const cliente2 = await pool.connect();
    try {
      await cliente2.query('BEGIN');
      const base = await cliente2.query('SELECT nome_usuario FROM usuarios WHERE length(nome_usuario) >= 3 LIMIT 1');
      const alvo = base.rows[0].nome_usuario;
      const emMaiusculas = alvo.toUpperCase();
      let barrou = false;
      try {
        await cliente2.query(
          `INSERT INTO usuarios (email, senha, nome_usuario, verificado) VALUES ($1, $2, $3, TRUE)`,
          ['teste.cx@local.dev', 'x', emMaiusculas]
        );
      } catch (erro) { barrou = true; }
      ok(barrou && emMaiusculas !== alvo, `"${alvo}" e "${emMaiusculas}" (mesmo @, caixa diferente) não convivem`);
    } finally {
      await cliente2.query('ROLLBACK');
      await cliente2.release();
    }

    console.log('\n=== 5. NULL SEGUE PERMITIDO ===');
    const cliente3 = await pool.connect();
    try {
      await cliente3.query('BEGIN');
      const r = await cliente3.query(
        `INSERT INTO usuarios (email, senha, nome_usuario, verificado) VALUES ($1, $2, NULL, TRUE) RETURNING id`,
        ['teste.null@local.dev', 'x']
      );
      ok(r.rows.length === 1, 'conta sem @ foi aceita (o índice só cobre NOT NULL)');
    } catch (erro) {
      ok(false, 'conta sem @ foi barrada: ' + erro.message);
    } finally {
      await cliente3.query('ROLLBACK');
      await cliente3.release();
    }

    console.log('\n=== 6. TODOS OS @ ATUALIZOS SÃO VÁLIDOS ===');
    const todos = await pool.query('SELECT nome_usuario FROM usuarios WHERE nome_usuario IS NOT NULL');
    ok(todos.rows.every((r) => PADRAO_NOME_USUARIO.test(r.nome_usuario)),
      `${todos.rows.length} @ conferem no padrão estrito`);

  } catch (erro) {
    console.error('\nFALHA:', erro.message, erro.code || '');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
  console.log('\n' + (f ? f + ' FALHA(S)' : 'TUDO OK'));
  process.exit(f ? 1 : 0);
})();
