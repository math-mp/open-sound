// Professora, nosso códgo ja virou legado....
require('dotenv').config();
const express = require('express');  
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const crypto = require('crypto');
const pool = require('./database');
const { supabase, SUPABASE_BUCKET, garantirBucket } = require('./storage');
const {
  UsuarioInexistente,
  MusicaInexistente,
  LimiteDePlaylists,
  tamanhoEmCaracteres,
  paraIdValido,
  NOME_EXIBICAO_MAX,
  STATUS_TEXTO_MAX,
  STATUS_EMOJI_MAX,
  contarGrafemas,
  recortarPorGrafemas,
  mensagemNomeUsuarioInvalido,
  nomeDeUsuarioDisponivel,
  normalizarPersonalizacao,
  detectarTipoImagem,
  detectarTipoImagemComGif,
  detectarTipoAudio,
  ehViolacaoDeChave,
  ehMusicaSumida,
  comTravaDoUsuario,
  removerArquivosDoStorage,
  removerArquivoDoStorage,
  logInfo,
  logWarn,
  logError,
  DEBUG_LOGS
} = require('./ajudantes');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

// ============================================================
// MIDDLEWARE DE LOG HTTP
// ============================================================
app.use((req, res, next) => {
  const inicio = Date.now();
  const metodo = req.method;
  const url = req.originalUrl;
  
  // Log da requisição recebida
  logInfo('HTTP', `${metodo} ${url}`);
  
  res.on('finish', () => {
    const duracao = Date.now() - inicio;
    logInfo('HTTP', `${metodo} ${url} → ${res.statusCode} (${duracao}ms)`);
  });
  
  next();
});

// Sem fallback fraco: se a variável não existir, o servidor não sobe.
const JWT_SECRET_SESSAO = process.env.JWT_SECRET_SESSAO;
if (!JWT_SECRET_SESSAO) {
  throw new Error('JWT_SECRET_SESSAO precisa estar definido no .env. Defina um valor forte antes de subir o servidor.');
}

// ============================================================
// CONSTANTES E HELPERS GERAIS
// ============================================================

const EM_PRODUCAO = process.env.NODE_ENV === 'production';

const MSG_SENHA_FRACA = 'A senha deve ter no mínimo 8 caracteres, incluindo pelo menos uma letra maiúscula, uma minúscula, um número e um caractere especial (@$!%*?&#).';
const EXPIRACAO_CODIGO_MS = 10 * 60 * 1000;
const ESPERA_REENVIO_S = 60;
const MAX_TENTATIVAS_CODIGO = 5;

const LIMITE_REDEFINICOES_MODAL = 3;
const JANELA_REDEFINICOES_MODAL_HORAS = 24;
const COOLDOWN_REDEFINICAO_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_EXCLUSAO_MUSICA_MS = 24 * 60 * 60 * 1000;

// O @ (nome_usuario) tem as regras em ajudantes.js: 3-28 caracteres de
// [A-Za-z0-9._-], único sem diferenciar caixa. Aqui é só o nome de
// artista, que é livre.
const NOME_ARTISTA_MAX = 60;
const TITULO_MUSICA_MAX = 255;
const BIO_MAX = 220;
const CURTIDAS_MAX = 4;
const PLAYLIST_NOME_MAX = 60;
const PLAYLISTS_MAX_POR_USUARIO = 20;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const CAPA_MAX_BYTES = 5 * 1024 * 1024;
const AUDIO_MAX_BYTES = 25 * 1024 * 1024;
const TEMAS_VALIDOS = ['light', 'dark'];
// usuario_id entra aqui para o front saber se a música tem um dono (e então
// o nome do artista pode virar link para o perfil). Vem NULL para música sem
// dono — e aí o nome segue sendo texto puro.
const COLUNAS_MUSICA = 'm.id, m.titulo, m.artista, m.url_audio, m.url_capa, m.usuario_id';

const falha = (res, status, mensagem, extra = {}) =>
  res.status(status).json({ status: 'erro', mensagem, ...extra });

const sucesso = (res, corpo = {}, status = 200) =>
  res.status(status).json({ status: 'sucesso', ...corpo });

const falhaInterna = (res, contexto, erro) => {
  // Ponto único de log de erro interno: toda rota que chama este helper já
  // aparece aqui com o endpoint e a mensagem real do Postgres/Storage.
  logError('ERROR', `Falha em ${contexto}`, { codigo: erro.code, mensagem: erro.message });
  return falha(res, 500, 'Erro interno no servidor.');
};

const ehTexto = (valor) => typeof valor === 'string';
const gerarCodigo = () => crypto.randomInt(100000, 1000000).toString();
const expirado = (data) => new Date(data).getTime() < Date.now();

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validarSenhaForte(senha) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@()!%*?&#])[A-Za-z\d@()!%*?&#]{8,}$/.test(senha);
}

// Envio pela Gmail API (HTTPS, porta 443). O Render bloqueia SMTP de saída
// (25/465/587) no plano gratuito, então não dá para usar nodemailer/SMTP.
// O e-mail sai dos servidores do Google, com o Gmail do projeto como remetente.
// Variáveis: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, EMAIL_FROM.
let tokenGoogle = { valor: null, expiraEm: 0 };

async function obterAccessTokenGoogle() {
  if (tokenGoogle.valor && Date.now() < tokenGoogle.expiraEm - 60 * 1000) {
    return tokenGoogle.valor;
  }
  const resposta = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN || '',
      grant_type: 'refresh_token'
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!resposta.ok) {
    throw new Error(`Google OAuth respondeu ${resposta.status}: ${await resposta.text()}`);
  }
  const dados = await resposta.json();
  tokenGoogle = { valor: dados.access_token, expiraEm: Date.now() + dados.expires_in * 1000 };
  return tokenGoogle.valor;
}

