// Conexão com o PostgreSQL + criação/migração de TODAS as tabelas.
// Este arquivo é a única fonte da verdade do schema (o perfil.routes.js
// não é mais necessário).
const { Pool } = require('pg');
const {
  logInfo,
  logWarn,
  logError,
  PADRAO_NOME_USUARIO,
  gerarNomeDeUsuario
} = require('./ajudantes');

// NUNCA logamos host/usuário/database: a conexão é montada aqui e a string
// completa carrega a senha. O log serve para saber QUE banco, não COMO.
logInfo('DB', 'Conectando ao PostgreSQL');

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

// 'connect' só dispara quando o pool realmente abre a primeira conexão — ou
// seja, é a prova de que a conexão funcionou, não só de que ela foi pedida.
pool.on('connect', () => logInfo('DB', 'Conexão estabelecida'));
pool.on('error', (erro) => logError('ERROR', 'Erro na conexão do pool PostgreSQL', { codigo: erro.code, mensagem: erro.message }));

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
  // Nome de exibição (livre) separado do @ (estrito) — modelo Discord.
  // Antes o mesmo campo servia aos dois papéis, e era por isso que dava
  // para ter "Megane ツ" como @. Ver PADRAO_NOME_USUARIO em ajudantes.js.
  'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nome_exibicao TEXT',
  // Preenche com o @ atual ANTES de qualquer normalização, para que a
  // troca de @ não mude o nome que a pessoa vê na tela.
  `UPDATE usuarios SET nome_exibicao = nome_usuario WHERE nome_exibicao IS NULL AND nome_usuario IS NOT NULL`,
  // ---------- personalização visual ----------
  // JSONB e não uma tabela 1:1 porque é um cabeçalho pequeno que sempre é
  // lido junto com o usuário e nunca é procurado "por valor" (ninguém
  // busca "quem tem borda holo"). Uma tabela custaria um JOIN em toda
  // leitura de perfil para um dado sem ciclo de vida próprio. Precedente
  // no próprio schema: user_player_state.queue já é JSONB.
  'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS url_banner TEXT',
  'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS url_fundo TEXT',
  `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS personalizacao JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `UPDATE usuarios SET personalizacao = '{}'::jsonb WHERE personalizacao IS NULL`,
  // ---------- status e "ouvindo agora" ----------
  // Status é texto livre escolhido pela pessoa (1 emoji + até 40
  // caracteres). "Ouvindo agora" é PRIVADO por padrão: a coluna guarda
  // só a autorização, e o conteúdo do player só sai pela rota pública
  // quando o dono liga o interruptor.
  'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS status_emoji TEXT',
  'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS status_texto TEXT',
  'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mostrar_ouvindo BOOLEAN NOT NULL DEFAULT FALSE',
  `UPDATE usuarios SET mostrar_ouvindo = FALSE WHERE mostrar_ouvindo IS NULL`,
  'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tema VARCHAR(10) DEFAULT \'dark\'',
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
     nome_exibicao TEXT,
     codigo_hash VARCHAR(255) NOT NULL,
     tentativas INTEGER DEFAULT 0,
     criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
     expira_em TIMESTAMPTZ NOT NULL,
     ultimo_envio_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
   )`,
  // O nome de exibição viaja junto com o @ pelo mesmo caminho, senão o
  // que a pessoa digitou no cadastro se perderia na confirmação por e-mail.
  'ALTER TABLE verificacoes_2fa ADD COLUMN IF NOT EXISTS nome_exibicao TEXT',
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

