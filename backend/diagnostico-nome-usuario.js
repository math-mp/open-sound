// ================================================================
// DIAGNÓSTICO — SOMENTE LEITURA. Não altera nada no banco.
// Rodar: node diagnostico-nome-usuario.js
// ================================================================
// Objetivo: antes de criar o índice único em LOWER(nome_usuario),
// descobrir o que já existe na tabela que impediria a criação.

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

const linha = (titulo) => console.log('\n=== ' + titulo + ' ===');

const mostrar = (rotulo, valor) => console.log('  ' + rotulo.padEnd(34) + valor);

(async () => {
  try {
    // ---- 1. Panorama geral ----
    linha('PANORAMA');
    const geral = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(nome_usuario)::int AS com_nome,
        COUNT(*) FILTER (WHERE nome_usuario IS NULL)::int AS sem_nome,
        COUNT(*) FILTER (WHERE nome_usuario = '')::int AS nome_vazio,
        COUNT(*) FILTER (WHERE verificado = FALSE)::int AS nao_verificados
      FROM usuarios
    `);
    const g = geral.rows[0];
    mostrar('usuários no total', g.total);
    mostrar('com @ definido', g.com_nome);
    mostrar('sem @ (NULL)', g.sem_nome);
    mostrar('com @ vazio ("")', g.nome_vazio);
    mostrar('ainda não verificados (2FA)', g.nao_verificados);

    // ---- 2. O que bloquearia o índice único ----
    linha('DUPLICADOS EXATOS (bloqueiam o índice)');
    const exatos = await pool.query(`
      SELECT nome_usuario, COUNT(*)::int AS total
        FROM usuarios
       WHERE nome_usuario IS NOT NULL
       GROUP BY nome_usuario
      HAVING COUNT(*) > 1
       ORDER BY total DESC, nome_usuario
    `);
    if (exatos.rows.length === 0) {
      mostrar('nenhum', '✓ nenhum @ idêntico repetido');
    } else {
      console.log('  ⚠ ' + exatos.rows.length + ' @ repetido(s) exatamente:');
      exatos.rows.forEach((r) => mostrar('  @' + r.nome_usuario, r.total + ' contas'));
    }

    linha('DUPLICADOS IGNORANDO CAIXA (bloqueiam o índice LOWER)');
    const caixas = await pool.query(`
      SELECT LOWER(nome_usuario) AS nome, COUNT(*)::int AS total,
             array_agg(nome_usuario ORDER BY nome_usuario) AS grafias,
             array_agg(id ORDER BY criado_em, id) AS ids,
             array_agg(email ORDER BY criado_em, id) AS emails,
             array_agg(criado_em ORDER BY criado_em, id) AS datas
        FROM usuarios
       WHERE nome_usuario IS NOT NULL
       GROUP BY LOWER(nome_usuario)
      HAVING COUNT(*) > 1
       ORDER BY total DESC, nome
    `);
    if (caixas.rows.length === 0) {
      mostrar('nenhum', '✓ nenhum @ conflita ignorando caixa');
    } else {
      console.log('  ⚠ ' + caixas.rows.length + ' grupo(s) em conflito:');
      caixas.rows.forEach((r) => {
        console.log('    @' + r.nome + '  (' + r.total + ' contas)');
        r.grafias.forEach((g, i) => {
          console.log('      ' + (g === r.nome ? '•' : ' ') + ' id=' + r.ids[i] + '  "' + g + '"  ' + r.emails[i]
            + '  criada em ' + new Date(r.datas[i]).toISOString().slice(0, 10));
        });
        console.log('');
      });
    }

    // ---- 3. Nomes que estouram o limite ou o charset novo ----
    linha('FORA DAS REGRAS QUE O @ VAI TER');
    const regras = await pool.query(`
      SELECT id, nome_usuario, email,
             char_length(nome_usuario) AS tamanho
        FROM usuarios
       WHERE nome_usuario IS NOT NULL
         AND ( LOWER(nome_usuario) !~ '^[a-z0-9._-]+$'
               OR char_length(nome_usuario) < 3
               OR char_length(nome_usuario) > 28 )
       ORDER BY char_length(nome_usuario) DESC, id
    `);
    if (regras.rows.length === 0) {
      mostrar('nenhum', '✓ todos os @ atuais já cabem em [a-z0-9._-], 3-28');
    } else {
      console.log('  ⚠ ' + regras.rows.length + ' @ fora do padrão (regras de tamanho/charset):');
      regras.rows.forEach((r) => {
        const motivos = [];
        if (r.tamanho < 3) motivos.push('curto demais (' + r.tamanho + ')');
        if (r.tamanho > 28) motivos.push('longo demais (' + r.tamanho + ')');
        if (!/^[a-z0-9._-]+$/i.test(r.nome_usuario)) motivos.push('caractere fora de [a-z0-9._-]');
        console.log('      id=' + r.id + '  "' + r.nome_usuario + '"  ' + r.email + '  -> ' + motivos.join(' + '));
      });
    }

    // ---- 4. Cadastros pendentes de 2FA (nome还没 criado) ----
    linha('CADASTROS PENDENTES DE 2FA (tabela verificacoes_2fa)');
    const pendentes = await pool.query(`
      SELECT LOWER(nome_usuario) AS nome, COUNT(*)::int AS total,
             array_agg(email) AS emails
        FROM verificacoes_2fa
       WHERE nome_usuario IS NOT NULL AND expira_em > CURRENT_TIMESTAMP
       GROUP BY LOWER(nome_usuario)
      HAVING COUNT(*) > 1
       ORDER BY total DESC
    `);
    if (pendentes.rows.length === 0) {
      mostrar('pendentes vivos', '0');
      const totalPend = await pool.query(
        'SELECT COUNT(*)::int AS n FROM verificacoes_2fa WHERE nome_usuario IS NOT NULL AND expira_em > CURRENT_TIMESTAMP'
      );
      mostrar('com @ preenchido', totalPend.rows[0].n);
    } else {
      console.log('  ⚠ ' + pendentes.rows.length + ' @ reservado por mais de um cadastro pendente:');
      pendentes.rows.forEach((r) => mostrar('  @' + r.nome, r.total + ' pendentes: ' + r.emails.join(', ')));
    }

    // ---- 5. Índice já existente? ----
    linha('ÍNDICES EM usuarios');
    const indices = await pool.query(`
      SELECT indexname, indexdef
        FROM pg_indexes
       WHERE schemaname = current_schema() AND tablename = 'usuarios'
       ORDER BY indexname
    `);
    indices.rows.forEach((r) => console.log('  ' + r.indexname + '\n      ' + r.indexdef));

    // ---- 6. Constraint de unicidade atual? ----
    linha('UNIQUE DECLARADOS NA COLUNA nome_usuario');
    const unicos = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) AS definicao
        FROM pg_constraint
       WHERE conrelid = 'usuarios'::regclass AND contype = 'u'
    `);
    if (unicos.rows.length === 0) mostrar('nenhum', '(por isso @ pode se repetir hoje)');
    else unicos.rows.forEach((r) => console.log('  ' + r.conname + ': ' + r.definicao));

  } catch (erro) {
    console.error('\nFALHA NA CONSULTA:', erro.message);
    if (erro.code) console.error('código do Postgres:', erro.code);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