function montarMensagemMime({ de, para, assunto, texto }) {
  const b64 = (valor) => Buffer.from(valor, 'utf8').toString('base64');
  return [
    `From: =?UTF-8?B?${b64('Open sound')}?= <${de}>`,
    `To: ${para}`,
    `Subject: =?UTF-8?B?${b64(assunto)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(texto).replace(/(.{76})/g, '$1\r\n')
  ].join('\r\n');
}

async function enviarEmail(para, assunto, texto) {
  try {
    // Evita injeção de cabeçalhos: o destinatário não pode ter quebra de linha nem < >.
    if (/[\r\n<>,;]/.test(para)) throw new Error('Destinatário inválido.');

    const mime = montarMensagemMime({ de: process.env.EMAIL_FROM, para, assunto, texto });
    const raw = Buffer.from(mime, 'utf8').toString('base64url');

    const resposta = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await obterAccessTokenGoogle()}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(10000)
    });
    if (!resposta.ok) {
      if (resposta.status === 401) tokenGoogle = { valor: null, expiraEm: 0 };
      throw new Error(`Gmail API respondeu ${resposta.status}: ${await resposta.text()}`);
    }
    const dados = await resposta.json().catch(() => ({}));
    logInfo('EMAIL', 'Gmail API aceitou o e-mail', { para, messageId: dados.id });
    return true;
  } catch (erro) {
    logError('ERROR', 'Falha ao enviar e-mail pela Gmail API', { mensagem: erro.message });
    return false;
  }
}

// O código só é impresso fora de produção, e num log propositalmente
// destacado — é o que permite testar o fluxo de 2FA na mão. Para removê-lo,
// basta apagar esta função e as chamadas dela.
const logarCodigoEmDev = (rotulo, codigo) => {
  if (!EM_PRODUCAO) console.log(`[2FA][DEV] ${rotulo}: ${codigo}`);
};

const criarLimitador = (windowMs, max, mensagem) =>
  rateLimit({
    windowMs,
    max,
    message: { status: 'erro', mensagem },
    standardHeaders: true,
    legacyHeaders: false
  });

// Traduz erros do Multer para JSON em português.
function tratarMulter(middleware, limiteTexto) {
  return (req, res, next) => {
    middleware(req, res, (erro) => {
      if (!erro) return next();
      if (erro instanceof multer.MulterError) {
        if (erro.code === 'LIMIT_FILE_SIZE') {
          return falha(res, 413, `O arquivo passa do limite de ${limiteTexto}. Escolha um menor.`);
        }
        return falha(res, 400, 'Não foi possível ler o arquivo enviado.');
      }
      return next(erro);
    });
  };
}

// ============================================================
// AUTENTICAÇÃO (cadastro com 2FA, login, sessão)
// ============================================================

const limitarRegistroIP = criarLimitador(15 * 60 * 1000, 5, 'Muitas tentativas de registro a partir deste IP. Tente novamente mais tarde.');
const limitarValidacaoIP = criarLimitador(15 * 60 * 1000, 10, 'Muitas tentativas de verificação. Tente novamente mais tarde.');
const limitarReenvioIP = criarLimitador(60 * 60 * 1000, 5, 'Você excedeu o limite de 5 tentativas por hora. Tente novamente mais tarde.');
const limitarLoginIP = criarLimitador(15 * 60 * 1000, 10, 'Muitas tentativas de login a partir deste IP. Tente novamente mais tarde.');

// Autenticação OPCIONAL: quando há token válido, req.usuario é preenchido
// e a rota pode saber se quem está olhando é o dono. Sem token — ou com
// token inválido/expirado — a requisição segue normalmente, porque perfil
// público é público justamente para quem ainda não fez login.
async function verificarAutenticacaoOpcional(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

  try {
    const payload = jwt.verify(authHeader.split(' ')[1], JWT_SECRET_SESSAO, { algorithms: ['HS256'] });
    const resultado = await pool.query(
      'SELECT id FROM usuarios WHERE id = $1 AND verificado = TRUE',
      [payload.id]
    );
    if (resultado.rows[0]) req.usuario = { id: resultado.rows[0].id };
  } catch (erro) {
    // Token ruim não é erro aqui: a resposta pública sai igual.
  }
  return next();
}

app.post('/api/registro', limitarRegistroIP, async (req, res) => {
  const { email: emailBruto, password, nomeUsuario: nomeBruto, nomeExibicao: exibicaoBruta } = req.body || {};

  if (!ehTexto(emailBruto) || !ehTexto(password) || !ehTexto(nomeBruto) || !emailBruto.trim() || !password || !nomeBruto.trim()) {
    return falha(res, 400, 'E-mail, senha e nome de usuário são obrigatórios.');
  }

  const email = emailBruto.trim();
  const nomeUsuario = nomeBruto.trim();

  // Nome de exibição é opcional e livre (acentos, espaços, emoji). Vazio
  // significa "use o próprio @ como nome", que é o padrão do Discord.
  const nomeExibicao = ehTexto(exibicaoBruta) ? exibicaoBruta.trim() : '';
  if (nomeExibicao && tamanhoEmCaracteres(nomeExibicao) > NOME_EXIBICAO_MAX) {
    return falha(res, 400, `O nome de exibição pode ter no máximo ${NOME_EXIBICAO_MAX} caracteres.`);
  }

  if (!validarEmail(email)) return falha(res, 400, 'Por favor, insira um e-mail válido.');

  // O @ precisa seguir o padrão ANTES de qualquer gravação: um "Megane ツ"
  // como @ quebraria a URL do perfil e impediria a unicidade sem diferenciar
  // caixa. O nome de artista continua livre — quem o quiser escreve no
  // cadastro de artista.
  const problemaNomeUsuario = mensagemNomeUsuarioInvalido(nomeUsuario);
  if (problemaNomeUsuario) {
    logWarn('AUTH', 'Registro recusado: @ fora do padrão', { email });
    return falha(res, 400, problemaNomeUsuario, { codigo: 'NOME_USUARIO_INVALIDO' });
  }

  if (!validarSenhaForte(password)) return falha(res, 400, MSG_SENHA_FRACA);

  try {
    logInfo('AUTH', 'Tentativa de registro recebida', { email });

    const existente = await pool.query('SELECT 1 FROM usuarios WHERE email = $1', [email]);
    if (existente.rows.length > 0) {
      logWarn('AUTH', 'Registro recusado: e-mail já cadastrado', { email });
      return falha(res, 400, 'Este e-mail já está cadastrado. Por favor, faça login.', { codigo: 'EMAIL_JA_CADASTRADO' });
    }

    // Checagem amigável do @. Ela cobre o caso comum; a corrida entre duas
    // requisições no mesmo instante é fechada pelo índice único, com o
    // 23505 traduzido no /api/validar-2fa.
    if (!(await nomeDeUsuarioDisponivel(pool, nomeUsuario))) {
      logWarn('AUTH', 'Registro recusado: @ já em uso', { email, nomeUsuario });
      return falha(res, 409, 'Esse @ já está sendo usado. Escolha outro.', { codigo: 'NOME_USUARIO_JA_EM_USO' });
    }

    const codigo = gerarCodigo();
    logarCodigoEmDev('código 2FA (cadastro)', codigo);
    logInfo('2FA', 'Cadastro pendente criado', { email, idVerificacao: null });

    // Os dois hashes são independentes: rodam em paralelo.
    const [senhaHash, codigoHash] = await Promise.all([
      bcrypt.hash(password, 10),
      bcrypt.hash(codigo, 10)
    ]);
    const idVerificacao = crypto.randomUUID();
    const expiraEm = new Date(Date.now() + EXPIRACAO_CODIGO_MS);

    await pool.query(
      `INSERT INTO verificacoes_2fa (id, email, senha_hash, nome_usuario, nome_exibicao, codigo_hash, tentativas, expira_em, ultimo_envio_em)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7, CURRENT_TIMESTAMP)`,
      [idVerificacao, email, senhaHash, nomeUsuario, nomeExibicao || null, codigoHash, expiraEm]
    );

    // O e-mail é enviado em segundo plano: o envio leva alguns segundos e a
    // resposta não precisa esperar por ele. Se falhar, o cadastro pendente é
    // mantido de propósito — o usuário usa "Reenviar código" (que avisa o erro
    // na hora) ou o pendente expira sozinho em 10 minutos.
    enviarEmail(email, 'Seu código de verificação 2FA', `Seu código de confirmação é: ${codigo}`)
      .then((enviado) => {
        if (enviado) logInfo('2FA', 'Código enviado por e-mail', { email });
        else logError('2FA', 'Falha ao enviar e-mail de verificação (cadastro pendente mantido para reenvio)', { email });
      })
      .catch((erroEnvio) => logError('2FA', 'Erro inesperado ao enviar e-mail de verificação', { email, erro: erroEnvio.message }));

    return sucesso(res, { mensagem: 'Cadastro recebido! O código está a caminho do seu e-mail.', idVerificacao });
  } catch (erro) {
    logError('AUTH', 'Erro no registro', { erro: erro.message });
    return falhaInterna(res, 'POST /api/registro', erro);
  }
});

app.post('/api/validar-2fa', limitarValidacaoIP, async (req, res) => {
  const { codigo, idVerificacao } = req.body || {};

  if (!ehTexto(codigo) || !ehTexto(idVerificacao) || !codigo || !idVerificacao) {
    return falha(res, 400, 'Dados incompletos.');
  }

  try {
    logInfo('2FA', 'Validação recebida', { idVerificacao });
    const resultado = await pool.query('SELECT * FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);
    const verificacao = resultado.rows[0];

    if (!verificacao) {
      logWarn('2FA', 'Verificação não encontrada ou expirada', { idVerificacao });
      return falha(res, 400, 'Verificação não encontrada ou expirada.');
    }

    if (expirado(verificacao.expira_em)) {
      await pool.query('DELETE FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);
      logWarn('2FA', 'Código expirado', { idVerificacao });
      return falha(res, 400, 'O tempo limite do código expirou. Solicite um novo cadastro.');
    }

    if (verificacao.tentativas >= MAX_TENTATIVAS_CODIGO) {
      await pool.query('DELETE FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);
      logWarn('2FA', 'Máximo de tentativas excedido', { idVerificacao });
      return falha(res, 429, 'Número máximo de tentativas excedido. Solicite um novo cadastro.');
    }

    const codigoConfere = await bcrypt.compare(codigo.trim(), verificacao.codigo_hash);
    if (!codigoConfere) {
      await pool.query('UPDATE verificacoes_2fa SET tentativas = tentativas + 1 WHERE id = $1', [idVerificacao]);
      logWarn('2FA', 'Código incorreto', { idVerificacao, tentativas: verificacao.tentativas + 1 });
      return falha(res, 400, 'Código 2FA incorreto.');
    }

    logInfo('2FA', 'Verificação aprovada', { email: verificacao.email });
    try {
      await pool.query(
        `INSERT INTO usuarios (email, senha, nome_usuario, nome_exibicao, verificado)
         VALUES ($1, $2, $3, $4, TRUE)`,
        [
          verificacao.email,
          verificacao.senha_hash,
          verificacao.nome_usuario,
          verificacao.nome_exibicao || verificacao.nome_usuario
        ]
      );
    } catch (erroInsert) {
      // 23505 aqui tem DUAS causas possíveis, e elas precisam de mensagens
      // diferentes: alguém cadastrou o mesmo e-mail entre o registro e a
      // validação, OU o @ foi reservado por outra conta nesse intervalo
      // (o índice único é o que fecha essa corrida).
      if (ehViolacaoDeChave(erroInsert, ['23505'])) {
        await pool.query('DELETE FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);

        const emailEmUso = await pool.query('SELECT 1 FROM usuarios WHERE email = $1', [verificacao.email]);
        if (emailEmUso.rows.length > 0) {
          logWarn('2FA', 'Cadastro recusado: e-mail já cadastrado', { email: verificacao.email });
          return falha(res, 400, 'Este e-mail já está cadastrado. Por favor, faça login.', { codigo: 'EMAIL_JA_CADASTRADO' });
        }

        logWarn('2FA', 'Cadastro recusado: @ já reservado por outra conta', { nomeUsuario: verificacao.nome_usuario });
        return falha(res, 409, 'Esse @ acabou de ser usado por outra conta. Escolha outro e refaça o cadastro.', {
          codigo: 'NOME_USUARIO_JA_EM_USO'
        });
      }
      throw erroInsert;
    }

    await pool.query('DELETE FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);
    logInfo('2FA', 'Verificação removida após sucesso', { email: verificacao.email });
    return sucesso(res, { mensagem: 'Conta registrada e ativada com sucesso!' });
  } catch (erro) {
    logError('2FA', 'Erro na validação 2FA', { erro: erro.message });
    return falhaInterna(res, 'POST /api/validar-2fa', erro);
  }
});

app.post('/api/reenviar-2fa', limitarReenvioIP, async (req, res) => {
  const { idVerificacao } = req.body || {};

  if (!ehTexto(idVerificacao) || !idVerificacao) return falha(res, 400, 'Sessão inválida ou expirada.');

  try {
    logInfo('2FA', 'Reenvio solicitado', { idVerificacao });
    const resultado = await pool.query('SELECT * FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);
    const verificacao = resultado.rows[0];

    if (!verificacao) {
      logWarn('2FA', 'Sessão inválida ou expirada no reenvio', { idVerificacao });
      return falha(res, 400, 'Sessão inválida ou expirada.');
    }

    if (expirado(verificacao.expira_em)) {
      await pool.query('DELETE FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);
      logWarn('2FA', 'Tempo limite expirado no reenvio', { idVerificacao });
      return falha(res, 400, 'O tempo limite expirou. Solicite um novo cadastro.');
    }

    const decorrido = Math.floor((Date.now() - new Date(verificacao.ultimo_envio_em).getTime()) / 1000);
    if (decorrido < ESPERA_REENVIO_S) {
      return falha(res, 429, `Aguarde ${ESPERA_REENVIO_S - decorrido}s para solicitar um novo código.`);
    }

    const novoCodigo = gerarCodigo();
    logarCodigoEmDev('novo código 2FA (cadastro)', novoCodigo);
    const novoCodigoHash = await bcrypt.hash(novoCodigo, 10);

    await pool.query(
      'UPDATE verificacoes_2fa SET codigo_hash = $1, tentativas = 0, ultimo_envio_em = CURRENT_TIMESTAMP WHERE id = $2',
      [novoCodigoHash, idVerificacao]
    );

    const enviado = await enviarEmail(verificacao.email, 'Seu novo código de verificação 2FA', `Seu novo código de confirmação é: ${novoCodigo}`);
    if (!enviado) {
      logError('2FA', 'Falha ao reenviar e-mail', { email: verificacao.email });
      return falha(res, 500, 'Falha ao reenviar o e-mail de verificação.');
    }

    logInfo('2FA', 'Novo código enviado por e-mail', { email: verificacao.email });
    return sucesso(res, { mensagem: 'Novo código enviado com sucesso!' });
  } catch (erro) {
    logError('2FA', 'Erro no reenvio 2FA', { erro: erro.message });
    return falhaInterna(res, 'POST /api/reenviar-2fa', erro);
  }
});

app.post('/api/login', limitarLoginIP, async (req, res) => {
  const { email, password, lembrarDeMim } = req.body || {};

  if (!ehTexto(email) || !ehTexto(password) || !email || !password) {
    return falha(res, 400, 'E-mail e senha são obrigatórios.');
  }

  try {
    logInfo('AUTH', 'Tentativa de login recebida', { email: email.trim() });
    const resultado = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email.trim()]);
    const usuario = resultado.rows[0];

    if (!usuario) {
      logWarn('AUTH', 'Login recusado: e-mail não cadastrado', { email: email.trim() });
      return falha(res, 404, 'E-mail não cadastrado. Por favor, faça cadastro.', { codigo: 'EMAIL_NAO_CADASTRADO' });
    }
    if (!usuario.verificado) {
      logWarn('AUTH', 'Login recusado: conta não verificada', { email: email.trim() });
      return falha(res, 403, 'Conta ainda não verificada. Conclua o cadastro com o código 2FA.');
    }

    const senhaConfere = await bcrypt.compare(password, usuario.senha);
    if (!senhaConfere) {
      logWarn('AUTH', 'Login recusado: senha incorreta', { email: email.trim() });
      return falha(res, 401, 'Senha incorreta.');
    }

    logInfo('AUTH', 'Senha validada', { usuarioId: usuario.id });
    const tokenSessao = jwt.sign(
      { id: usuario.id, email: usuario.email },
      JWT_SECRET_SESSAO,
      { expiresIn: lembrarDeMim === true ? '30d' : '7d', algorithm: 'HS256' }
    );

    logInfo('AUTH', 'Login concluído', { usuarioId: usuario.id });
    return sucesso(res, { mensagem: 'Login realizado com sucesso!', tokenSessao });
  } catch (erro) {
    logError('AUTH', 'Erro no login', { erro: erro.message });
    return falhaInterna(res, 'POST /api/login', erro);
  }
});

// Confere o token E se a conta ainda existe. Token de conta apagada (banco
// recriado, conta excluída) vira 401 e o front desloga sozinho, em vez de
// cada rota devolver 404 "Usuário não encontrado".
async function verificarAutenticacao(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return falha(res, 401, 'Faça login para acessar este recurso.');
  }

  let payload;
  try {
    payload = jwt.verify(authHeader.split(' ')[1], JWT_SECRET_SESSAO, { algorithms: ['HS256'] });
  } catch (erro) {
    return falha(res, 401, 'Sessão inválida ou expirada. Faça login novamente.');
  }

  try {
    const resultado = await pool.query(
      'SELECT id, email FROM usuarios WHERE id = $1 AND verificado = TRUE',
      [payload.id]
    );
    if (!resultado.rows[0]) {
      return falha(res, 401, 'Sessão inválida ou expirada. Faça login novamente.');
    }
    req.usuario = { id: resultado.rows[0].id, email: resultado.rows[0].email };
    return next();
  } catch (erro) {
    return falhaInterna(res, 'verificarAutenticacao', erro);
  }
}

// ============================================================
// RECUPERAÇÃO DE SENHA — "ESQUECI MINHA SENHA" (público, sem auth)
// ============================================================

const limitarRecuperacaoSolicitarIP = criarLimitador(15 * 60 * 1000, 5, 'Muitas tentativas de recuperação a partir deste IP. Tente novamente mais tarde.');
const limitarRecuperacaoEtapasIP = criarLimitador(15 * 60 * 1000, 15, 'Muitas tentativas de recuperação a partir deste IP. Tente novamente mais tarde.');
const limitarReenviarRecuperacaoIP = criarLimitador(60 * 60 * 1000, 5, 'Você excedeu o limite de 5 reenvios por hora. Tente novamente mais tarde.');

const respostaLimiteRecuperacao = (res) =>
  falha(
    res,
    429,
    `Você atingiu o limite de ${LIMITE_REDEFINICOES_MODAL} redefinições de senha em ${JANELA_REDEFINICOES_MODAL_HORAS}h. Tente novamente mais tarde.`,
    { codigo: 'LIMITE_RECUPERACAO_ATINGIDO' }
  );

async function contarRedefinicoesModalRecentes(executor, usuarioId) {
  const resultado = await executor.query(
    `SELECT COUNT(*)::int AS total
       FROM historico_redefinicoes_senha
      WHERE usuario_id = $1
        AND origem = 'modal'
        AND criado_em > CURRENT_TIMESTAMP - ($2 || ' hours')::interval`,
    [usuarioId, String(JANELA_REDEFINICOES_MODAL_HORAS)]
  );
  return resultado.rows[0].total;
}

app.post('/api/auth/esqueci-senha', limitarRecuperacaoSolicitarIP, async (req, res) => {
  const { email: emailBruto } = req.body || {};

  if (!ehTexto(emailBruto) || !validarEmail(emailBruto.trim())) {
    return falha(res, 400, 'E-mail válido é obrigatório.');
  }
  const email = emailBruto.trim();

  try {
    logInfo('AUTH', 'Recuperação de senha solicitada', { email });
    const resultadoUsuario = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    const usuario = resultadoUsuario.rows[0];

    // Não revela se o e-mail existe.
    if (!usuario) {
      logInfo('AUTH', 'Recuperação: e-mail não encontrado (resposta genérica)', { email });
      return sucesso(res, { mensagem: 'Se o e-mail estiver cadastrado, enviaremos um código.', idVerificacao: null });
    }

    if ((await contarRedefinicoesModalRecentes(pool, usuario.id)) >= LIMITE_REDEFINICOES_MODAL) {
      logWarn('AUTH', 'Limite de recuperação atingido', { usuarioId: usuario.id });
      return respostaLimiteRecuperacao(res);
    }

    const codigo = gerarCodigo();
    logarCodigoEmDev('código de recuperação', codigo);
    const codigoHash = await bcrypt.hash(codigo, 10);
    const idRecuperacao = crypto.randomUUID();
    const expiraEm = new Date(Date.now() + EXPIRACAO_CODIGO_MS);

    await pool.query(
      `INSERT INTO recuperacoes_senha (id, email, codigo_hash, tentativas, expira_em, ultimo_envio_em)
       VALUES ($1, $2, $3, 0, $4, CURRENT_TIMESTAMP)`,
      [idRecuperacao, email, codigoHash, expiraEm]
    );

    const enviado = await enviarEmail(email, 'Código para recuperar sua senha', `Seu código de recuperação é: ${codigo}`);
    if (!enviado) {
      await pool.query('DELETE FROM recuperacoes_senha WHERE id = $1', [idRecuperacao]);
      logError('AUTH', 'Falha ao enviar e-mail de recuperação', { email });
      return falha(res, 500, 'Falha ao enviar o e-mail com o código.');
    }

    logInfo('AUTH', 'Código de recuperação enviado por e-mail', { email });
    return sucesso(res, { mensagem: 'Código enviado com sucesso!', idVerificacao: idRecuperacao });
  } catch (erro) {
    logError('AUTH', 'Erro na recuperação de senha', { erro: erro.message });
    return falhaInterna(res, 'POST /api/auth/esqueci-senha', erro);
  }
});

app.post('/api/auth/reenviar-esqueci', limitarReenviarRecuperacaoIP, async (req, res) => {
  const { idVerificacao } = req.body || {};

  if (!ehTexto(idVerificacao) || !idVerificacao) return falha(res, 400, 'Sessão inválida ou expirada.');

  try {
    const resultado = await pool.query('SELECT * FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
    const recuperacao = resultado.rows[0];

    if (!recuperacao) return falha(res, 400, 'Sessão inválida ou expirada.');

    if (expirado(recuperacao.expira_em)) {
      await pool.query('DELETE FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
      return falha(res, 400, 'O tempo limite expirou. Solicite uma nova recuperação.');
    }

    const decorrido = Math.floor((Date.now() - new Date(recuperacao.ultimo_envio_em).getTime()) / 1000);
    if (decorrido < ESPERA_REENVIO_S) {
      return falha(res, 429, `Aguarde ${ESPERA_REENVIO_S - decorrido}s para solicitar um novo código.`);
    }

    const novoCodigo = gerarCodigo();
    logarCodigoEmDev('novo código de recuperação', novoCodigo);
    const novoCodigoHash = await bcrypt.hash(novoCodigo, 10);

    // Zera também `verificado`: sem isso dava para validar um código, pedir
    // reenvio e manter a sessão já liberada.
    await pool.query(
      'UPDATE recuperacoes_senha SET codigo_hash = $1, tentativas = 0, verificado = FALSE, ultimo_envio_em = CURRENT_TIMESTAMP WHERE id = $2',
      [novoCodigoHash, idVerificacao]
    );

    const enviado = await enviarEmail(recuperacao.email, 'Seu novo código de recuperação', `Seu novo código de recuperação é: ${novoCodigo}`);
    if (!enviado) return falha(res, 500, 'Falha ao reenviar o e-mail.');

    return sucesso(res, { mensagem: 'Novo código enviado com sucesso!' });
  } catch (erro) {
    return falhaInterna(res, 'POST /api/auth/reenviar-esqueci', erro);
  }
});

app.post('/api/auth/validar-esqueci', limitarRecuperacaoEtapasIP, async (req, res) => {
  const { codigo, idVerificacao } = req.body || {};

  if (!ehTexto(codigo) || !ehTexto(idVerificacao) || !codigo || !idVerificacao) {
    return falha(res, 400, 'Dados incompletos.');
  }

  try {
    const resultado = await pool.query('SELECT * FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
    const recuperacao = resultado.rows[0];

    if (!recuperacao) return falha(res, 400, 'Verificação não encontrada ou expirada.');

    if (expirado(recuperacao.expira_em)) {
      await pool.query('DELETE FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
      return falha(res, 400, 'O tempo limite do código expirou. Solicite novamente.');
    }

    if (recuperacao.tentativas >= MAX_TENTATIVAS_CODIGO) {
      await pool.query('DELETE FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
      return falha(res, 429, 'Número máximo de tentativas excedido. Solicite novamente.');
    }

    const codigoConfere = await bcrypt.compare(codigo.trim(), recuperacao.codigo_hash);
    if (!codigoConfere) {
      await pool.query('UPDATE recuperacoes_senha SET tentativas = tentativas + 1 WHERE id = $1', [idVerificacao]);
      return falha(res, 400, 'Código incorreto.');
    }

    // Esta flag é o que libera /api/auth/confirmar-esqueci.
    await pool.query('UPDATE recuperacoes_senha SET verificado = TRUE WHERE id = $1', [idVerificacao]);
    return sucesso(res, { mensagem: 'Código válido. Pode definir nova senha.' });
  } catch (erro) {
    return falhaInterna(res, 'POST /api/auth/validar-esqueci', erro);
  }
});

app.post('/api/auth/confirmar-esqueci', limitarRecuperacaoEtapasIP, async (req, res) => {
  const { novaSenha, idVerificacao } = req.body || {};

  if (!ehTexto(novaSenha) || !ehTexto(idVerificacao) || !novaSenha || !idVerificacao) {
    return falha(res, 400, 'Dados incompletos.');
  }
  if (!validarSenhaForte(novaSenha)) return falha(res, 400, MSG_SENHA_FRACA);

  try {
    const resultado = await pool.query('SELECT * FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
    const recuperacao = resultado.rows[0];

    if (!recuperacao) return falha(res, 400, 'Verificação não encontrada ou expirada.');

    if (expirado(recuperacao.expira_em)) {
      await pool.query('DELETE FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
      return falha(res, 400, 'O tempo limite expirou. Solicite novamente.');
    }

    // Só troca a senha se o código já foi validado em /validar-esqueci.
    if (!recuperacao.verificado) {
      return falha(res, 403, 'Código ainda não foi validado. Confirme o código enviado por e-mail primeiro.');
    }

    const resultadoUsuario = await pool.query('SELECT id FROM usuarios WHERE email = $1', [recuperacao.email]);
    const usuarioRecuperacao = resultadoUsuario.rows[0];

    if (!usuarioRecuperacao) {
      await pool.query('DELETE FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
      return falha(res, 400, 'Verificação não encontrada ou expirada.');
    }

    const novaSenhaHash = await bcrypt.hash(novaSenha, 10);

    // Conferência do limite + troca na mesma transação (com trava do
    // usuário): impede burlar o limite abrindo várias sessões em paralelo.
    const limiteAtingido = await comTravaDoUsuario(pool, usuarioRecuperacao.id, async (client) => {
      if ((await contarRedefinicoesModalRecentes(client, usuarioRecuperacao.id)) >= LIMITE_REDEFINICOES_MODAL) {
        await client.query('DELETE FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
        return true;
      }

      // senha_redefinida_em trava o botão de redefinir da página de config (cooldown de 24h).
      await client.query(
        'UPDATE usuarios SET senha = $1, senha_redefinida_em = CURRENT_TIMESTAMP WHERE id = $2',
        [novaSenhaHash, usuarioRecuperacao.id]
      );
      await client.query(
        `INSERT INTO historico_redefinicoes_senha (usuario_id, origem) VALUES ($1, 'modal')`,
        [usuarioRecuperacao.id]
      );
      await client.query('DELETE FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
      return false;
    });

    if (limiteAtingido) return respostaLimiteRecuperacao(res);

    return sucesso(res, { mensagem: 'Senha alterada com sucesso! Faça login com a nova senha.' });
  } catch (erro) {
    return falhaInterna(res, 'POST /api/auth/confirmar-esqueci', erro);
  }
});

// ============================================================
// CONTA DO USUÁRIO / ARTISTA
// ============================================================

// Usada pelo front pra decidir se mostra o popup de "vire artista".
app.get('/api/usuarios/eu', verificarAutenticacao, async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT id, email, nome_usuario, eh_artista, nome_artista, senha_redefinida_em, bio, url_avatar
         FROM usuarios WHERE id = $1`,
      [req.usuario.id]
    );
    const usuario = resultado.rows[0];
    if (!usuario) return falha(res, 404, 'Usuário não encontrado.');

    return sucesso(res, { usuario });
  } catch (erro) {
    return falhaInterna(res, 'GET /api/usuarios/eu', erro);
  }
});