// ---------- normalização dos @ que já existiam ----------
// Contas criadas antes do @ virar único podem ter @ vazio, com espaço ou
// com caractere fora do padrão (ex.: "Megane ツ"). O índice único não pode
// ser criado antes delas serem normalizadas.
//
// Regra: o @ antigo vai para `nome_exibicao` (é o nome que a pessoa via)
// e o `nome_usuario` passa a receber um @ estrito derivado do e-mail.
//
// Idempotente de verdade: só toca em linhas que ainda não seguem o
// padrão, então rodar a cada boot não causa efeito nenhum depois da
// primeira vez. Também não depende de id fixo — deriva dos próprios dados,
// então funciona igual em qualquer banco.
const normalizarNomesDeUsuario = async () => {
  const { rows: foraDoPadrao } = await pool.query(
    'SELECT id, email, nome_usuario FROM usuarios WHERE nome_usuario IS NULL OR nome_usuario !~ $1',
    [PADRAO_NOME_USUARIO.source]
  );

  if (foraDoPadrao.length === 0) return 0;

  // @ já válidos entram na lista de ocupados antes de gerar qualquer um
  // novo, senão um @ gerado poderia ocupar o lugar de um existente.
  const { rows: existentes } = await pool.query(
    'SELECT nome_usuario FROM usuarios WHERE nome_usuario IS NOT NULL'
  );
  const ocupados = new Set(existentes.map((linha) => linha.nome_usuario.toLowerCase()));

  for (const usuario of foraDoPadrao) {
    const antigo = usuario.nome_usuario;
    const handle = gerarNomeDeUsuario(usuario.email, ocupados);
    ocupados.add(handle.toLowerCase());

    await pool.query(
      `UPDATE usuarios
          SET nome_exibicao = COALESCE(NULLIF(nome_exibicao, ''), $1),
              nome_usuario = $2
        WHERE id = $3`,
      [antigo, handle, usuario.id]
    );

    logInfo('DB', 'Nome de usuário normalizado', {
      id: usuario.id,
      de: antigo,
      para: handle
    });
  }

  return foraDoPadrao.length;
};

const criarTabelas = async () => {
  logInfo('DB', `Verificando schema (${COMANDOS.length} comandos idempotentes)`);

  for (const comando of COMANDOS) {
    await pool.query(comando);
  }

  logInfo('DB', 'Tabelas verificadas/criadas');

  // Passos "extras": se falharem, o servidor sobe mesmo assim.
  try {
    await pool.query(CONVERTER_FUSO);
    logInfo('DB', 'Colunas de data convertidas para TIMESTAMPTZ');
  } catch (erro) {
    logWarn('DB', 'Não foi possível converter colunas de data para TIMESTAMPTZ', { mensagem: erro.message });
  }

  try {
    // Garante uma única playlist "Favoritos" por usuário (evita corrida na criação).
    await pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_playlists_favoritos_por_usuario ON playlists(usuario_id) WHERE eh_favoritos'
    );
    logInfo('DB', 'Índice único de Favoritos verificado');
  } catch (erro) {
    logWarn('DB', 'Índice único de Favoritos não criado (há Favoritos duplicados?)', { mensagem: erro.message });
  }

  // Normaliza os @ fora do padrão ANTES do índice: única e minúscula
  // impedem dois @ como "Ana" e "ana" de convivendo.
  try {
    const normalizados = await normalizarNomesDeUsuario();
    if (normalizados > 0) {
      logInfo('DB', 'Nomes de usuário fora do padrão foram normalizados', { total: normalizados });
    }
  } catch (erro) {
    logWarn('DB', 'Não foi possível normalizar nomes de usuário', { mensagem: erro.message });
  }

  try {
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_nome_usuario
         ON usuarios (LOWER(nome_usuario))
        WHERE nome_usuario IS NOT NULL`
    );
    logInfo('DB', 'Índice único de nome de usuário verificado');
  } catch (erro) {
    logWarn('DB', 'Índice único de nome de usuário não criado (há @ repetidos?)', { mensagem: erro.message });
  }

  logInfo('DB', 'Banco pronto');
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
        logError('ERROR', 'Erro ao criar tabelas no PostgreSQL', {
          codigo: erro.code,
          mensagem: erro.message,
          tentativas
        });
        return false;
      }
      logWarn('DB', 'Banco ainda não pronto, repetindo', {
        codigo: erro.code,
        tentativa,
        tentativas
      });
      await esperar(intervaloMs);
    }
  }
  return false;
};

// O server.js aguarda esta promise antes de começar a aceitar requisições.
pool.pronto = criarTabelasComRetry();

module.exports = pool;