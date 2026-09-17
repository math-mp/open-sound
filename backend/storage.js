// Cliente do Supabase Storage — serviço separado do Postgres, então usa
// credenciais diferentes (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY), não
// as mesmas DB_HOST/DB_PASSWORD usadas pra conexão do banco.
// Ambas ficam disponíveis no painel do Supabase em: Project Settings > API.
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET_MUSICAS || 'musicas';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar definidos no .env.');
}

// IMPORTANTE: a "service role key" ignora as políticas de RLS do Storage e
// tem acesso total. Ela só pode viver no backend (.env do servidor) —
// nunca deve ser exposta no frontend/home.js, ao contrário da "anon key"
// (que é segura de expor publicamente).
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Garante que o bucket de músicas existe, criando como público se necessário.
// "Público" aqui = quem tiver a URL consegue baixar o arquivo direto, sem
// precisar de token. O gate de "precisa estar logado pra tocar" continua
// existindo no frontend/rota — isso só evita reinventar autenticação de
// download por enquanto. Se quiser esconder o link puro depois, dá pra
// trocar por bucket privado + URLs assinadas com expiração.
const garantirBucket = async () => {
  const { data: buckets, error: erroListagem } = await supabase.storage.listBuckets();

  if (erroListagem) {
    console.error('Erro ao verificar buckets do Supabase Storage:', erroListagem);
    return;
  }

  const jaExiste = buckets.some((b) => b.name === SUPABASE_BUCKET);
  if (jaExiste) {
    console.log(`Bucket "${SUPABASE_BUCKET}" já existe.`);
    return;
  }

  const { error: erroCriacao } = await supabase.storage.createBucket(SUPABASE_BUCKET, { public: true });
  if (erroCriacao) {
    console.error('Erro ao criar bucket no Supabase Storage:', erroCriacao);
  } else {
    console.log(`Bucket "${SUPABASE_BUCKET}" criado com sucesso.`);
  }
};

module.exports = { supabase, SUPABASE_BUCKET, garantirBucket }; 