// Define/atualiza o nome de artista. Todo upload futuro usa esse nome.
app.post('/api/usuarios/artista', verificarAutenticacao, async (req, res) => {
  const { nomeArtista } = req.body || {};

  if (!ehTexto(nomeArtista) || !nomeArtista.trim()) {
    return falha(res, 400, 'Nome de artista é obrigatório.');
  }
  const nome = nomeArtista.trim();
  if (tamanhoEmCaracteres(nome) > NOME_ARTISTA_MAX) {
    return falha(res, 400, `O nome de artista pode ter no máximo ${NOME_ARTISTA_MAX} caracteres.`);
  }

  try {
    const usuario = await comTravaDoUsuario(pool, req.usuario.id, async (client) => {
      const resultado = await client.query(
        `UPDATE usuarios SET eh_artista = TRUE, nome_artista = $1
          WHERE id = $2
          RETURNING id, email, eh_artista, nome_artista`,
        [nome, req.usuario.id]
      );
      // musicas.artista é uma cópia do nome: mantém as músicas antigas em dia.
      await client.query('UPDATE musicas SET artista = $1 WHERE usuario_id = $2', [nome, req.usuario.id]);
      return resultado.rows[0];
    });

    return sucesso(res, { usuario });
  } catch (erro) {
    if (erro instanceof UsuarioInexistente) return falha(res, 404, 'Usuário não encontrado.');
    return falhaInterna(res, 'POST /api/usuarios/artista', erro);
  }
});

// ============================================================
// REDEFINIÇÃO DE SENHA (logado, via 2FA) — cooldown de 24h
// ============================================================

const limitarRedefinicaoIP = criarLimitador(15 * 60 * 1000, 10, 'Muitas tentativas a partir deste IP. Tente novamente mais tarde.');

app.post('/api/usuarios/redefinir-senha/solicitar', verificarAutenticacao, limitarRedefinicaoIP, async (req, res) => {
  const { novaSenha } = req.body || {};

  if (!ehTexto(novaSenha) || !validarSenhaForte(novaSenha)) {
    return falha(res, 400, 'A nova senha deve ter no mínimo 8 caracteres, incluindo pelo menos uma letra maiúscula, uma minúscula, um número e um caractere especial (@$!%*?&#).');
  }

  try {
    const resultadoUsuario = await pool.query(
      'SELECT email, senha_redefinida_em FROM usuarios WHERE id = $1',
      [req.usuario.id]
    );
    const usuarioLogado = resultadoUsuario.rows[0];
    if (!usuarioLogado) return falha(res, 404, 'Usuário não encontrado.');

    // Cooldown conferido no servidor (nunca confiar só no front).
    if (usuarioLogado.senha_redefinida_em) {
      const desdeUltimoReset = Date.now() - new Date(usuarioLogado.senha_redefinida_em).getTime();
      if (desdeUltimoReset < COOLDOWN_REDEFINICAO_MS) {
        return falha(res, 429, 'Você já redefiniu sua senha recentemente. Aguarde o cooldown de 24h.', {
          codigo: 'COOLDOWN_REDEFINICAO_ATIVO',
          restanteMs: COOLDOWN_REDEFINICAO_MS - desdeUltimoReset
        });
      }
    }

    const codigo = gerarCodigo();
    logarCodigoEmDev('código de redefinição', codigo);
    const novaSenhaHash = await bcrypt.hash(novaSenha, 10);
    const codigoHash = await bcrypt.hash(codigo, 10);
    const idRedefinicao = crypto.randomUUID();
    const expiraEm = new Date(Date.now() + EXPIRACAO_CODIGO_MS);

    await pool.query(
      `INSERT INTO redefinicoes_senha (id, usuario_id, nova_senha_hash, codigo_hash, tentativas, expira_em, ultimo_envio_em)
       VALUES ($1, $2, $3, $4, 0, $5, CURRENT_TIMESTAMP)`,
      [idRedefinicao, req.usuario.id, novaSenhaHash, codigoHash, expiraEm]
    );

    const enviado = await enviarEmail(
      usuarioLogado.email,
      'Código para redefinir sua senha',
      `Seu código de confirmação para redefinir a senha é: ${codigo}`
    );
    if (!enviado) {
      await pool.query('DELETE FROM redefinicoes_senha WHERE id = $1', [idRedefinicao]);
      return falha(res, 500, 'Falha ao enviar o e-mail com o código de verificação.');
    }

    return sucesso(res, { mensagem: 'Código enviado com sucesso!', idRedefinicao });
  } catch (erro) {
    return falhaInterna(res, 'POST /api/usuarios/redefinir-senha/solicitar', erro);
  }
});

app.post('/api/usuarios/redefinir-senha/confirmar', verificarAutenticacao, limitarRedefinicaoIP, async (req, res) => {
  const { codigo, idRedefinicao } = req.body || {};

  if (!ehTexto(codigo) || !ehTexto(idRedefinicao) || !codigo || !idRedefinicao) {
    return falha(res, 400, 'Dados incompletos.');
  }

  try {
    const resultado = await pool.query('SELECT * FROM redefinicoes_senha WHERE id = $1', [idRedefinicao]);
    const redefinicao = resultado.rows[0];

    if (!redefinicao) return falha(res, 400, 'Verificação não encontrada ou expirada.');

    // A verificação precisa pertencer ao usuário logado.
    if (redefinicao.usuario_id !== req.usuario.id) {
      return falha(res, 403, 'Verificação não pertence a este usuário.');
    }

    if (expirado(redefinicao.expira_em)) {
      await pool.query('DELETE FROM redefinicoes_senha WHERE id = $1', [idRedefinicao]);
      return falha(res, 400, 'O tempo limite do código expirou. Solicite novamente.');
    }

    if (redefinicao.tentativas >= MAX_TENTATIVAS_CODIGO) {
      await pool.query('DELETE FROM redefinicoes_senha WHERE id = $1', [idRedefinicao]);
      return falha(res, 429, 'Número máximo de tentativas excedido. Solicite novamente.');
    }

    const codigoConfere = await bcrypt.compare(codigo.trim(), redefinicao.codigo_hash);
    if (!codigoConfere) {
      await pool.query('UPDATE redefinicoes_senha SET tentativas = tentativas + 1 WHERE id = $1', [idRedefinicao]);
      return falha(res, 400, 'Código incorreto.');
    }

    await comTravaDoUsuario(pool, req.usuario.id, async (client) => {
      await client.query(
        'UPDATE usuarios SET senha = $1, senha_redefinida_em = CURRENT_TIMESTAMP WHERE id = $2',
        [redefinicao.nova_senha_hash, req.usuario.id]
      );
      await client.query(
        `INSERT INTO historico_redefinicoes_senha (usuario_id, origem) VALUES ($1, 'config')`,
        [req.usuario.id]
      );
      await client.query('DELETE FROM redefinicoes_senha WHERE id = $1', [idRedefinicao]);
    });

    return sucesso(res, { mensagem: 'Senha redefinida com sucesso!' });
  } catch (erro) {
    return falhaInterna(res, 'POST /api/usuarios/redefinir-senha/confirmar', erro);
  }
});

// ============================================================
// EXCLUSÃO DE CONTA (com frase de segurança)
// ============================================================

