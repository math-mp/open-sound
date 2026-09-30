// ================================================================
// PRÉ-VISUALIZAÇÃO — SOMENTE LEITURA. Não altera nada no banco.
// Rodar: node pre-visualizacao-handles.js
// ================================================================
// Mostra qual @ cada conta receberia, aplicando a regra do Discord:
//   nome_exibicao  -> livre (preserva o que já existe)
//   nome_usuario   -> @ estrito [A-Za-z0-9._-], 3-28, único sem caixa
// A coluna nome_exibicao ainda NÃO existe: esta prévia só simula.

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

const PADRAO_HANDLE = /^[A-Za-z0-9._-]{3,28}$/;
const MAX = 28;

// Deriva um @ plausível da parte local do email.
function baseDoEmail(email) {
  const local = String(email || '').split('@')[0] || '';
  let base = local.toLowerCase().replace(/[^a-z0-9._-]+/g, '').replace(/^[._-]+|[._-]+$/g, '');
  if (base.length > MAX) base = base.slice(0, MAX).replace(/[._-]+$/, '');
  if (base.length < 3) base = (base + 'user').slice(0, MAX);
  return base || 'user';
}

// Aproxima o resultado real do índice único: resolve colisão com sufixo.
function resolverColisao(base, usados) {
  if (!usados.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const sufixo = String(n);
    const maxBase = MAX - sufixo.length;
    const cortado = base.length > maxBase ? base.slice(0, maxBase).replace(/[._-]+$/, '') : base;
    const tentativa = (cortado + sufixo);
    if (tentativa.length >= 3 && !usados.has(tentativa.toLowerCase())) return tentativa;
  }
  return base + Math.floor(Math.random() * 1e6);
}

(async () => {
  try {
    const { rows } = await pool.query(`
      SELECT id, email, nome_usuario, nome_artista, eh_artista, verificado, criado_em
        FROM usuarios
       ORDER BY id
    `);

    // Everything que já está reservado hoje (os @ atuais válidos entram na lista).
    const usados = new Set();
    rows.forEach((u) => {
      if (u.nome_usuario && PADRAO_HANDLE.test(u.nome_usuario)) usados.add(u.nome_usuario.toLowerCase());
    });

    const precisaMudar = rows.filter((u) => !u.nome_usuario || !PADRAO_HANDLE.test(u.nome_usuario));
    const emConflito = [];

    // Simula a geração em cadeia, para nãoems 2 contas receberem o mesmo @.
    const plano = precisaMudar.map((u) => {
      const base = baseDoEmail(u.email);
      const novo = resolverColisao(base, usados);
      usados.add(novo.toLowerCase());
      return { u, novo };
    });

    // Um segundo passe, porque um @ válido pode ter sido tomado por um
    // gerado depois (ex.: alguém já tem "joao" e geramos "joao2" colidindo
    // com um "joao2" existente).
    usados.clear();
    rows.forEach((u) => { if (u.nome_usuario && PADRAO_HANDLE.test(u.nome_usuario)) usados.add(u.nome_usuario.toLowerCase()); });
    const planoFinal = [];
    for (const item of plano) {
      const novo = resolverColisao(item.novo, usados);
      usados.add(novo.toLowerCase());
      planoFinal.push({ ...item, novo });
    }

    console.log('\n=== CONTAS QUE VÃO RECEBER @ NOVO ===');
    if (planoFinal.length === 0) {
      console.log('  nenhuma — todos os @ atuais já seguem o padrão');
    } else {
      console.log('  (nada foi escrito; isto é só a prévia)\n');
      planoFinal.forEach(({ u, novo }) => {
        const nomeExibicao = u.nome_artista || u.nome_usuario || '';
        console.log('  id=' + u.id + '  ' + u.email);
        console.log('      @ hoje      : ' + (u.nome_usuario === null ? '(nenhum)' : '"' + u.nome_usuario + '"'));
        console.log('      @ novo      : ' + novo);
        console.log('      nome de exibição : "' + nomeExibicao + '"' + (u.eh_artista ? '  (é artista)' : '  (não é artista)'));
        console.log('');
      });
    }

    console.log('=== CONFLITOS QUE A PRÉVIA NÃO RESOLVEU ===');
    console.log(planoFinal.some((p) => /^\d{6,}$/.test(p.novo)) ? '  SIM (revisar)' : '  nenhum');

    console.log('\n=== CONTAS QUE NÃO VÃO MUDAR ===');
    rows.filter((u) => u.nome_usuario && PADRAO_HANDLE.test(u.nome_usuario)).forEach((u) => {
      console.log('  id=' + u.id + '  @' + u.nome_usuario + '  (' + u.email + ')');
    });

    console.log('\n=== RESUMO ===');
    console.log('  contas no total .......... ' + rows.length);
    console.log('  @ que já seguem o padrão . ' + (rows.length - planoFinal.length));
    console.log('  @ a gerar ................ ' + planoFinal.length);
    console.log('  nome_exibicao a preencher  ' + rows.length + '  (copia do nome atual, antes de trocar o @)');

  } catch (erro) {
    console.error('\nFALHA NA CONSULTA:', erro.message);
    if (erro.code) console.error('código do Postgres:', erro.code);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