// Deleta a conta, as músicas e as playlists — irreversível. Frase exata:
// "eu desejo deletar <nome de usuário>" (ou e-mail, em contas sem nome).
app.delete('/api/usuarios/eu', verificarAutenticacao, async (req, res) => {
  const { fraseConfirmacao } = req.body || {};

  if (!ehTexto(fraseConfirmacao) || !fraseConfirmacao.trim()) {
    return falha(res, 400, 'Frase de confirmação é obrigatória.');
  }

  try {
    const resultadoUsuario = await pool.query(
      'SELECT email, nome_usuario, url_avatar, url_banner, url_fundo FROM usuarios WHERE id = $1',
      [req.usuario.id]
    );
    const usuarioLogado = resultadoUsuario.rows[0];
    if (!usuarioLogado) return falha(res, 404, 'Usuário não encontrado.');

    const identificador = usuarioLogado.nome_usuario || usuarioLogado.email;
    const fraseEsperada = `eu desejo deletar ${identificador}`;

    if (fraseConfirmacao.trim().toLowerCase() !== fraseEsperada.toLowerCase()) {
      return falha(res, 400, `Frase de confirmação incorreta. Digite exatamente: "${fraseEsperada}"`);
    }

    // URLs coletadas ANTES de apagar as linhas; os arquivos só são removidos
    // DEPOIS do commit (se a transação falhar, nada some do Storage).
    const [musicas, capasPlaylists] = await Promise.all([
      pool.query('SELECT url_audio, url_capa FROM musicas WHERE usuario_id = $1', [req.usuario.id]),
      pool.query('SELECT url_capa FROM playlists WHERE usuario_id = $1 AND url_capa IS NOT NULL', [req.usuario.id])
    ]);

    const urlsParaApagar = [
      usuarioLogado.url_avatar,
      // Banner e fundo são arquivos da conta tanto quanto avatar e capas:
      // sem eles aqui, apagar a conta deixaria os dois órfãos no Storage.
      usuarioLogado.url_banner,
      usuarioLogado.url_fundo,
      ...musicas.rows.flatMap((m) => [m.url_audio, m.url_capa]),
      ...capasPlaylists.rows.map((p) => p.url_capa)
    ].filter(Boolean);

    await comTravaDoUsuario(pool, req.usuario.id, async (client) => {
      // musicas.usuario_id não tem CASCADE: apagar as músicas primeiro.
      // Curtidas/favoritas/playlists (de qualquer usuário) que apontam para
      // elas caem por CASCADE.
      await client.query('DELETE FROM musicas WHERE usuario_id = $1', [req.usuario.id]);
      await client.query('DELETE FROM playlists WHERE usuario_id = $1', [req.usuario.id]);
      await client.query('DELETE FROM redefinicoes_senha WHERE usuario_id = $1', [req.usuario.id]);
      await client.query('DELETE FROM recuperacoes_senha WHERE email = $1', [usuarioLogado.email]);
      await client.query('DELETE FROM usuarios WHERE id = $1', [req.usuario.id]);
    });

    await removerArquivosDoStorage(supabase, SUPABASE_BUCKET, urlsParaApagar);

    return sucesso(res, { mensagem: 'Conta e músicas excluídas com sucesso.' });
  } catch (erro) {
    if (erro instanceof UsuarioInexistente) return falha(res, 404, 'Usuário não encontrado.');
    return falhaInterna(res, 'DELETE /api/usuarios/eu', erro);
  }
});

// ============================================================
// MÚSICAS
// ============================================================

const uploadMusica = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AUDIO_MAX_BYTES, files: 2 }
});

const limitarUploadIP = criarLimitador(60 * 60 * 1000, 20, 'Muitos uploads a partir deste IP. Tente novamente mais tarde.');

app.post(
  '/api/musicas',
  verificarAutenticacao,
  limitarUploadIP,
  tratarMulter(uploadMusica.fields([{ name: 'audio', maxCount: 1 }, { name: 'capa', maxCount: 1 }]), '25 MB'),
  async (req, res) => {
    const caminhosEnviados = [];

    try {
      const titulo = ehTexto(req.body?.titulo) ? req.body.titulo.trim() : '';
      const arquivoAudio = req.files?.audio?.[0];
      const arquivoCapa = req.files?.capa?.[0];
      logInfo('UPLOAD', 'Upload iniciado', { usuarioId: req.usuario.id });

      if (!titulo) return falha(res, 400, 'Título é obrigatório.');
      if (tamanhoEmCaracteres(titulo) > TITULO_MUSICA_MAX) {
        return falha(res, 400, `O título pode ter no máximo ${TITULO_MUSICA_MAX} caracteres.`);
      }
      if (!arquivoAudio) return falha(res, 400, 'O arquivo de áudio é obrigatório.');

      // O formato vem dos bytes reais, não do Content-Type declarado.
      const tipoAudio = detectarTipoAudio(arquivoAudio.buffer);
      if (!tipoAudio) return falha(res, 400, 'Formato de áudio não suportado. Use MP3, WAV ou OGG.');
      logInfo('UPLOAD', 'Arquivo de áudio validado', {
        tipo: tipoAudio.extensao,
        tamanhoBytes: arquivoAudio.size
      });

      let tipoCapa = null;
      if (arquivoCapa) {
        tipoCapa = detectarTipoImagem(arquivoCapa.buffer);
        if (!tipoCapa) return falha(res, 400, 'Formato de imagem não suportado. Use JPEG, PNG ou WEBP.');
        if (arquivoCapa.size > CAPA_MAX_BYTES) return falha(res, 413, 'A capa passa do limite de 5 MB. Escolha uma menor.');
        logInfo('UPLOAD', 'Capa validada', { tipo: tipoCapa.extensao, tamanhoBytes: arquivoCapa.size });
      } else {
        logInfo('UPLOAD', 'Upload sem capa');
      }

      // O nome de artista vem da conta, nunca do cliente.
      const resultadoUsuario = await pool.query(
        'SELECT eh_artista, nome_artista FROM usuarios WHERE id = $1',
        [req.usuario.id]
      );
      const usuarioLogado = resultadoUsuario.rows[0];

      if (!usuarioLogado || !usuarioLogado.eh_artista || !usuarioLogado.nome_artista) {
        logWarn('UPLOAD', 'Upload recusado: conta não é artista', { usuarioId: req.usuario.id });
        return falha(res, 403, 'Cadastre um nome de artista antes de enviar músicas.', { codigo: 'ARTISTA_NAO_CADASTADO' });
      }
      logInfo('UPLOAD', 'Usuário autenticado e é artista', { usuarioId: req.usuario.id });

      // Nomes gerados pelo servidor: nada de originalname (acentos/espaços
      // quebram a chave do Storage).
      const idUnico = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
      const caminhoAudio = `audio/${idUnico}.${tipoAudio.extensao}`;

      const { error: erroUploadAudio } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(caminhoAudio, arquivoAudio.buffer, { contentType: tipoAudio.mime });

      if (erroUploadAudio) {
        logError('ERROR', 'Falha ao enviar áudio ao Storage', { mensagem: erroUploadAudio.message });
        return falha(res, 500, 'Falha ao enviar o arquivo de áudio.');
      }
      caminhosEnviados.push(caminhoAudio);
      logInfo('UPLOAD', 'Upload de áudio para Storage concluído', { caminho: caminhoAudio });

      const urlAudio = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(caminhoAudio).data.publicUrl;

      let urlCapa = null;
      if (arquivoCapa) {
        const caminhoCapa = `capas/${idUnico}.${tipoCapa.extensao}`;
        const { error: erroUploadCapa } = await supabase.storage
          .from(SUPABASE_BUCKET)
          .upload(caminhoCapa, arquivoCapa.buffer, { contentType: tipoCapa.mime });

        if (erroUploadCapa) {
          // Melhor-esforço: a música é salva mesmo sem capa.
          logWarn('UPLOAD', 'Falha ao enviar a capa (música seguirá sem capa)', { mensagem: erroUploadCapa.message });
        } else {
          caminhosEnviados.push(caminhoCapa);
          urlCapa = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(caminhoCapa).data.publicUrl;
          logInfo('UPLOAD', 'Upload de capa concluído', { caminho: caminhoCapa });
        }
      }

      const resultado = await pool.query(
        `INSERT INTO musicas (titulo, artista, url_audio, url_capa, usuario_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [titulo, usuarioLogado.nome_artista, urlAudio, urlCapa, req.usuario.id]
      );

      logInfo('UPLOAD', 'Registro da música criado no PostgreSQL', { musicaId: resultado.rows[0].id });
      logInfo('UPLOAD', 'Upload concluído', { musicaId: resultado.rows[0].id });

      return sucesso(res, { musica: resultado.rows[0] }, 201);
    } catch (erro) {
      // Não deixa arquivo órfão no bucket se o banco falhou.
      if (caminhosEnviados.length > 0) {
        logWarn('UPLOAD', 'Iniciando rollback dos arquivos no Storage', { quantidade: caminhosEnviados.length });
        await supabase.storage.from(SUPABASE_BUCKET).remove(caminhosEnviados).catch(() => {});
        logInfo('UPLOAD', 'Rollback concluído');
      }
      return falhaInterna(res, 'POST /api/musicas', erro);
    }
  }
);

// Registra UMA reprodução (o front chama no evento 'play' do áudio).
// Exige sessão para visitante anônimo não inflar o ranking. O incremento é
// atômico dentro do Postgres.
app.post('/api/musicas/:id/reproduzir', verificarAutenticacao, async (req, res) => {
  const idMusica = paraIdValido(req.params.id);
  if (!idMusica) return falha(res, 400, 'ID de música inválido.');

  try {
    logInfo('PLAY', 'Requisição de reprodução recebida', { musicaId: idMusica, usuarioId: req.usuario.id });

    // Uma consulta só: o "antes" vem do mesmo RETURNING, sem ler a linha antes
    // de gravar (ler-e-depois-escrever abriria brecha para perda de contagem).
    const resultado = await pool.query(
      'UPDATE musicas SET reproducoes = reproducoes + 1 WHERE id = $1 RETURNING id, reproducoes',
      [idMusica]
    );
    if (resultado.rows.length === 0) {
      logWarn('PLAY', 'Reprodução não contabilizada: música não encontrada', { musicaId: idMusica });
      return falha(res, 404, 'Música não encontrada.');
    }

    logInfo('PLAY', 'Reprodução registrada', {
      musicaId: resultado.rows[0].id,
      reproducoes: resultado.rows[0].reproducoes
    });

    return sucesso(res, { musica: resultado.rows[0] });
  } catch (erro) {
    // Só loga: a reprodução da música no cliente NÃO depende desta resposta.
    return falhaInterna(res, 'POST /api/musicas/:id/reproduzir', erro);
  }
});

app.get('/api/musicas', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM musicas ORDER BY criado_em DESC LIMIT 50');
    logInfo('SERVER', 'Listagem de músicas', { quantidade: resultado.rows.length });
    return sucesso(res, { musicas: resultado.rows });
  } catch (erro) {
    return falhaInterna(res, 'GET /api/musicas', erro);
  }
});

// Ranking geral por reproduções acumuladas (não é mensal: não há histórico por data).
app.get('/api/musicas/mais-tocadas', async (req, res) => {
  try {
    logInfo('RANKING', 'Buscando músicas mais tocadas');
    const resultado = await pool.query(
      `SELECT id, titulo, artista, url_audio, url_capa, reproducoes, usuario_id, criado_em
         FROM musicas
        ORDER BY reproducoes DESC, criado_em DESC
        LIMIT 10`
    );
    logInfo('RANKING', 'Músicas mais tocadas retornadas', { quantidade: resultado.rows.length });
    return sucesso(res, { musicas: resultado.rows });
  } catch (erro) {
    return falhaInterna(res, 'GET /api/musicas/mais-tocadas', erro);
  }
});

// Agrupa por usuário (u.id) e NÃO pelo texto de musicas.artista: dois
// artistas com o mesmo nome artístico não podem se fundir num só.
app.get('/api/artistas/mais-ouvidos', async (req, res) => {
  try {
    logInfo('RANKING', 'Buscando artistas mais ouvidos');
    const resultado = await pool.query(
      `SELECT u.id AS usuario_id,
              u.nome_usuario,
              u.nome_artista AS artista,
              u.url_avatar AS avatar_url,
              COUNT(m.id)::int AS musicas,
              COALESCE(SUM(m.reproducoes), 0)::int AS reproducoes
         FROM usuarios u
         JOIN musicas m ON m.usuario_id = u.id
        WHERE u.eh_artista = TRUE
          AND u.nome_artista IS NOT NULL
          AND u.nome_artista <> ''
        GROUP BY u.id, u.nome_usuario, u.nome_artista, u.url_avatar
        ORDER BY reproducoes DESC, u.nome_artista ASC
        LIMIT 10`
    );
    logInfo('RANKING', 'Artistas mais ouvidos retornados', { quantidade: resultado.rows.length });
    return sucesso(res, { artistas: resultado.rows });
  } catch (erro) {
    return falhaInterna(res, 'GET /api/artistas/mais-ouvidos', erro);
  }
});

// Busca parcial e case-insensitive por título OU artista. Pública.
app.get('/api/musicas/buscar', async (req, res) => {
  const termo = ehTexto(req.query.q) ? req.query.q.trim() : '';
  if (!termo) return falha(res, 400, 'Digite um termo de busca.');

  try {
    // Escapa % _ \ para o usuário não montar curingas próprios.
    const padrao = `%${termo.slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`;
    const resultado = await pool.query(
      'SELECT * FROM musicas WHERE titulo ILIKE $1 OR artista ILIKE $1 ORDER BY criado_em DESC LIMIT 50',
      [padrao]
    );
    return sucesso(res, { musicas: resultado.rows });
  } catch (erro) {
    return falhaInterna(res, 'GET /api/musicas/buscar', erro);
  }
});

// "Minhas Músicas"
app.get('/api/musicas/minhas', verificarAutenticacao, async (req, res) => {
  try {
    const resultado = await pool.query(
      'SELECT * FROM musicas WHERE usuario_id = $1 ORDER BY criado_em DESC',
      [req.usuario.id]
    );
    return sucesso(res, { musicas: resultado.rows });
  } catch (erro) {
    return falhaInterna(res, 'GET /api/musicas/minhas', erro);
  }
});

// Só o dono exclui, e só 24h depois da postagem.
app.delete('/api/musicas/:id', verificarAutenticacao, async (req, res) => {
  const idMusica = paraIdValido(req.params.id);
  if (!idMusica) return falha(res, 400, 'ID de música inválido.');

  try {
    const resultado = await pool.query('SELECT * FROM musicas WHERE id = $1', [idMusica]);
    const musica = resultado.rows[0];

    if (!musica) return falha(res, 404, 'Música não encontrada.');
    if (musica.usuario_id !== req.usuario.id) {
      return falha(res, 403, 'Você só pode excluir suas próprias músicas.');
    }

    const desdePostagem = Date.now() - new Date(musica.criado_em).getTime();
    if (desdePostagem < COOLDOWN_EXCLUSAO_MUSICA_MS) {
      return falha(res, 429, 'Aguarde 24h após a postagem para poder excluir esta música.', {
        codigo: 'COOLDOWN_EXCLUSAO_ATIVO',
        restanteMs: COOLDOWN_EXCLUSAO_MUSICA_MS - desdePostagem
      });
    }

    // Banco primeiro; arquivos depois (melhor-esforço).
    await pool.query('DELETE FROM musicas WHERE id = $1 AND usuario_id = $2', [idMusica, req.usuario.id]);
    await removerArquivosDoStorage(supabase, SUPABASE_BUCKET, [musica.url_audio, musica.url_capa]);

    return sucesso(res, { mensagem: 'Música excluída com sucesso.' });
  } catch (erro) {
    return falhaInterna(res, 'DELETE /api/musicas/:id', erro);
  }
});

// ============================================================
// PLAYLISTS + FAVORITOS
// ============================================================

// "Favoritos" é criada sob demanda. O índice único parcial (database.js)
// garante uma só por usuário mesmo com requisições simultâneas.
async function obterOuCriarPlaylistFavoritos(usuarioId) {
  const buscar = () => pool.query(
    'SELECT * FROM playlists WHERE usuario_id = $1 AND eh_favoritos = TRUE ORDER BY id LIMIT 1',
    [usuarioId]
  );

  const existente = await buscar();
  if (existente.rows[0]) return existente.rows[0];

  await pool.query(
    `INSERT INTO playlists (nome, usuario_id, eh_favoritos, publica)
     VALUES ('Favoritos', $1, TRUE, FALSE)
     ON CONFLICT DO NOTHING`,
    [usuarioId]
  );
  return (await buscar()).rows[0];
}

const uploadCapaPlaylist = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CAPA_MAX_BYTES, files: 1 }
});

// Valida e normaliza o nome de uma playlist. Retorna { nome } ou { erro }.
function normalizarNomePlaylist(nomeBruto) {
  if (!ehTexto(nomeBruto)) return { erro: 'Dê um nome para a playlist.' };
  const nome = nomeBruto.trim().replace(/\s+/g, ' ');
  if (!nome) return { erro: 'Dê um nome para a playlist.' };
  if (tamanhoEmCaracteres(nome) > PLAYLIST_NOME_MAX) {
    return { erro: `O nome pode ter no máximo ${PLAYLIST_NOME_MAX} caracteres.` };
  }
  return { nome };
}

// Cria a playlist respeitando o limite por usuário (dentro da trava, pra
// várias criações simultâneas não passarem do limite). Favoritos não conta.
function criarPlaylist(usuarioId, nome, urlCapa) {
  return comTravaDoUsuario(pool, usuarioId, async (client) => {
    const total = await client.query(
      'SELECT COUNT(*)::int AS total FROM playlists WHERE usuario_id = $1 AND eh_favoritos = FALSE',
      [usuarioId]
    );
    if (total.rows[0].total >= PLAYLISTS_MAX_POR_USUARIO) throw new LimiteDePlaylists();

    const resultado = await client.query(
      `INSERT INTO playlists (nome, url_capa, usuario_id, eh_favoritos, publica)
       VALUES ($1, $2, $3, FALSE, TRUE) RETURNING *`,
      [nome, urlCapa, usuarioId]
    );
    return resultado.rows[0];
  });
}

const respostaLimitePlaylists = (res) =>
  falha(res, 409, `Você já tem ${PLAYLISTS_MAX_POR_USUARIO} playlists. Exclua uma antes de criar outra.`);

// Lista as playlists do usuário; Favoritos sempre primeiro.
app.get('/api/playlists', verificarAutenticacao, async (req, res) => {
  try {
    await obterOuCriarPlaylistFavoritos(req.usuario.id);

    // ?musicaId=X é opcional: cada playlist informa se já contém a música.
    const musicaId = paraIdValido(req.query.musicaId);

    const resultado = await pool.query(
      `SELECT p.*,
              (SELECT COUNT(*)::int FROM playlist_musicas pm WHERE pm.playlist_id = p.id) AS total_musicas,
              EXISTS (
                SELECT 1 FROM playlist_musicas pm
                 WHERE pm.playlist_id = p.id AND pm.musica_id = $2
              ) AS contem_musica
         FROM playlists p
        WHERE p.usuario_id = $1
        ORDER BY p.eh_favoritos DESC, p.criado_em ASC`,
      [req.usuario.id, musicaId]
    );
    return sucesso(res, { playlists: resultado.rows });
  } catch (erro) {
    return falhaInterna(res, 'GET /api/playlists', erro);
  }
});

// Cria uma playlist (nome obrigatório, capa opcional).
app.post('/api/playlists', verificarAutenticacao, tratarMulter(uploadCapaPlaylist.single('capa'), '5 MB'), async (req, res) => {
  const { nome, erro: erroNome } = normalizarNomePlaylist(req.body?.nome);
  if (erroNome) return falha(res, 400, erroNome);

  let caminhoCapa = null;

  try {
    let urlCapa = null;
    logInfo('PLAYLIST', 'Criação iniciada', { usuarioId: req.usuario.id });

    if (req.file) {
      const tipo = detectarTipoImagem(req.file.buffer);
      if (!tipo) return falha(res, 400, 'Formato de imagem não suportado. Use JPEG, PNG ou WEBP.');

      const caminho = `capas-playlist/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${tipo.extensao}`;
      const { error: erroUpload } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(caminho, req.file.buffer, { contentType: tipo.mime });

      if (erroUpload) {
        // Melhor-esforço: a playlist é criada mesmo sem capa.
        logWarn('PLAYLIST', 'Falha ao enviar a capa (playlist seguirá sem capa)', { mensagem: erroUpload.message });
      } else {
        caminhoCapa = caminho;
        urlCapa = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(caminho).data.publicUrl;
        logInfo('PLAYLIST', 'Capa enviada ao Storage', { caminho });
      }
    }

    const playlist = await criarPlaylist(req.usuario.id, nome, urlCapa);
    logInfo('PLAYLIST', 'Playlist criada', { playlistId: playlist.id });
    return sucesso(res, { playlist }, 201);
  } catch (erro) {
    if (caminhoCapa) await supabase.storage.from(SUPABASE_BUCKET).remove([caminhoCapa]).catch(() => {});
    if (erro instanceof UsuarioInexistente) return falha(res, 404, 'Usuário não encontrado.');
    if (erro instanceof LimiteDePlaylists) return respostaLimitePlaylists(res);
    return falhaInterna(res, 'POST /api/playlists', erro);
  }
});

// Detalhe + músicas — só o dono. Playlist de outra pessoa responde 404
// (igual a "não existe"), sem confirmar que o id existe.
app.get('/api/playlists/:id', verificarAutenticacao, async (req, res) => {
  const idPlaylist = paraIdValido(req.params.id);
  if (!idPlaylist) return falha(res, 400, 'ID de playlist inválido.');

  try {
    const resultadoPlaylist = await pool.query(
      'SELECT * FROM playlists WHERE id = $1 AND usuario_id = $2',
      [idPlaylist, req.usuario.id]
    );
    const playlist = resultadoPlaylist.rows[0];
    if (!playlist) return falha(res, 404, 'Playlist não encontrada.');

    // Ordem em que a música entrou na playlist: é essa ordem que o botão
    // "Tocar" respeita. O id desempata quando duas entraram no mesmo instante.
    const resultadoMusicas = await pool.query(
      `SELECT m.* FROM musicas m
         JOIN playlist_musicas pm ON pm.musica_id = m.id
        WHERE pm.playlist_id = $1
        ORDER BY pm.adicionado_em ASC, pm.id ASC`,
      [idPlaylist]
    );

    return sucesso(res, { playlist, musicas: resultadoMusicas.rows });
  } catch (erro) {
    return falhaInterna(res, 'GET /api/playlists/:id', erro);
  }
});

// Exclusão compartilhada por DELETE /api/playlists/:id e
// DELETE /api/perfil/playlists/:id. Só o dono apaga; Favoritos é protegida.
async function excluirPlaylistDoUsuario(req, res) {
  const idPlaylist = paraIdValido(req.params.id);
  if (!idPlaylist) return falha(res, 400, 'ID de playlist inválido.');

  try {
    logInfo('PLAYLIST', 'Exclusão solicitada', { playlistId: idPlaylist, usuarioId: req.usuario.id });

    const resultado = await pool.query(
      `DELETE FROM playlists
        WHERE id = $1 AND usuario_id = $2 AND eh_favoritos = FALSE
        RETURNING id, url_capa`,
      [idPlaylist, req.usuario.id]
    );

    if (resultado.rows.length === 0) {
      const propria = await pool.query(
        'SELECT eh_favoritos FROM playlists WHERE id = $1 AND usuario_id = $2',
        [idPlaylist, req.usuario.id]
      );
      if (propria.rows[0]?.eh_favoritos) {
        logWarn('PLAYLIST', 'Exclusão recusada: Favoritos é protegida', { playlistId: idPlaylist });
        return falha(res, 400, 'A playlist de Favoritos não pode ser excluída.');
      }
      // Mesma resposta para "não existe" e "é de outro": não revela o ID.
      logWarn('PLAYLIST', 'Exclusão sem efeito: playlist inexistente ou de outro usuário', { playlistId: idPlaylist });
      return falha(res, 404, 'Playlist não encontrada.');
    }

    await removerArquivoDoStorage(supabase, SUPABASE_BUCKET, resultado.rows[0].url_capa);
    logInfo('PLAYLIST', 'Playlist removida', { playlistId: idPlaylist });
    return sucesso(res, { mensagem: 'Playlist excluída.', id: idPlaylist });
  } catch (erro) {
    return falhaInterna(res, 'DELETE playlist', erro);
  }
}

app.delete('/api/playlists/:id', verificarAutenticacao, excluirPlaylistDoUsuario);

// Adiciona música à playlist (ON CONFLICT evita duplicar).
app.post('/api/playlists/:id/musicas', verificarAutenticacao, async (req, res) => {
  const idPlaylist = paraIdValido(req.params.id);
  const idMusica = paraIdValido((req.body || {}).musicaId);

  if (!idPlaylist || !idMusica) return falha(res, 400, 'Dados inválidos.');

  try {
    const playlist = await pool.query(
      'SELECT id FROM playlists WHERE id = $1 AND usuario_id = $2',
      [idPlaylist, req.usuario.id]
    );
    if (!playlist.rows[0]) return falha(res, 404, 'Playlist não encontrada.');

    const musicaExiste = await pool.query('SELECT 1 FROM musicas WHERE id = $1', [idMusica]);
    if (!musicaExiste.rows[0]) return falha(res, 404, 'Música não encontrada.');

    await pool.query(
      `INSERT INTO playlist_musicas (playlist_id, musica_id) VALUES ($1, $2)
       ON CONFLICT (playlist_id, musica_id) DO NOTHING`,
      [idPlaylist, idMusica]
    );

    logInfo('PLAYLIST', 'Música adicionada à playlist', { playlistId: idPlaylist, musicaId: idMusica });
    return sucesso(res, { mensagem: 'Música adicionada à playlist.' });
  } catch (erro) {
    if (ehMusicaSumida(erro)) return falha(res, 404, 'Música não encontrada.');
    return falhaInterna(res, 'POST /api/playlists/:id/musicas', erro);
  }
});

app.delete('/api/playlists/:id/musicas/:musicaId', verificarAutenticacao, async (req, res) => {
  const idPlaylist = paraIdValido(req.params.id);
  const idMusica = paraIdValido(req.params.musicaId);

  if (!idPlaylist || !idMusica) return falha(res, 400, 'Dados inválidos.');

  try {
    const playlist = await pool.query(
      'SELECT id FROM playlists WHERE id = $1 AND usuario_id = $2',
      [idPlaylist, req.usuario.id]
    );
    if (!playlist.rows[0]) return falha(res, 404, 'Playlist não encontrada.');

    await pool.query(
      'DELETE FROM playlist_musicas WHERE playlist_id = $1 AND musica_id = $2',
      [idPlaylist, idMusica]
    );

    logInfo('PLAYLIST', 'Música removida da playlist', { playlistId: idPlaylist, musicaId: idMusica });
    return sucesso(res, { mensagem: 'Música removida da playlist.' });
  } catch (erro) {
    return falhaInterna(res, 'DELETE /api/playlists/:id/musicas/:musicaId', erro);
  }
});

// Atalhos de favoritar/desfavoritar (usam a playlist Favoritos por baixo).
app.post('/api/musicas/:id/favoritar', verificarAutenticacao, async (req, res) => {
  const idMusica = paraIdValido(req.params.id);
  if (!idMusica) return falha(res, 400, 'ID de música inválido.');

  try {
    const musicaExiste = await pool.query('SELECT 1 FROM musicas WHERE id = $1', [idMusica]);
    if (!musicaExiste.rows[0]) return falha(res, 404, 'Música não encontrada.');

    const favoritos = await obterOuCriarPlaylistFavoritos(req.usuario.id);

    await pool.query(
      `INSERT INTO playlist_musicas (playlist_id, musica_id) VALUES ($1, $2)
       ON CONFLICT (playlist_id, musica_id) DO NOTHING`,
      [favoritos.id, idMusica]
    );

    logInfo('PLAYLIST', 'Música favoritada', { usuarioId: req.usuario.id, musicaId: idMusica });
    return sucesso(res, { mensagem: 'Música favoritada.' });
  } catch (erro) {
    if (ehMusicaSumida(erro)) return falha(res, 404, 'Música não encontrada.');
    return falhaInterna(res, 'POST /api/musicas/:id/favoritar', erro);
  }
});

app.delete('/api/musicas/:id/favoritar', verificarAutenticacao, async (req, res) => {
  const idMusica = paraIdValido(req.params.id);
  if (!idMusica) return falha(res, 400, 'ID de música inválido.');

  try {
    const favoritos = await obterOuCriarPlaylistFavoritos(req.usuario.id);

    await pool.query(
      'DELETE FROM playlist_musicas WHERE playlist_id = $1 AND musica_id = $2',
      [favoritos.id, idMusica]
    );

    return sucesso(res, { mensagem: 'Música removida dos favoritos.' });
  } catch (erro) {
    return falhaInterna(res, 'DELETE /api/musicas/:id/favoritar', erro);
  }
});

// IDs favoritados pelo usuário — o front usa pra pintar os corações.
app.get('/api/musicas/favoritos/ids', verificarAutenticacao, async (req, res) => {
  try {
    const favoritos = await obterOuCriarPlaylistFavoritos(req.usuario.id);

    const resultado = await pool.query(
      'SELECT musica_id FROM playlist_musicas WHERE playlist_id = $1',
      [favoritos.id]
    );

    return sucesso(res, { ids: resultado.rows.map((r) => r.musica_id) });
  } catch (erro) {
    return falhaInterna(res, 'GET /api/musicas/favoritos/ids', erro);
  }
});

// ============================================================
// PERFIL (bio, avatar, tema, música favorita, destaques, playlists)
// O usuário SEMPRE vem do token (req.usuario.id), nunca do corpo.
// ============================================================

async function lerFavorita(executor, usuarioId) {
  const resultado = await executor.query(
    `SELECT ${COLUNAS_MUSICA}
       FROM perfil_favorita f
       JOIN musicas m ON m.id = f.musica_id
      WHERE f.usuario_id = $1`,
    [usuarioId]
  );
  return resultado.rows[0] || null;
}

async function lerCurtidas(executor, usuarioId) {
  const resultado = await executor.query(
    `SELECT ${COLUNAS_MUSICA}
       FROM perfil_curtidas c
       JOIN musicas m ON m.id = c.musica_id
      WHERE c.usuario_id = $1
      ORDER BY c.posicao ASC`,
    [usuarioId]
  );
  return resultado.rows;
}

// Perfil completo numa resposta só.
app.get('/api/perfil', verificarAutenticacao, async (req, res) => {
  const usuarioId = req.usuario.id;

  try {
    const [usuarioRes, favorita, curtidas, playlistsRes, estatisticasRes] = await Promise.all([
      pool.query(
        `SELECT id, nome_usuario, nome_exibicao, eh_artista, nome_artista, bio,
                url_avatar AS avatar_url, url_banner AS banner_url, url_fundo AS fundo_url,
                personalizacao, status_emoji, status_texto, mostrar_ouvindo,
                tema, criado_em
           FROM usuarios WHERE id = $1`,
        [usuarioId]
      ),
      lerFavorita(pool, usuarioId),
      lerCurtidas(pool, usuarioId),
      // Favoritos é playlist do sistema: não aparece no perfil.
      pool.query(
        `SELECT p.id, p.nome, p.criado_em, COUNT(pm.musica_id)::int AS total_faixas
           FROM playlists p
           LEFT JOIN playlist_musicas pm ON pm.playlist_id = p.id
          WHERE p.usuario_id = $1 AND p.publica = TRUE AND p.eh_favoritos = FALSE
          GROUP BY p.id, p.nome, p.criado_em
          ORDER BY p.criado_em DESC, p.id DESC`,
        [usuarioId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS musicas_enviadas,
                COALESCE(SUM(reproducoes), 0)::int AS reproducoes
           FROM musicas WHERE usuario_id = $1`,
        [usuarioId]
      )
    ]);

    const usuario = usuarioRes.rows[0];
    if (!usuario) return falha(res, 404, 'Usuário não encontrado.');

    // Mesma regra da rota pública: o dono vê o próprio "ouvindo agora"
    // quando ligou o interruptor. Sem isto, o modo dono ficaria sem o
    // recurso que o modo visitante tem.
    const ouvindo = await lerOuvindoDe(usuarioId, usuario.mostrar_ouvindo);

    return sucesso(res, {
      perfil: {
        usuario,
        favorita,
        curtidas,
        playlists: playlistsRes.rows,
        estatisticas: estatisticasRes.rows[0],
        ouvindo,
        eh_dono: true
      }
    });
  } catch (erro) {
    return falhaInterna(res, 'GET /api/perfil', erro);
  }
});

// ---------- perfil público de outra pessoa ----------
// Qualquer pessoa, logada ou não, vê o perfil de outro usuário. Por isso
// o que sai daqui é uma lista positively fechada: cada campo foi escolhido
// por ser público por natureza. E-mail, tema, curtidas e qualquer estado
// do player NUNCA entram aqui — o `tema` é preferência de quem está
// usando aquele navegador, não dado do dono do perfil.

const limitarPerfilPublicoIP = criarLimitador(60 * 1000, 60, 'Muitas consultas de perfil a partir deste IP. Tente novamente mais tarde.');
const limitarBuscaPerfilIP = criarLimitador(60 * 1000, 40, 'Muitas buscas a partir deste IP. Tente novamente mais tarde.');

// Resolve o identificador da URL: primeiro como @ (sem diferenciar caixa),
// depois como id numérico. O @ vem primeiro porque é o identificador
// "de verdade" — e assim um @ que por acaso seja só números continua
// funcionando como @.
async function acharUsuarioPublico(identificador) {
  const porNome = await pool.query(
    'SELECT id FROM usuarios WHERE LOWER(nome_usuario) = LOWER($1) AND nome_usuario IS NOT NULL',
    [identificador]
  );
  if (porNome.rows[0]) return porNome.rows[0].id;

  if (/^\d+$/.test(identificador)) {
    const porId = await pool.query('SELECT id FROM usuarios WHERE id = $1', [Number(identificador)]);
    if (porId.rows[0]) return porId.rows[0].id;
  }
  return null;
}

// "Ouvindo agora" só sai daqui se o DONO LIGOU. Desligado, o campo nem
// entra na resposta — não é só escondido no front.
//
// Esta é a MESMA função nas duas rotas (privada e pública). Antes cada uma
// tinha a sua cópia, e só a pública tinha isto: o dono não enxergava o
// próprio "ouvindo agora" no próprio perfil.
async function lerOuvindoDe(usuarioId, mostrarOuvindo) {
  if (!mostrarOuvindo) return null;

  const estado = await obterEstadoPlayer(usuarioId);
  if (!estado.current_track) return null;

  // A música vai com os dados que o player precisa para tocar: id,
  // título, artista, url_audio e url_capa.
  return {
    musica: estado.current_track,
    tocando: estado.is_playing
  };
}

app.get('/api/perfil/publico/:identificador', limitarPerfilPublicoIP, verificarAutenticacaoOpcional, async (req, res) => {
  const identificador = ehTexto(req.params.identificador) ? req.params.identificador.trim() : '';
  if (!identificador) return falha(res, 400, 'Perfil não encontrado.');

  try {
    const usuarioId = await acharUsuarioPublico(identificador);
    // Mesma resposta para "não existe" e "erro": não confirma se o @ pertence
    // a alguém. Também não diz se a conta chegou a ser ativada.
    if (!usuarioId) return falha(res, 404, 'Perfil não encontrado.');

    const [usuarioRes, favorita, playlistsRes] = await Promise.all([
      pool.query(
        `SELECT nome_usuario, nome_exibicao, eh_artista, nome_artista, bio,
                url_avatar AS avatar_url, url_banner AS banner_url, url_fundo AS fundo_url,
                personalizacao, status_emoji, status_texto, mostrar_ouvindo, criado_em
           FROM usuarios WHERE id = $1`,
        [usuarioId]
      ),
      lerFavorita(pool, usuarioId),
      // Favoritos é a playlist do sistema e não aparece no perfil de ninguém.
      pool.query(
        `SELECT p.id, p.nome, p.criado_em, COUNT(pm.musica_id)::int AS total_faixas
           FROM playlists p
           LEFT JOIN playlist_musicas pm ON pm.playlist_id = p.id
          WHERE p.usuario_id = $1 AND p.publica = TRUE AND p.eh_favoritos = FALSE
          GROUP BY p.id, p.nome, p.criado_em
          ORDER BY p.criado_em DESC, p.id DESC`,
        [usuarioId]
      )
    ]);

    const usuario = usuarioRes.rows[0];
    if (!usuario) return falha(res, 404, 'Perfil não encontrado.');

    // "Ouvindo agora" só sai daqui se o DONO LIGOU. Desligado, o
    // campo nem entra na resposta — não é só escondido no front.
    const ouvindo = await lerOuvindoDe(usuarioId, usuario.mostrar_ouvindo);

    // Estatísticas só existem para artista; para os demais, nem a consulta é
    // feita, para não revelar número de nada sobre quem não publica música.
    let estatisticas = null;
    if (usuario.eh_artista) {
      const stats = await pool.query(
        `SELECT COUNT(*)::int AS musicas_enviadas,
                COALESCE(SUM(reproducoes), 0)::int AS reproducoes
           FROM musicas WHERE usuario_id = $1`,
        [usuarioId]
      );
      estatisticas = stats.rows[0];
    }

    return sucesso(res, {
      perfil: {
        usuario: {
          nome_usuario: usuario.nome_usuario,
          nome_exibicao: usuario.nome_exibicao,
          eh_artista: usuario.eh_artista,
          nome_artista: usuario.nome_artista,
          bio: usuario.bio,
          avatar_url: usuario.avatar_url,
          banner_url: usuario.banner_url,
          fundo_url: usuario.fundo_url,
          personalizacao: usuario.personalizacao,
          status_emoji: usuario.status_emoji,
          status_texto: usuario.status_texto,
          criado_em: usuario.criado_em
        },
        favorita,
        playlists: playlistsRes.rows,
        estatisticas,
        // null quando o dono não ligou a opção.
        ouvindo,
        // O front usa isso para escolher entre o modo dono e o modo
        // visitante sem precisar deduzir comparando strings.
        eh_dono: !!req.usuario && req.usuario.id === usuarioId
      }
    });
  } catch (erro) {
    return falhaInterna(res, 'GET /api/perfil/publico', erro);
  }
});

// Busca de pessoas para a barra de pesquisa. Devolve o mínimo para
// desenhar um resultado e montar o link do perfil — nada além disso.
app.get('/api/perfil/buscar', limitarBuscaPerfilIP, async (req, res) => {
  const termo = ehTexto(req.query.q) ? req.query.q.trim() : '';
  if (tamanhoEmCaracteres(termo) < 2) return falha(res, 400, 'Digite ao menos 2 letras para buscar.');

  try {
    const padrao = `%${termo.replace(/[%_]/g, '')}%`;
    const resultado = await pool.query(
      `SELECT nome_usuario,
              COALESCE(nome_artista, nome_exibicao, nome_usuario) AS nome,
              eh_artista,
              url_avatar AS avatar_url
         FROM usuarios
        WHERE nome_usuario IS NOT NULL
          AND (LOWER(nome_usuario) LIKE LOWER($1)
               OR LOWER(COALESCE(nome_exibicao, '')) LIKE LOWER($1)
               OR LOWER(COALESCE(nome_artista, '')) LIKE LOWER($1))
        ORDER BY nome_usuario ASC
        LIMIT 8`,
      [padrao]
    );
    return sucesso(res, { pessoas: resultado.rows });
  } catch (erro) {
    return falhaInterna(res, 'GET /api/perfil/buscar', erro);
  }
});

// ---------- nome de exibição ----------
app.put('/api/perfil/exibicao', verificarAutenticacao, async (req, res) => {
  const { nomeExibicao } = req.body || {};

  if (nomeExibicao !== null && !ehTexto(nomeExibicao)) {
    return falha(res, 400, 'O nome de exibição precisa ser um texto.');
  }

  // Aplica a mesma limpeza da bio: quebra de linha do Windows vira \n e
  // texto vazio vira NULL (aí a tela mostra o próprio @).
  const limpa = nomeExibicao === null ? '' : nomeExibicao.replace(/\r\n/g, '\n').trim();

  if (limpa && tamanhoEmCaracteres(limpa) > NOME_EXIBICAO_MAX) {
    return falha(res, 400, `O nome de exibição pode ter no máximo ${NOME_EXIBICAO_MAX} caracteres.`);
  }

  try {
    const resultado = await pool.query(
      'UPDATE usuarios SET nome_exibicao = $1 WHERE id = $2 RETURNING nome_exibicao',
      [limpa || null, req.usuario.id]
    );
    if (resultado.rows.length === 0) return falha(res, 404, 'Usuário não encontrado.');

    logInfo('PERFIL', 'Nome de exibição atualizado', {
      usuarioId: req.usuario.id,
      caracteres: tamanhoEmCaracteres(resultado.rows[0].nome_exibicao || '')
    });

    return sucesso(res, { nome_exibicao: resultado.rows[0].nome_exibicao });
  } catch (erro) {
    return falhaInterna(res, 'PUT /api/perfil/exibicao', erro);
  }
});

app.put('/api/perfil/bio', verificarAutenticacao, async (req, res) => {
  const { bio } = req.body || {};

  if (bio !== null && !ehTexto(bio)) return falha(res, 400, 'A bio precisa ser um texto.');

  // Normaliza quebra de linha do Windows; texto vazio vira NULL.
  const limpa = bio === null ? '' : bio.replace(/\r\n/g, '\n').trim();

  if (tamanhoEmCaracteres(limpa) > BIO_MAX) {
    return falha(res, 400, `A bio pode ter no máximo ${BIO_MAX} caracteres.`);
  }

  try {
    logInfo('PERFIL', 'Atualização de bio iniciada', { usuarioId: req.usuario.id });

    const resultado = await pool.query(
      'UPDATE usuarios SET bio = $1 WHERE id = $2 RETURNING bio',
      [limpa === '' ? null : limpa, req.usuario.id]
    );
    if (resultado.rows.length === 0) return falha(res, 404, 'Usuário não encontrado.');

    // A bio em si não é logada: é dado pessoal do usuário.
    logInfo('PERFIL', 'Bio atualizada', {
      usuarioId: req.usuario.id,
      caracteres: tamanhoEmCaracteres(resultado.rows[0].bio || '')
    });

    return sucesso(res, { bio: resultado.rows[0].bio });
  } catch (erro) {
    return falhaInterna(res, 'PUT /api/perfil/bio', erro);
  }
});

// ---------- avatar ----------

// Sem fileFilter de MIME: quem decide o formato são os bytes (detectarTipoImagem).
const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 }
});

const limitarAvatarIP = criarLimitador(60 * 60 * 1000, 30, 'Muitas trocas de avatar a partir deste IP. Tente novamente mais tarde.');

app.post(
  '/api/perfil/avatar',
  verificarAutenticacao,
  limitarAvatarIP,
  tratarMulter(uploadAvatar.single('avatar'), `${AVATAR_MAX_BYTES / (1024 * 1024)} MB`),
  async (req, res) => {
    const arquivo = req.file;
    if (!arquivo) return falha(res, 400, 'Envie uma imagem no campo "avatar".');

    const tipo = detectarTipoImagem(arquivo.buffer);
    if (!tipo) return falha(res, 400, 'Formato não suportado. Use JPEG, PNG ou WEBP.');

    const usuarioId = req.usuario.id;
    // Nome gerado pelo servidor (nunca o originalname do cliente).
    const caminhoNovo = `avatares/${usuarioId}-${Date.now()}.${tipo.extensao}`;

    logInfo('PERFIL', 'Upload de avatar iniciado', { usuarioId, tipo: tipo.extensao, tamanhoBytes: arquivo.size });

    try {
      const anterior = await pool.query('SELECT url_avatar FROM usuarios WHERE id = $1', [usuarioId]);
      if (anterior.rows.length === 0) return falha(res, 404, 'Usuário não encontrado.');
      const urlAnterior = anterior.rows[0].url_avatar;

      const { error: erroUpload } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(caminhoNovo, arquivo.buffer, { contentType: tipo.mime, cacheControl: '3600' });

      if (erroUpload) {
        logError('ERROR', 'Falha ao enviar avatar ao Storage', { mensagem: erroUpload.message });
        return falha(res, 500, 'Falha ao enviar a imagem.');
      }
      logInfo('PERFIL', 'Avatar enviado ao Storage', { caminho: caminhoNovo });

      const urlNova = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(caminhoNovo).data.publicUrl;

      try {
        await pool.query('UPDATE usuarios SET url_avatar = $1 WHERE id = $2', [urlNova, usuarioId]);
        logInfo('PERFIL', 'Banco atualizado com o novo avatar');
      } catch (erroBanco) {
        // Subiu mas o banco não registrou: desfaz o upload (sem órfão).
        logWarn('PERFIL', 'Banco falhou; desfazendo upload do avatar', { mensagem: erroBanco.message });
        await removerArquivoDoStorage(supabase, SUPABASE_BUCKET, urlNova);
        logInfo('PERFIL', 'Rollback do avatar concluído');
        throw erroBanco;
      }

      // Só agora que a nova está confirmada é seguro descartar a antiga.
      if (urlAnterior && urlAnterior !== urlNova) {
        await removerArquivoDoStorage(supabase, SUPABASE_BUCKET, urlAnterior);
        logInfo('PERFIL', 'Avatar anterior removido do Storage');
      }

      logInfo('PERFIL', 'Avatar atualizado com sucesso', { usuarioId });
      return sucesso(res, { avatar_url: urlNova });
    } catch (erro) {
      return falhaInterna(res, 'POST /api/perfil/avatar', erro);
    }
  }
);

app.delete('/api/perfil/avatar', verificarAutenticacao, async (req, res) => {
  try {
    logInfo('PERFIL', 'Remoção de avatar iniciada', { usuarioId: req.usuario.id });

    const anterior = await pool.query('SELECT url_avatar FROM usuarios WHERE id = $1', [req.usuario.id]);
    if (anterior.rows.length === 0) return falha(res, 404, 'Usuário não encontrado.');

    // Banco primeiro: mesmo que apagar o arquivo falhe, o perfil já não aponta pra ele.
    await pool.query('UPDATE usuarios SET url_avatar = NULL WHERE id = $1', [req.usuario.id]);
    logInfo('PERFIL', 'url_avatar atualizado para NULL');

    await removerArquivoDoStorage(supabase, SUPABASE_BUCKET, anterior.rows[0].url_avatar);
    logInfo('PERFIL', 'Arquivo removido do Storage');

    logInfo('PERFIL', 'Avatar removido', { usuarioId: req.usuario.id });
    return sucesso(res, { avatar_url: null });
  } catch (erro) {
    return falhaInterna(res, 'DELETE /api/perfil/avatar', erro);
  }
});

// ---------- personalização visual ----------

// Aceita GIF, que a detecção de avatar/capa não aceita de propósito:
// banner é uma faixa larga onde a animação tem sentido, avatar e capa são
// um quadro só. O limite é maior que o do avatar porque GIF pesa bem mais.
const BANNER_MAX_BYTES = 5 * 1024 * 1024;
const uploadBanner = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: BANNER_MAX_BYTES, files: 1 }
});

const limitarBannerIP = criarLimitador(60 * 60 * 1000, 20, 'Muitos envios de banner a partir deste IP. Tente novamente mais tarde.');

// Salva a personalização inteira. O corpo é o objeto já normalizado pelo
// frontend; o servidor normaliza de novo (whitelist + formato de cor) e é
// esse resultado que vale. Nunca se concatena nada do corpo direto no
// banco: o que vai para o JSONB passou pela lista fechada.
app.put('/api/perfil/personalizacao', verificarAutenticacao, async (req, res) => {
  const bruto = (req.body || {}).personalizacao;
  const limpa = normalizarPersonalizacao(bruto);

  try {
    // "|| '{}'" cobre o caso de chave ausente numa linha já gravada.
    const resultado = await pool.query(
      'UPDATE usuarios SET personalizacao = $1 WHERE id = $2 RETURNING personalizacao',
      [JSON.stringify(limpa), req.usuario.id]
    );
    if (resultado.rows.length === 0) return falha(res, 404, 'Usuário não encontrado.');

    logInfo('PERFIL', 'Personalização atualizada', { usuarioId: req.usuario.id });
    return sucesso(res, { personalizacao: resultado.rows[0].personalizacao });
  } catch (erro) {
    return falhaInterna(res, 'PUT /api/perfil/personalizacao', erro);
  }
});

// ---------- banner ----------
// Mesma sequência do avatar: valida pelos bytes, sobe, grava no banco,
// e só então apaga o anterior. Se o banco falhar depois do upload, o
// arquivo novo é removido para não sobrar órfão.

app.post(
  '/api/perfil/banner',
  verificarAutenticacao,
  limitarBannerIP,
  tratarMulter(uploadBanner.single('banner'), `${BANNER_MAX_BYTES / (1024 * 1024)} MB`),
  async (req, res) => {
    const arquivo = req.file;
    if (!arquivo) return falha(res, 400, 'Envie uma imagem no campo "banner".');

    const tipo = detectarTipoImagemComGif(arquivo.buffer);
    if (!tipo) {
      return falha(res, 400, 'Formato não suportado. Use JPEG, PNG, WEBP ou GIF.');
    }

    const usuarioId = req.usuario.id;
    // Nome gerado pelo servidor (nunca o originalname do cliente).
    const caminhoNovo = `banners/${usuarioId}-${Date.now()}.${tipo.extensao}`;

    logInfo('PERFIL', 'Upload de banner iniciado', { usuarioId, tipo: tipo.extensao, tamanhoBytes: arquivo.size });

    try {
      const anterior = await pool.query('SELECT url_banner FROM usuarios WHERE id = $1', [usuarioId]);
      if (anterior.rows.length === 0) return falha(res, 404, 'Usuário não encontrado.');
      const urlAnterior = anterior.rows[0].url_banner;

      const { error: erroUpload } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(caminhoNovo, arquivo.buffer, { contentType: tipo.mime, cacheControl: '3600' });

      if (erroUpload) {
        logError('ERROR', 'Falha ao enviar banner ao Storage', { mensagem: erroUpload.message });
        return falha(res, 500, 'Falha ao enviar a imagem.');
      }
      logInfo('PERFIL', 'Banner enviado ao Storage', { caminho: caminhoNovo });

      const urlNova = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(caminhoNovo).data.publicUrl;

      try {
        await pool.query('UPDATE usuarios SET url_banner = $1 WHERE id = $2', [urlNova, usuarioId]);
        logInfo('PERFIL', 'Banco atualizado com o novo banner');
      } catch (erroBanco) {
        // Subiu mas o banco não registrou: desfaz o upload (sem órfão).
        logWarn('PERFIL', 'Banco falhou; desfazendo upload do banner', { mensagem: erroBanco.message });
        await removerArquivoDoStorage(supabase, SUPABASE_BUCKET, urlNova);
        logInfo('PERFIL', 'Rollback do banner concluído');
        throw erroBanco;
      }

      // Só agora que a nova está confirmada é seguro descartar a antiga.
      if (urlAnterior && urlAnterior !== urlNova) {
        await removerArquivoDoStorage(supabase, SUPABASE_BUCKET, urlAnterior);
        logInfo('PERFIL', 'Banner anterior removido do Storage');
      }

      logInfo('PERFIL', 'Banner atualizado com sucesso', { usuarioId });
      return sucesso(res, { banner_url: urlNova });
    } catch (erro) {
      return falhaInterna(res, 'POST /api/perfil/banner', erro);
    }
  }
);

app.delete('/api/perfil/banner', verificarAutenticacao, async (req, res) => {
  try {
    logInfo('PERFIL', 'Remoção de banner iniciada', { usuarioId: req.usuario.id });

    const anterior = await pool.query('SELECT url_banner FROM usuarios WHERE id = $1', [req.usuario.id]);
    if (anterior.rows.length === 0) return falha(res, 404, 'Usuário não encontrado.');

    // Banco primeiro: mesmo que apagar o arquivo falhe, o perfil já não aponta pra ele.
    await pool.query('UPDATE usuarios SET url_banner = NULL WHERE id = $1', [req.usuario.id]);
    logInfo('PERFIL', 'url_banner atualizado para NULL');

    await removerArquivoDoStorage(supabase, SUPABASE_BUCKET, anterior.rows[0].url_banner);
    logInfo('PERFIL', 'Arquivo do banner removido do Storage');

    return sucesso(res, { banner_url: null });
  } catch (erro) {
    return falhaInterna(res, 'DELETE /api/perfil/banner', erro);
  }
});

// ---------- status e "ouvindo agora" ----------
// Uma rota só para os três: o que aparece ao lado do avatar. Todos os
// campos são opcionais, então dá para mexer no status sem tocar no
// interruptor de privacidade e vice-versa.
app.put('/api/perfil/status', verificarAutenticacao, async (req, res) => {
  const { emoji, texto, mostrarOuvindo } = req.body || {};

  // Só o que foi enviado muda; o resto fica como está.
  const mudancas = [];
  const valores = [];

  if (emoji !== undefined) {
    if (!ehTexto(emoji)) return falha(res, 400, 'O emoji do status precisa ser um texto.');
    const recortado = recortarPorGrafemas(emoji.trim(), STATUS_EMOJI_MAX);
    mudancas.push('status_emoji = $' + (valores.length + 1));
    valores.push(recortado || null);
  }

  if (texto !== undefined) {
    if (!ehTexto(texto)) return falha(res, 400, 'O texto do status precisa ser um texto.');
    const limpo = texto.replace(/\r\n/g, ' ').trim();
    if (contarGrafemas(limpo) > STATUS_TEXTO_MAX) {
      return falha(res, 400, `O status pode ter no máximo ${STATUS_TEXTO_MAX} caracteres.`);
    }
    mudancas.push('status_texto = $' + (valores.length + 1));
    valores.push(limpo || null);
  }

  if (mostrarOuvindo !== undefined) {
    if (typeof mostrarOuvindo !== 'boolean') {
      return falha(res, 400, 'A opção de mostrar o que você ouve precisa ser verdadeiro ou falso.');
    }
    mudancas.push('mostrar_ouvindo = $' + (valores.length + 1));
    valores.push(mostrarOuvindo);
  }

  if (mudancas.length === 0) return falha(res, 400, 'Nada para atualizar.');

  valores.push(req.usuario.id);
  try {
    const resultado = await pool.query(
      `UPDATE usuarios SET ${mudancas.join(', ')} WHERE id = $${valores.length}
       RETURNING status_emoji, status_texto, mostrar_ouvindo`,
      valores
    );
    if (resultado.rows.length === 0) return falha(res, 404, 'Usuário não encontrado.');

    const linha = resultado.rows[0];
    logInfo('PERFIL', 'Status atualizado', {
      usuarioId: req.usuario.id,
      temEmoji: !!linha.status_emoji,
      caracteres: contarGrafemas(linha.status_texto || ''),
      mostrarOuvindo: linha.mostrar_ouvindo
    });

    return sucesso(res, {
      status_emoji: linha.status_emoji,
      status_texto: linha.status_texto,
      mostrar_ouvindo: linha.mostrar_ouvindo
    });
  } catch (erro) {
    return falhaInterna(res, 'PUT /api/perfil/status', erro);
  }
});

// ---------- tema ----------

app.put('/api/perfil/tema', verificarAutenticacao, async (req, res) => {
  const { tema } = req.body || {};

  if (!TEMAS_VALIDOS.includes(tema)) return falha(res, 400, 'Tema inválido. Use "light" ou "dark".');

  try {
    const resultado = await pool.query(
      'UPDATE usuarios SET tema = $1 WHERE id = $2 RETURNING tema',
      [tema, req.usuario.id]
    );
    if (resultado.rows.length === 0) return falha(res, 404, 'Usuário não encontrado.');

    return sucesso(res, { tema: resultado.rows[0].tema });
  } catch (erro) {
    return falhaInterna(res, 'PUT /api/perfil/tema', erro);
  }
});

// ---------- música favorita ----------

app.put('/api/perfil/favorita', verificarAutenticacao, async (req, res) => {
  const musicaId = paraIdValido((req.body || {}).musicaId);
  if (!musicaId) return falha(res, 400, 'Escolha uma música válida.');

  try {
    const existe = await pool.query('SELECT id FROM musicas WHERE id = $1', [musicaId]);
    if (existe.rows.length === 0) return falha(res, 404, 'Música não encontrada.');

    // Upsert: a primeira vez insere, as próximas trocam a música.
    await pool.query(
      `INSERT INTO perfil_favorita (usuario_id, musica_id)
       VALUES ($1, $2)
       ON CONFLICT (usuario_id)
       DO UPDATE SET musica_id = EXCLUDED.musica_id, atualizado_em = CURRENT_TIMESTAMP`,
      [req.usuario.id, musicaId]
    );

    logInfo('PERFIL', 'Música favorita salva', { usuarioId: req.usuario.id, musicaId });
    return sucesso(res, { favorita: await lerFavorita(pool, req.usuario.id) });
  } catch (erro) {
    if (ehMusicaSumida(erro)) return falha(res, 404, 'Música não encontrada.');
    return falhaInterna(res, 'PUT /api/perfil/favorita', erro);
  }
});

app.delete('/api/perfil/favorita', verificarAutenticacao, async (req, res) => {
  try {
    await pool.query('DELETE FROM perfil_favorita WHERE usuario_id = $1', [req.usuario.id]);
    logInfo('PERFIL', 'Música favorita removida', { usuarioId: req.usuario.id });
    return sucesso(res, { favorita: null });
  } catch (erro) {
    return falhaInterna(res, 'DELETE /api/perfil/favorita', erro);
  }
});

// ---------- curtidas em destaque (lista inteira substituída de uma vez) ----------

app.put('/api/perfil/curtidas', verificarAutenticacao, async (req, res) => {
  const { musicaIds } = req.body || {};

  if (!Array.isArray(musicaIds)) return falha(res, 400, 'Envie a lista de músicas em "musicaIds".');
  if (musicaIds.length > CURTIDAS_MAX) return falha(res, 400, `Você pode destacar no máximo ${CURTIDAS_MAX} músicas.`);

  const ids = musicaIds.map(paraIdValido);
  if (ids.some((id) => id === null)) return falha(res, 400, 'A lista tem um id de música inválido.');
  if (new Set(ids).size !== ids.length) return falha(res, 400, 'A lista tem músicas repetidas.');

  try {
    logInfo('PERFIL', 'Atualização de curtidas iniciada', { usuarioId: req.usuario.id, quantidade: ids.length });

    // A trava serializa requisições do mesmo usuário (senão dois "salvar"
    // simultâneos violavam o UNIQUE ou gravavam uma lista misturada).
    const curtidas = await comTravaDoUsuario(pool, req.usuario.id, async (client) => {
      if (ids.length > 0) {
        const existentes = await client.query('SELECT id FROM musicas WHERE id = ANY($1::int[])', [ids]);
        if (existentes.rows.length !== ids.length) throw new MusicaInexistente();
      }

      // Tudo ou nada: falha no meio faz rollback da lista inteira.
      await client.query('DELETE FROM perfil_curtidas WHERE usuario_id = $1', [req.usuario.id]);
      for (let i = 0; i < ids.length; i++) {
        await client.query(
          'INSERT INTO perfil_curtidas (usuario_id, musica_id, posicao) VALUES ($1, $2, $3)',
          [req.usuario.id, ids[i], i + 1]
        );
      }
      return lerCurtidas(client, req.usuario.id);
    });

    logInfo('PERFIL', 'Curtidas atualizadas com sucesso', { usuarioId: req.usuario.id, quantidade: curtidas.length });
    return sucesso(res, { curtidas });
  } catch (erro) {
    if (erro instanceof UsuarioInexistente) return falha(res, 404, 'Usuário não encontrado.');
    if (ehMusicaSumida(erro)) return falha(res, 404, 'Alguma das músicas não existe mais.');
    return falhaInterna(res, 'PUT /api/perfil/curtidas', erro);
  }
});

// ---------- playlists do perfil ----------

app.post('/api/perfil/playlists', verificarAutenticacao, async (req, res) => {
  const { nome, erro: erroNome } = normalizarNomePlaylist((req.body || {}).nome);
  if (erroNome) return falha(res, 400, erroNome);

  try {
    const criada = await criarPlaylist(req.usuario.id, nome, null);
    return sucesso(
      res,
      { playlist: { id: criada.id, nome: criada.nome, criado_em: criada.criado_em, total_faixas: 0 } },
      201
    );
  } catch (erro) {
    if (erro instanceof UsuarioInexistente) return falha(res, 404, 'Usuário não encontrado.');
    if (erro instanceof LimiteDePlaylists) return respostaLimitePlaylists(res);
    return falhaInterna(res, 'POST /api/perfil/playlists', erro);
  }
});

app.delete('/api/perfil/playlists/:id', verificarAutenticacao, excluirPlaylistDoUsuario);

// ============================================================
// PLAYER GLOBAL — estado de reprodução e fila
// ============================================================

// Helper: busca estado do player (com as músicas resolvidas) ou devolve vazio.
// A fila no banco é só uma lista de ids; o front precisa de id/titulo/artista/
// url_audio/url_capa pra desenhar a barra e a lista sem refazer requisição.
async function obterEstadoPlayer(usuarioId) {
  const resultado = await pool.query(
    'SELECT current_track_id, progress_ms, is_playing, queue FROM user_player_state WHERE user_id = $1',
    [usuarioId]
  );

  if (!resultado.rows[0]) {
    return { current_track_id: null, current_track: null, progress_ms: 0, is_playing: false, queue: [], faixas: [] };
  }

  const estado = resultado.rows[0];
  const fila = Array.isArray(estado.queue) ? estado.queue.map(Number).filter(Number.isInteger) : [];
  const faixas = await buscarMusicas(fila);

  let atual = null;
  if (estado.current_track_id) {
    const achadas = await buscarMusicas([estado.current_track_id]);
    atual = achadas[0] || null;
  }

  return {
    current_track_id: atual ? atual.id : null,
    current_track: atual,
    progress_ms: estado.progress_ms || 0,
    is_playing: !!estado.is_playing,
    queue: faixas.map((f) => f.id),
    faixas
  };
}

// Busca as músicas dos ids informados preservando a ordem da fila.
async function buscarMusicas(ids) {
  if (!ids || ids.length === 0) return [];

  const resultado = await pool.query(
    `SELECT ${COLUNAS_MUSICA} FROM musicas m WHERE m.id = ANY($1::int[])`,
    [ids]
  );

  const porId = new Map(resultado.rows.map((m) => [m.id, m]));
  // Uma música apagada some da fila: o front só recebe o que ainda existe.
  return ids.map((id) => porId.get(id)).filter(Boolean);
}

// Helper: atualiza estado do player (upsert)
async function atualizarEstadoPlayer(usuarioId, dados) {
  const { current_track_id, progress_ms, is_playing, queue } = dados;
  await pool.query(
    `INSERT INTO user_player_state (user_id, current_track_id, progress_ms, is_playing, queue, updated_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id)
     DO UPDATE SET
       current_track_id = EXCLUDED.current_track_id,
       progress_ms = EXCLUDED.progress_ms,
       is_playing = EXCLUDED.is_playing,
       queue = EXCLUDED.queue,
       updated_at = CURRENT_TIMESTAMP`,
    [usuarioId, current_track_id, progress_ms, is_playing, JSON.stringify(queue || [])]
  );
}

// GET /api/player/state — busca estado completo (música atual + fila)
app.get('/api/player/state', verificarAutenticacao, async (req, res) => {
  try {
    const estado = await obterEstadoPlayer(req.usuario.id);
    return sucesso(res, { state: estado });
  } catch (erro) {
    return falhaInterna(res, 'GET /api/player/state', erro);
  }
});

// POST /api/player/queue — adiciona faixas ao final da fila
app.post('/api/player/queue', verificarAutenticacao, async (req, res) => {
  const { trackIds } = req.body || {};
  if (!Array.isArray(trackIds) || trackIds.length === 0) {
    return falha(res, 400, 'Envie um array "trackIds" com ao menos um ID.');
  }
  const ids = trackIds.map(paraIdValido);
  if (ids.some((id) => id === null)) return falha(res, 400, 'Lista contém ID de música inválido.');

  try {
    // Valida se todas as músicas existem
    const existentes = await pool.query('SELECT id FROM musicas WHERE id = ANY($1::int[])', [ids]);
    if (existentes.rows.length !== ids.length) {
      return falha(res, 404, 'Uma ou mais músicas não existem.');
    }

    const estado = await obterEstadoPlayer(req.usuario.id);
    const novaQueue = [...(estado.queue || []), ...ids];
    await atualizarEstadoPlayer(req.usuario.id, { ...estado, queue: novaQueue });

    return sucesso(res, { queue: novaQueue, faixas: await buscarMusicas(novaQueue) });
  } catch (erro) {
    if (ehMusicaSumida(erro)) return falha(res, 404, 'Alguma das músicas não existe mais.');
    return falhaInterna(res, 'POST /api/player/queue', erro);
  }
});

// PATCH /api/player/queue/reorder — reordena a fila
app.patch('/api/player/queue/reorder', verificarAutenticacao, async (req, res) => {
  const { queue } = req.body || {};
  if (!Array.isArray(queue)) return falha(res, 400, 'Envie o array "queue" com a nova ordem.');

  const ids = queue.map(paraIdValido);
  if (ids.some((id) => id === null)) return falha(res, 400, 'Lista contém ID de música inválido.');

  try {
    const existentes = await pool.query('SELECT id FROM musicas WHERE id = ANY($1::int[])', [ids]);
    if (existentes.rows.length !== ids.length) {
      return falha(res, 404, 'Uma ou mais músicas não existem.');
    }

    const estado = await obterEstadoPlayer(req.usuario.id);
    await atualizarEstadoPlayer(req.usuario.id, { ...estado, queue: ids });

    return sucesso(res, { queue: ids, faixas: await buscarMusicas(ids) });
  } catch (erro) {
    if (ehMusicaSumida(erro)) return falha(res, 404, 'Alguma das músicas não existe mais.');
    return falhaInterna(res, 'PATCH /api/player/queue/reorder', erro);
  }
});

// DELETE /api/player/queue/:trackId — remove uma faixa da fila
app.delete('/api/player/queue/:trackId', verificarAutenticacao, async (req, res) => {
  const trackId = paraIdValido(req.params.trackId);
  if (!trackId) return falha(res, 400, 'ID de música inválido.');

  try {
    const estado = await obterEstadoPlayer(req.usuario.id);
    const novaQueue = (estado.queue || []).filter((id) => id !== trackId);
    await atualizarEstadoPlayer(req.usuario.id, { ...estado, queue: novaQueue });

    return sucesso(res, { queue: novaQueue, faixas: await buscarMusicas(novaQueue) });
  } catch (erro) {
    return falhaInterna(res, 'DELETE /api/player/queue/:trackId', erro);
  }
});

// PUT /api/player/state — atualiza música atual, progresso e estado de play
app.put('/api/player/state', verificarAutenticacao, async (req, res) => {
  const { current_track_id, progress_ms, is_playing } = req.body || {};

  if (current_track_id !== undefined && current_track_id !== null) {
    const id = paraIdValido(current_track_id);
    if (!id) return falha(res, 400, 'ID de música inválido.');
    const existe = await pool.query('SELECT 1 FROM musicas WHERE id = $1', [id]);
    if (!existe.rows[0]) return falha(res, 404, 'Música não encontrada.');
  }

  try {
    const estado = await obterEstadoPlayer(req.usuario.id);
    const novoEstado = {
      current_track_id: current_track_id !== undefined ? current_track_id : estado.current_track_id,
      progress_ms: typeof progress_ms === 'number' ? progress_ms : estado.progress_ms,
      is_playing: typeof is_playing === 'boolean' ? is_playing : estado.is_playing,
      queue: estado.queue
    };
    await atualizarEstadoPlayer(req.usuario.id, novoEstado);

    return sucesso(res, { state: { ...novoEstado, ...(await obterEstadoPlayer(req.usuario.id)) } });
  } catch (erro) {
    return falhaInterna(res, 'PUT /api/player/state', erro);
  }
});

// ============================================================
// FINAL: rota inexistente + tratador de erros (sempre por último)
// ============================================================

// Rota que não existe responde JSON e loga qual foi — o "404 misterioso"
// deixa de ser um "Cannot GET ..." em HTML.
app.use((req, res) => {
  logWarn('HTTP', '404 sem rota', { metodo: req.method, rota: req.originalUrl });
  return falha(res, 404, 'Rota não encontrada.');
});

app.use((erro, req, res, next) => {
  if (erro && erro.type === 'entity.parse.failed') {
    logWarn('ERROR', 'JSON malformado no corpo da requisição', { rota: req.originalUrl });
    return falha(res, 400, 'Corpo da requisição inválido (JSON malformado).');
  }
  if (erro instanceof multer.MulterError) {
    logWarn('ERROR', 'Erro do Multer', { rota: req.originalUrl, codigo: erro.code });
    return falha(res, erro.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
      erro.code === 'LIMIT_FILE_SIZE' ? 'O arquivo enviado é grande demais. Escolha um arquivo menor.' : 'Não foi possível ler o arquivo enviado.');
  }
  // Última rede de segurança: erro que nenhuma rota capturou.
  logError('ERROR', 'Erro não tratado', {
    metodo: req.method,
    rota: req.originalUrl,
    codigo: erro.code,
    mensagem: erro.message
  });
  return falha(res, 500, 'Erro interno no servidor.');
});

// ============================================================
// LIMPEZA PERIÓDICA + INICIALIZAÇÃO
// ============================================================

// Verificações expiradas nunca eram apagadas se o usuário abandonasse o fluxo.
async function limparExpirados() {
  try {
    await pool.query('DELETE FROM verificacoes_2fa WHERE expira_em < CURRENT_TIMESTAMP');
    await pool.query('DELETE FROM recuperacoes_senha WHERE expira_em < CURRENT_TIMESTAMP');
    await pool.query('DELETE FROM redefinicoes_senha WHERE expira_em < CURRENT_TIMESTAMP');
  } catch (erro) {
    logError('SERVER', 'Erro na limpeza de verificações expiradas', { erro: erro.message });
  }
}

(async () => {
  logInfo('SERVER', 'Iniciando OpenSound');
  logInfo('DB', 'Inicialização do banco iniciada');
  
  // Só aceita requisições depois de o schema estar pronto.
  const schemaOk = await pool.pronto;
  if (!schemaOk) {
    logError('DB', 'Falha ao iniciar banco');
  } else {
    logInfo('DB', 'Tabelas/migrações verificadas');
  }

  await limparExpirados();
  setInterval(limparExpirados, 30 * 60 * 1000).unref();

  const porta = process.env.PORT || 3000;
  app.listen(porta, () => {
    logInfo('SERVER', `Servidor iniciado na porta ${porta}`);
    garantirBucket();
  });
})();