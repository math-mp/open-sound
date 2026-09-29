require('dotenv').config(); // Puxa variáveis globais do .env
const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const pool = require('./database'); // Importa a conexão com o PostgreSQL
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const crypto = require('crypto');
const { supabase, SUPABASE_BUCKET, garantirBucket } = require('./storage');
const {
  tamanhoEmCaracteres,
  detectarTipoImagem,
  comTravaDoUsuario,
  UsuarioInexistente,
  removerArquivoDoStorage,
  ehViolacaoDeChave
} = require('./ajudantes');

const app = express();
app.use(cors());
app.use(express.json());

// CORREÇÃO: sem fallback fraco hardcoded. Se a variável não existir,
// o servidor para na inicialização em vez de rodar com um segredo previsível.
const JWT_SECRET_SESSAO = process.env.JWT_SECRET_SESSAO;
if (!JWT_SECRET_SESSAO) {
  throw new Error('JWT_SECRET_SESSAO precisa estar definido no .env. Defina um valor forte antes de subir o servidor.');
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  },
  tls: { rejectUnauthorized: false }
});

// Funções de validação via RegEx
function validarEmail(email) {
  const regexEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regexEmail.test(email);
}

function validarSenhaForte(senha) {
  const regexSenha = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@()!%*?&#])[A-Za-z\d@()!%*?&#]{8,}$/;
  return regexSenha.test(senha);
}

const limitarRegistroIP = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    status: 'erro',
    mensagem: 'Muitas tentativas de registro a partir deste IP. Tente novamente mais tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.post('/api/registro', limitarRegistroIP, async (req, res) => {
  const { email, password, nomeUsuario } = req.body;

  if (!email || !password || !nomeUsuario || !nomeUsuario.trim()) {
    return res.status(400).json({ status: 'erro', mensagem: 'E-mail, senha e nome de usuário são obrigatórios.' });
  }

  if (!validarEmail(email)) {
    return res.status(400).json({ status: 'erro', mensagem: 'Por favor, insira um e-mail válido.' });
  }

  if (!validarSenhaForte(password)) {
    return res.status(400).json({
      status: 'erro',
      mensagem: 'A senha deve ter no mínimo 8 caracteres, incluindo pelo menos uma letra maiúscula, uma minúscula, um número e um caractere especial (@$!%*?&#).'
    });
  }

  try {
    const usuarioExistente = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (usuarioExistente.rows.length > 0) {
      return res.status(400).json({
        status: 'erro',
        codigo: 'EMAIL_JA_CADASTRADO',
        mensagem: 'Este e-mail já está cadastrado. Por favor, faça login.'
      });
    }

    const codigo = crypto.randomInt(100000, 1000000).toString();
    console.log(`codigo 2fa ${codigo}`);
    const senhaHash = await bcrypt.hash(password, 10);
    const codigoHash = await bcrypt.hash(codigo, 10);
    const idVerificacao = crypto.randomUUID();
    const expiraEm = new Date(Date.now() + 10 * 60 * 1000);

    const queryInsertVerificacao = `
      INSERT INTO verificacoes_2fa (id, email, senha_hash, nome_usuario, codigo_hash, tentativas, expira_em, ultimo_envio_em)
      VALUES ($1, $2, $3, $4, $5, 0, $6, CURRENT_TIMESTAMP)
    `;
    await pool.query(queryInsertVerificacao, [idVerificacao, email, senhaHash, nomeUsuario.trim(), codigoHash, expiraEm]);

    try {
      await transporter.sendMail({
        from: `"Open sound" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: 'Seu código de verificação 2FA',
        text: `Seu código de confirmação é: ${codigo}`
      });
    } catch (erroMail) {
      console.error('Erro ao enviar e-mail pelo Nodemailer:', erroMail);
      await pool.query('DELETE FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);
      return res.status(500).json({ status: 'erro', mensagem: 'Falha ao enviar o e-mail com o código de verificação.' });
    }

    return res.status(200).json({
      status: 'sucesso',
      mensagem: 'Código enviado com sucesso!',
      idVerificacao
    });

  } catch (erro) {
    console.error('Erro no servidor durante o registro:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

const limitarValidacaoIP = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    status: 'erro',
    mensagem: 'Muitas tentativas de verificação. Tente novamente mais tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.post('/api/validar-2fa', limitarValidacaoIP, async (req, res) => {
  const { codigo, idVerificacao } = req.body;

  if (!codigo || !idVerificacao) {
    return res.status(400).json({ status: 'erro', mensagem: 'Dados incompletos.' });
  }

  try {
    const resultado = await pool.query('SELECT * FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);
    const verificacao = resultado.rows[0];

    if (!verificacao) {
      return res.status(400).json({ status: 'erro', mensagem: 'Verificação não encontrada ou expirada.' });
    }

    if (new Date(verificacao.expira_em) < new Date()) {
      await pool.query('DELETE FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);
      return res.status(400).json({ status: 'erro', mensagem: 'O tempo limite do código expirou. Solicite um novo cadastro.' });
    }

    if (verificacao.tentativas >= 5) {
      await pool.query('DELETE FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);
      return res.status(429).json({ status: 'erro', mensagem: 'Número máximo de tentativas excedido. Solicite um novo cadastro.' });
    }

    const codigoConfere = await bcrypt.compare(codigo.trim(), verificacao.codigo_hash);

    if (!codigoConfere) {
      await pool.query('UPDATE verificacoes_2fa SET tentativas = tentativas + 1 WHERE id = $1', [idVerificacao]);
      return res.status(400).json({ status: 'erro', mensagem: 'Código 2FA incorreto.' });
    }

    const queryInsert = `
      INSERT INTO usuarios (email, senha, nome_usuario, verificado)
      VALUES ($1, $2, $3, TRUE)
    `;
    await pool.query(queryInsert, [verificacao.email, verificacao.senha_hash, verificacao.nome_usuario]);

    await pool.query('DELETE FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);

    return res.status(200).json({ status: 'sucesso', mensagem: 'Conta registrada e ativada com sucesso!' });

  } catch (erro) {
    console.error('Erro na validação 2FA:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

const limitarReenvioIP = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: {
    status: 'erro',
    mensagem: 'Você excedeu o limite de 5 tentativas por hora. Tente novamente mais tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.post('/api/reenviar-2fa', limitarReenvioIP, async (req, res) => {
  const { idVerificacao } = req.body;

  if (!idVerificacao) {
    return res.status(400).json({ status: 'erro', mensagem: 'Sessão inválida ou expirada.' });
  }

  try {
    const resultado = await pool.query('SELECT * FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);
    const verificacao = resultado.rows[0];

    if (!verificacao) {
      return res.status(400).json({ status: 'erro', mensagem: 'Sessão inválida ou expirada.' });
    }

    if (new Date(verificacao.expira_em) < new Date()) {
      await pool.query('DELETE FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);
      return res.status(400).json({ status: 'erro', mensagem: 'O tempo limite expirou. Solicite um novo cadastro.' });
    }

    const agora = Date.now();
    const tempoDecorrido = Math.floor((agora - new Date(verificacao.ultimo_envio_em).getTime()) / 1000);

    if (tempoDecorrido < 60) {
      const segundosRestantes = 60 - tempoDecorrido;
      return res.status(429).json({
        status: 'erro',
        mensagem: `Aguarde ${segundosRestantes}s para solicitar um novo código.`
      });
    }

    const novoCodigo = Math.floor(100000 + Math.random() * 900000).toString();
    const novoCodigoHash = await bcrypt.hash(novoCodigo, 10);

    await pool.query(
      'UPDATE verificacoes_2fa SET codigo_hash = $1, tentativas = 0, ultimo_envio_em = CURRENT_TIMESTAMP WHERE id = $2',
      [novoCodigoHash, idVerificacao]
    );

    try {
      await transporter.sendMail({
        from: `"Open sound" <${process.env.GMAIL_USER}>`,
        to: verificacao.email,
        subject: 'Seu novo código de verificação 2FA',
        text: `Seu novo código de confirmação é: ${novoCodigo}`
      });
    } catch (erroMail) {
      console.error('Erro no Nodemailer durante reenvio:', erroMail);
      return res.status(500).json({ status: 'erro', mensagem: 'Falha ao reenviar o e-mail de verificação.' });
    }

    return res.status(200).json({
      status: 'sucesso',
      mensagem: 'Novo código enviado com sucesso!'
    });

  } catch (erro) {
    console.error('Erro ao reenviar código:', erro);
    return res.status(400).json({ status: 'erro', mensagem: 'Sessão inválida ou token corrompido.' });
  }
});

// ============================================================
// RECUPERAÇÃO DE SENHA — "ESQUECI MINHA SENHA" (público, sem auth)
// ============================================================

const limitarRecuperacaoIP = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    status: 'erro',
    mensagem: 'Muitas tentativas de recuperação a partir deste IP. Tente novamente mais tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Limite de redefinições de senha pelo modal "esqueci minha senha":
// no máximo 3 concluídas por conta dentro de uma janela de 24h.
const LIMITE_REDEFINICOES_MODAL = 3;
const JANELA_REDEFINICOES_MODAL_HORAS = 24;

async function contarRedefinicoesModalRecentes(usuarioId) {
  const resultado = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM historico_redefinicoes_senha
     WHERE usuario_id = $1
       AND origem = 'modal'
       AND criado_em > CURRENT_TIMESTAMP - ($2 || ' hours')::interval`,
    [usuarioId, String(JANELA_REDEFINICOES_MODAL_HORAS)]
  );
  return resultado.rows[0].total;
}

// POST /api/auth/esqueci-senha — inicia recuperação (envia código por e-mail)
app.post('/api/auth/esqueci-senha', limitarRecuperacaoIP, async (req, res) => {
  const { email } = req.body;

  if (!email || !validarEmail(email)) {
    return res.status(400).json({ status: 'erro', mensagem: 'E-mail válido é obrigatório.' });
  }

  try {
    const resultadoUsuario = await pool.query('SELECT id, email FROM usuarios WHERE email = $1', [email]);
    const usuario = resultadoUsuario.rows[0];

    // Sempre retorna sucesso para não revelar se e-mail existe (segurança)
    // Mas só envia e-mail se usuário existir
    if (!usuario) {
      return res.status(200).json({ status: 'sucesso', mensagem: 'Se o e-mail estiver cadastrado, enviaremos um código.', idVerificacao: null });
    }

    // Limite de redefinições pelo modal: barra antes de gerar código/enviar e-mail.
    const redefinicoesRecentes = await contarRedefinicoesModalRecentes(usuario.id);
    if (redefinicoesRecentes >= LIMITE_REDEFINICOES_MODAL) {
      return res.status(429).json({
        status: 'erro',
        codigo: 'LIMITE_RECUPERACAO_ATINGIDO',
        mensagem: `Você atingiu o limite de ${LIMITE_REDEFINICOES_MODAL} redefinições de senha em ${JANELA_REDEFINICOES_MODAL_HORAS}h. Tente novamente mais tarde.`
      });
    }

    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    const codigoHash = await bcrypt.hash(codigo, 10);
    const idRecuperacao = crypto.randomUUID();
    const expiraEm = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `INSERT INTO recuperacoes_senha (id, email, codigo_hash, tentativas, expira_em, ultimo_envio_em)
       VALUES ($1, $2, $3, 0, $4, CURRENT_TIMESTAMP)`,
      [idRecuperacao, email, codigoHash, expiraEm]
    );

    try {
      await transporter.sendMail({
        from: `"Open sound" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: 'Código para recuperar sua senha',
        text: `Seu código de recuperação é: ${codigo}`
      });
    } catch (erroMail) {
      console.error('Erro ao enviar e-mail de recuperação:', erroMail);
      await pool.query('DELETE FROM recuperacoes_senha WHERE id = $1', [idRecuperacao]);
      return res.status(500).json({ status: 'erro', mensagem: 'Falha ao enviar o e-mail com o código.' });
    }

    return res.status(200).json({
      status: 'sucesso',
      mensagem: 'Código enviado com sucesso!',
      idVerificacao: idRecuperacao
    });

  } catch (erro) {
    console.error('Erro ao solicitar recuperação de senha:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// POST /api/auth/reenviar-esqueci — reenvia código
const limitarReenviarRecuperacaoIP = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: {
    status: 'erro',
    mensagem: 'Você excedeu o limite de 5 reenvios por hora. Tente novamente mais tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.post('/api/auth/reenviar-esqueci', limitarReenviarRecuperacaoIP, async (req, res) => {
  const { idVerificacao } = req.body;

  if (!idVerificacao) {
    return res.status(400).json({ status: 'erro', mensagem: 'Sessão inválida ou expirada.' });
  }

  try {
    const resultado = await pool.query('SELECT * FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
    const recuperacao = resultado.rows[0];

    if (!recuperacao) {
      return res.status(400).json({ status: 'erro', mensagem: 'Sessão inválida ou expirada.' });
    }

    if (new Date(recuperacao.expira_em) < new Date()) {
      await pool.query('DELETE FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
      return res.status(400).json({ status: 'erro', mensagem: 'O tempo limite expirou. Solicite uma nova recuperação.' });
    }

    const agora = Date.now();
    const tempoDecorrido = Math.floor((agora - new Date(recuperacao.ultimo_envio_em).getTime()) / 1000);

    if (tempoDecorrido < 60) {
      const segundosRestantes = 60 - tempoDecorrido;
      return res.status(429).json({
        status: 'erro',
        mensagem: `Aguarde ${segundosRestantes}s para solicitar um novo código.`
      });
    }

    const novoCodigo = Math.floor(100000 + Math.random() * 900000).toString();
    const novoCodigoHash = await bcrypt.hash(novoCodigo, 10);

    // CORREÇÃO: zera também a flag `verificado`. Sem isso, alguém poderia
    // validar um código, pedir reenvio e manter a sessão já liberada.
    await pool.query(
      'UPDATE recuperacoes_senha SET codigo_hash = $1, tentativas = 0, verificado = FALSE, ultimo_envio_em = CURRENT_TIMESTAMP WHERE id = $2',
      [novoCodigoHash, idVerificacao]
    );

    try {
      await transporter.sendMail({
        from: `"Open sound" <${process.env.GMAIL_USER}>`,
        to: recuperacao.email,
        subject: 'Seu novo código de recuperação',
        text: `Seu novo código de recuperação é: ${novoCodigo}`
      });
    } catch (erroMail) {
      console.error('Erro no Nodemailer durante reenvio de recuperação:', erroMail);
      return res.status(500).json({ status: 'erro', mensagem: 'Falha ao reenviar o e-mail.' });
    }

    return res.status(200).json({ status: 'sucesso', mensagem: 'Novo código enviado com sucesso!' });

  } catch (erro) {
    console.error('Erro ao reenviar código de recuperação:', erro);
    return res.status(400).json({ status: 'erro', mensagem: 'Sessão inválida ou token corrompido.' });
  }
});

// POST /api/auth/validar-esqueci — valida código OTP
app.post('/api/auth/validar-esqueci', limitarRecuperacaoIP, async (req, res) => {
  const { codigo, idVerificacao } = req.body;

  if (!codigo || !idVerificacao) {
    return res.status(400).json({ status: 'erro', mensagem: 'Dados incompletos.' });
  }

  try {
    const resultado = await pool.query('SELECT * FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
    const recuperacao = resultado.rows[0];

    if (!recuperacao) {
      return res.status(400).json({ status: 'erro', mensagem: 'Verificação não encontrada ou expirada.' });
    }

    if (new Date(recuperacao.expira_em) < new Date()) {
      await pool.query('DELETE FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
      return res.status(400).json({ status: 'erro', mensagem: 'O tempo limite do código expirou. Solicite novamente.' });
    }

    if (recuperacao.tentativas >= 5) {
      await pool.query('DELETE FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
      return res.status(429).json({ status: 'erro', mensagem: 'Número máximo de tentativas excedido. Solicite novamente.' });
    }

    const codigoConfere = await bcrypt.compare(codigo.trim(), recuperacao.codigo_hash);

    if (!codigoConfere) {
      await pool.query('UPDATE recuperacoes_senha SET tentativas = tentativas + 1 WHERE id = $1', [idVerificacao]);
      return res.status(400).json({ status: 'erro', mensagem: 'Código incorreto.' });
    }

    // CORREÇÃO: código correto — registra no banco. É essa flag que libera
    // o /api/auth/confirmar-esqueci.
    await pool.query('UPDATE recuperacoes_senha SET verificado = TRUE WHERE id = $1', [idVerificacao]);

    return res.status(200).json({ status: 'sucesso', mensagem: 'Código válido. Pode definir nova senha.' });

  } catch (erro) {
    console.error('Erro ao validar código de recuperação:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// POST /api/auth/confirmar-esqueci — salva nova senha
app.post('/api/auth/confirmar-esqueci', limitarRecuperacaoIP, async (req, res) => {
  const { novaSenha, idVerificacao } = req.body;

  if (!novaSenha || !idVerificacao) {
    return res.status(400).json({ status: 'erro', mensagem: 'Dados incompletos.' });
  }

  if (!validarSenhaForte(novaSenha)) {
    return res.status(400).json({
      status: 'erro',
      mensagem: 'A senha deve ter no mínimo 8 caracteres, incluindo pelo menos uma letra maiúscula, uma minúscula, um número e um caractere especial (@$!%*?&#).'
    });
  }

  try {
    const resultado = await pool.query('SELECT * FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
    const recuperacao = resultado.rows[0];

    if (!recuperacao) {
      return res.status(400).json({ status: 'erro', mensagem: 'Verificação não encontrada ou expirada.' });
    }

    if (new Date(recuperacao.expira_em) < new Date()) {
      await pool.query('DELETE FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
      return res.status(400).json({ status: 'erro', mensagem: 'O tempo limite expirou. Solicite novamente.' });
    }

    // CORREÇÃO DE SEGURANÇA: só troca a senha se o código já foi validado
    // de verdade em /api/auth/validar-esqueci. Antes, quem tivesse o
    // idVerificacao podia pular direto pra cá sem digitar o código.
    if (!recuperacao.verificado) {
      return res.status(403).json({
        status: 'erro',
        mensagem: 'Código ainda não foi validado. Confirme o código enviado por e-mail primeiro.'
      });
    }

    const resultadoUsuario = await pool.query('SELECT id FROM usuarios WHERE email = $1', [recuperacao.email]);
    const usuarioRecuperacao = resultadoUsuario.rows[0];

    if (!usuarioRecuperacao) {
      await pool.query('DELETE FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
      return res.status(400).json({ status: 'erro', mensagem: 'Verificação não encontrada ou expirada.' });
    }

    // Rechecagem do limite: impede burlar abrindo várias sessões de
    // recuperação antes de concluir qualquer uma delas.
    const redefinicoesRecentes = await contarRedefinicoesModalRecentes(usuarioRecuperacao.id);
    if (redefinicoesRecentes >= LIMITE_REDEFINICOES_MODAL) {
      await pool.query('DELETE FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);
      return res.status(429).json({
        status: 'erro',
        codigo: 'LIMITE_RECUPERACAO_ATINGIDO',
        mensagem: `Você atingiu o limite de ${LIMITE_REDEFINICOES_MODAL} redefinições de senha em ${JANELA_REDEFINICOES_MODAL_HORAS}h. Tente novamente mais tarde.`
      });
    }

    const novaSenhaHash = await bcrypt.hash(novaSenha, 10);

    // Grava senha_redefinida_em: é o que trava o botão de redefinir na
    // página de config (cooldown de 24h) depois de resetar pelo modal.
    await pool.query(
      'UPDATE usuarios SET senha = $1, senha_redefinida_em = CURRENT_TIMESTAMP WHERE id = $2',
      [novaSenhaHash, usuarioRecuperacao.id]
    );
    await pool.query(
      `INSERT INTO historico_redefinicoes_senha (usuario_id, origem) VALUES ($1, 'modal')`,
      [usuarioRecuperacao.id]
    );
    await pool.query('DELETE FROM recuperacoes_senha WHERE id = $1', [idVerificacao]);

    return res.status(200).json({ status: 'sucesso', mensagem: 'Senha alterada com sucesso! Faça login com a nova senha.' });

  } catch (erro) {
    console.error('Erro ao confirmar recuperação de senha:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Servidor rodando na porta ${process.env.PORT || 3000} com PostgreSQL`);
  garantirBucket();
});

const limitarLoginIP = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    status: 'erro',
    mensagem: 'Muitas tentativas de login a partir deste IP. Tente novamente mais tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.post('/api/login', limitarLoginIP, async (req, res) => {
  const { email, password, lembrarDeMim } = req.body;

  if (!email || !password) {
    return res.status(400).json({ status: 'erro', mensagem: 'E-mail e senha são obrigatórios.' });
  }

  try {
    const resultado = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    const usuario = resultado.rows[0];

    if (!usuario) {
      return res.status(404).json({
        status: 'erro',
        codigo: 'EMAIL_NAO_CADASTRADO',
        mensagem: 'E-mail não cadastrado. Por favor, faça cadastro.'
      });
    }

    if (!usuario.verificado) {
      return res.status(403).json({ status: 'erro', mensagem: 'Conta ainda não verificada. Conclua o cadastro com o código 2FA.' });
    }

    const senhaConfere = await bcrypt.compare(password, usuario.senha);
    if (!senhaConfere) {
      return res.status(401).json({ status: 'erro', mensagem: 'Senha incorreta.' });
    }

    const duracaoToken = lembrarDeMim === true ? '30d' : '7d';
    const tokenSessao = jwt.sign(
      { id: usuario.id, email: usuario.email },
      JWT_SECRET_SESSAO,
      { expiresIn: duracaoToken }
    );

    return res.status(200).json({
      status: 'sucesso',
      mensagem: 'Login realizado com sucesso!',
      tokenSessao
    });

  } catch (erro) {
    console.error('Erro no servidor durante o login:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

function verificarAutenticacao(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ status: 'erro', mensagem: 'Faça login para acessar este recurso.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET_SESSAO);
    req.usuario = payload;
    next();
  } catch (erro) {
    return res.status(401).json({ status: 'erro', mensagem: 'Sessão inválida ou expirada. Faça login novamente.' });
  }
}

// ============================================================
// PERFIL DE ARTISTA
// ============================================================

// Rota 7: dados do usuário logado — usada pelo frontend pra decidir se
// mostra o popup de "vire artista" antes de liberar o upload.
app.get('/api/usuarios/eu', verificarAutenticacao, async (req, res) => {
  try {
    const resultado = await pool.query(
      'SELECT id, email, nome_usuario, eh_artista, nome_artista, senha_redefinida_em, bio, url_avatar FROM usuarios WHERE id = $1',
      [req.usuario.id]
    );
    const usuario = resultado.rows[0];

    if (!usuario) {
      return res.status(404).json({ status: 'erro', mensagem: 'Usuário não encontrado.' });
    }

    return res.status(200).json({ status: 'sucesso', usuario });
  } catch (erro) {
    console.error('Erro ao buscar usuário:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// Rota 8: define/atualiza o nome de artista da conta. Uma vez definido,
// todo upload futuro usa esse nome automaticamente (ver POST /api/musicas).
app.post('/api/usuarios/artista', verificarAutenticacao, async (req, res) => {
  const { nomeArtista } = req.body;

  if (!nomeArtista || !nomeArtista.trim()) {
    return res.status(400).json({ status: 'erro', mensagem: 'Nome de artista é obrigatório.' });
  }

  try {
    const resultado = await pool.query(
      `UPDATE usuarios SET eh_artista = TRUE, nome_artista = $1
       WHERE id = $2
       RETURNING id, email, eh_artista, nome_artista`,
      [nomeArtista.trim(), req.usuario.id]
    );

    return res.status(200).json({ status: 'sucesso', usuario: resultado.rows[0] });
  } catch (erro) {
    console.error('Erro ao salvar nome de artista:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// ============================================================
// PERFIL (bio, avatar, música favorita, curtidas, playlists)
// ============================================================

const LIMITE_BIO = 300;
const LIMITE_CURTIDAS_PERFIL = 4;
const EXTENSAO_POR_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const TAMANHO_MAX_AVATAR_BYTES = 2 * 1024 * 1024;

// Sinaliza, dentro das transações, que uma das músicas enviadas para as
// curtidas não existe. Vira 404 na rota em vez de 500.
class MusicaInexistente extends Error {}

// O filtro abaixo só checa o Content-Type declarado pelo cliente. A checagem
// que decide de verdade é a detectarTipoImagem, feita no corpo da rota: aqui
// o limite de tamanho é que precisa ser preservado exatamente como estava, e o
// erro de tamanho específico fica para o tratador global devolver 413.
const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANHO_MAX_AVATAR_BYTES },
  fileFilter: (req, file, cb) => {
    if (!EXTENSAO_POR_MIME[file.mimetype]) {
      return cb(new Error('Formato de imagem não suportado. Use JPEG, PNG ou WEBP.'));
    }
    cb(null, true);
  }
});

// Tudo que a página de perfil precisa numa chamada só.
app.get('/api/usuarios/eu/perfil', verificarAutenticacao, async (req, res) => {
  try {
    const resultadoUsuario = await pool.query(
      `SELECT id, email, nome_usuario, eh_artista, nome_artista, bio, url_avatar, musica_favorita_id
       FROM usuarios WHERE id = $1`,
      [req.usuario.id]
    );
    const usuario = resultadoUsuario.rows[0];

    if (!usuario) {
      return res.status(404).json({ status: 'erro', mensagem: 'Usuário não encontrado.' });
    }

    let favorita = null;
    if (usuario.musica_favorita_id) {
      const resultadoFavorita = await pool.query(
        'SELECT id, titulo, artista, url_capa FROM musicas WHERE id = $1',
        [usuario.musica_favorita_id]
      );
      favorita = resultadoFavorita.rows[0] || null;
    }

    const resultadoCurtidas = await pool.query(
      `SELECT m.id, m.titulo, m.artista, m.url_capa
       FROM perfil_curtidas pc
       JOIN musicas m ON m.id = pc.musica_id
       WHERE pc.usuario_id = $1
       ORDER BY pc.posicao ASC`,
      [req.usuario.id]
    );

    // Favoritos fica de fora: é uma playlist do sistema, não "do perfil".
    const resultadoPlaylists = await pool.query(
      `SELECT id, nome, url_capa FROM playlists
       WHERE usuario_id = $1 AND eh_favoritos = FALSE
       ORDER BY criado_em DESC`,
      [req.usuario.id]
    );

    return res.status(200).json({
      status: 'sucesso',
      usuario: {
        id: usuario.id,
        email: usuario.email,
        nome_usuario: usuario.nome_usuario,
        eh_artista: usuario.eh_artista,
        nome_artista: usuario.nome_artista,
        bio: usuario.bio,
        url_avatar: usuario.url_avatar
      },
      favorita,
      curtidas: resultadoCurtidas.rows,
      playlists: resultadoPlaylists.rows
    });
  } catch (erro) {
    console.error('Erro ao buscar perfil:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// Salva a biografia (vazia = apaga).
app.put('/api/usuarios/eu/bio', verificarAutenticacao, async (req, res) => {
  const { bio } = req.body;

  if (typeof bio !== 'string') {
    return res.status(400).json({ status: 'erro', mensagem: 'Biografia inválida.' });
  }

  const bioLimpa = bio.trim();
  if (tamanhoEmCaracteres(bioLimpa) > LIMITE_BIO) {
    return res.status(400).json({ status: 'erro', mensagem: `A biografia pode ter no máximo ${LIMITE_BIO} caracteres.` });
  }

  try {
    await pool.query('UPDATE usuarios SET bio = $1 WHERE id = $2', [bioLimpa || null, req.usuario.id]);
    return res.status(200).json({ status: 'sucesso', bio: bioLimpa });
  } catch (erro) {
    console.error('Erro ao salvar biografia:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// Troca o avatar: sobe a imagem nova pro Storage, atualiza o banco e só
// então apaga a antiga (melhor-esforço, mesmo padrão das outras exclusões).
app.post('/api/usuarios/eu/avatar', verificarAutenticacao, uploadAvatarComErroAmigavel, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: 'erro', mensagem: 'Selecione uma imagem.' });
  }

  // O Content-Type declarado pelo cliente não é prova de nada. Quem decide o
  // formato é a assinatura real dos primeiros bytes; a extensão do arquivo
  // também sai daqui, e não do que o navegador alegou.
  const tipo = detectarTipoImagem(req.file.buffer);
  if (!tipo) {
    return res.status(400).json({ status: 'erro', mensagem: 'Formato de imagem não suportado. Use JPEG, PNG ou WEBP.' });
  }

  try {
    const resultadoAnterior = await pool.query('SELECT url_avatar FROM usuarios WHERE id = $1', [req.usuario.id]);
    if (resultadoAnterior.rows.length === 0) {
      return res.status(404).json({ status: 'erro', mensagem: 'Usuário não encontrado.' });
    }
    const urlAnterior = resultadoAnterior.rows[0].url_avatar;

    // Nome gerado pelo servidor (não usa originalname do cliente).
    const caminhoAvatar = `avatares/${req.usuario.id}-${Date.now()}.${tipo.extensao}`;

    const { error: erroUpload } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(caminhoAvatar, req.file.buffer, { contentType: tipo.mime });

    if (erroUpload) {
      console.error('Erro ao subir avatar pro Supabase Storage:', erroUpload);
      return res.status(500).json({ status: 'erro', mensagem: 'Falha ao enviar a imagem.' });
    }

    const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(caminhoAvatar);
    const urlNova = data.publicUrl;

    try {
      await pool.query('UPDATE usuarios SET url_avatar = $1 WHERE id = $2', [urlNova, req.usuario.id]);
    } catch (erroBanco) {
      // A imagem subiu, mas o banco não registrou. Sem isto sobraria um
      // arquivo órfão no bucket que ninguém mais vai referenciar. O avatar
      // antigo continua intacto, porque a coluna nunca foi sobrescrita.
      await removerArquivoDoStorage(supabase, SUPABASE_BUCKET, urlNova);
      throw erroBanco;
    }

    // Só agora que a nova está confirmada no banco é seguro descartar a
    // antiga. Falhar aqui é o melhor-esforço: a troca já valeu.
    await removerArquivoDoStorage(supabase, SUPABASE_BUCKET, urlAnterior);

    return res.status(200).json({ status: 'sucesso', url_avatar: urlNova });
  } catch (erro) {
    console.error('Erro ao salvar avatar:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// O Multer interrompe o stream e solta o erro antes do body ser lido. Esta
// camada traduz o "passou do tamanho" para 413 com o limite exato desta rota
// (o erro do Multer não carrega esse número, e a mensagem precisa ser útil).
// Sem ela, um 2MB e um 25MB dariam a mesma resposta genérica.
function uploadAvatarComErroAmigavel(req, res, next) {
  uploadAvatar.single('avatar')(req, res, (erro) => {
    if (!erro) return next();
    if (erro instanceof multer.MulterError && erro.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        status: 'erro',
        mensagem: `A imagem passa do limite de ${TAMANHO_MAX_AVATAR_BYTES / (1024 * 1024)} MB. Escolha uma menor.`
      });
    }
    if (erro instanceof multer.MulterError || erro.message?.includes('suportado')) {
      return res.status(400).json({ status: 'erro', mensagem: erro.message });
    }
    next(erro);
  });
}

// Remove o avatar do perfil: apaga o arquivo do Storage e devolve a coluna
// url_avatar para NULL. A mesma verificação de bytes não se aplica aqui (não
// entra arquivo novo), mas o usuário continua vindo sempre do token.
app.delete('/api/usuarios/eu/avatar', verificarAutenticacao, async (req, res) => {
  try {
    const resultado = await pool.query('SELECT url_avatar FROM usuarios WHERE id = $1', [req.usuario.id]);
    if (resultado.rows.length === 0) {
      return res.status(404).json({ status: 'erro', mensagem: 'Usuário não encontrado.' });
    }

    const urlAnterior = resultado.rows[0].url_avatar;
    // O banco é a fonte da verdade: zerar a coluna primeiro garante que,
    // mesmo que a remoção do arquivo falhe, o perfil não continue apontando
    // para uma imagem que o usuário pediu para tirar.
    await pool.query('UPDATE usuarios SET url_avatar = NULL WHERE id = $1', [req.usuario.id]);

    // Arquivo já ausente no Storage é o caso normal de quem nunca trocou o
    // avatar duas vezes: removerArquivoDoStorage devolve false sem quebrar.
    await removerArquivoDoStorage(supabase, SUPABASE_BUCKET, urlAnterior);

    return res.status(200).json({ status: 'sucesso', url_avatar: null });
  } catch (erro) {
    console.error('Erro ao remover avatar:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// Define a música favorita do perfil (musicaId null = remove).
app.put('/api/usuarios/eu/favorita', verificarAutenticacao, async (req, res) => {
  const { musicaId } = req.body;
  let idMusica = null;

  try {
    if (musicaId !== null && musicaId !== undefined) {
      idMusica = parseInt(musicaId, 10);
      if (!Number.isInteger(idMusica)) {
        return res.status(400).json({ status: 'erro', mensagem: 'ID de música inválido.' });
      }

      const existe = await pool.query('SELECT id FROM musicas WHERE id = $1', [idMusica]);
      if (!existe.rows[0]) {
        return res.status(404).json({ status: 'erro', mensagem: 'Música não encontrada.' });
      }
    }

    await pool.query('UPDATE usuarios SET musica_favorita_id = $1 WHERE id = $2', [idMusica, req.usuario.id]);
    return res.status(200).json({ status: 'sucesso', musicaId: idMusica });
  } catch (erro) {
    // A música pode ter sido apagada entre o SELECT e o UPDATE. A coluna é
    // REFERENCES musicas(id), então o banco recusa o UPDATE com 23503; sem
    // isto a usuário receberia 500 por causa de algo que é, na verdade,
    // "essa música não existe mais".
    if (ehViolacaoDeChave(erro, ['23503'])) {
      return res.status(404).json({ status: 'erro', mensagem: 'Música não encontrada.' });
    }
    console.error('Erro ao salvar música favorita:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// Substitui a lista de curtidas do perfil (até 4, na ordem enviada).
app.put('/api/usuarios/eu/curtidas', verificarAutenticacao, async (req, res) => {
  const { musicaIds } = req.body;

  if (!Array.isArray(musicaIds)) {
    return res.status(400).json({ status: 'erro', mensagem: 'Lista de músicas inválida.' });
  }

  const ids = [...new Set(musicaIds.map((valor) => parseInt(valor, 10)))];

  if (ids.some((id) => !Number.isInteger(id))) {
    return res.status(400).json({ status: 'erro', mensagem: 'Lista de músicas inválida.' });
  }
  if (ids.length > LIMITE_CURTIDAS_PERFIL) {
    return res.status(400).json({ status: 'erro', mensagem: `Você pode escolher no máximo ${LIMITE_CURTIDAS_PERFIL} músicas curtidas.` });
  }

  try {
    // A trava de linha (comTravaDoUsuario) serializa requisições do MESMO
    // usuário. Sem ela, dois "salvar" simultâneos faziam DELETE e depois
    // reinseriam por cima um do outro: ou violavam o UNIQUE(usuario_id,
    // musica_id) e devolviam 500, ou gravavam uma lista misturada das duas.
    // Usuários diferentes continuam rodando em paralelo.
    const gravadas = await comTravaDoUsuario(pool, req.usuario.id, async (client) => {
      if (ids.length > 0) {
        const existentes = await client.query('SELECT id FROM musicas WHERE id = ANY($1::int[])', [ids]);
        if (existentes.rows.length !== ids.length) {
          throw new MusicaInexistente();
        }
      }

      // "Tudo ou nada": a transação aberta em comTravaDoUsuario garante que
      // uma falha no meio não deixe metade da lista antiga e metade da nova.
      await client.query('DELETE FROM perfil_curtidas WHERE usuario_id = $1', [req.usuario.id]);

      for (let i = 0; i < ids.length; i++) {
        await client.query(
          'INSERT INTO perfil_curtidas (usuario_id, musica_id, posicao) VALUES ($1, $2, $3)',
          [req.usuario.id, ids[i], i + 1]
        );
      }

      const leitura = await client.query(
        `SELECT m.id, m.titulo, m.artista, m.url_audio, m.url_capa
         FROM perfil_curtidas pc
         JOIN musicas m ON m.id = pc.musica_id
         WHERE pc.usuario_id = $1
         ORDER BY pc.posicao ASC`,
        [req.usuario.id]
      );
      return leitura.rows;
    });

    return res.status(200).json({ status: 'sucesso', musicaIds: ids, curtidas: gravadas });
  } catch (erro) {
    if (erro instanceof UsuarioInexistente) {
      return res.status(404).json({ status: 'erro', mensagem: 'Usuário não encontrado.' });
    }
    if (erro instanceof MusicaInexistente || ehViolacaoDeChave(erro, ['23503', '23505'])) {
      return res.status(404).json({ status: 'erro', mensagem: 'Alguma das músicas não existe mais.' });
    }
    console.error('Erro ao salvar curtidas do perfil:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// ============================================================
// REDEFINIÇÃO DE SENHA (via 2FA) — cooldown de 24h entre redefinições
// ============================================================

const COOLDOWN_REDEFINICAO_MS = 24 * 60 * 60 * 1000; // 24 horas

const limitarRedefinicaoIP = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    status: 'erro',
    mensagem: 'Muitas tentativas a partir deste IP. Tente novamente mais tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rota 9: solicita a redefinição — valida a nova senha, confere o cooldown
// de 24h no servidor (nunca confiar só na checagem do frontend), gera o
// código e envia por e-mail. Mesmo padrão de verificacoes_2fa, só que
// vinculado a um usuario_id já existente em vez de um cadastro novo.
app.post('/api/usuarios/redefinir-senha/solicitar', verificarAutenticacao, limitarRedefinicaoIP, async (req, res) => {
  const { novaSenha } = req.body;

  if (!novaSenha || !validarSenhaForte(novaSenha)) {
    return res.status(400).json({
      status: 'erro',
      mensagem: 'A nova senha deve ter no mínimo 8 caracteres, incluindo pelo menos uma letra maiúscula, uma minúscula, um número e um caractere especial (@$!%*?&#).'
    });
  }

  try {
    const resultadoUsuario = await pool.query(
      'SELECT email, senha_redefinida_em FROM usuarios WHERE id = $1',
      [req.usuario.id]
    );
    const usuarioLogado = resultadoUsuario.rows[0];

    if (!usuarioLogado) {
      return res.status(404).json({ status: 'erro', mensagem: 'Usuário não encontrado.' });
    }

    if (usuarioLogado.senha_redefinida_em) {
      const tempoDesdeUltimoReset = Date.now() - new Date(usuarioLogado.senha_redefinida_em).getTime();
      if (tempoDesdeUltimoReset < COOLDOWN_REDEFINICAO_MS) {
        const restanteMs = COOLDOWN_REDEFINICAO_MS - tempoDesdeUltimoReset;
        return res.status(429).json({
          status: 'erro',
          codigo: 'COOLDOWN_REDEFINICAO_ATIVO',
          mensagem: 'Você já redefiniu sua senha recentemente. Aguarde o cooldown de 24h.',
          restanteMs
        });
      }
    }

    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    const novaSenhaHash = await bcrypt.hash(novaSenha, 10);
    const codigoHash = await bcrypt.hash(codigo, 10);
    const idRedefinicao = crypto.randomUUID();
    const expiraEm = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `INSERT INTO redefinicoes_senha (id, usuario_id, nova_senha_hash, codigo_hash, tentativas, expira_em, ultimo_envio_em)
       VALUES ($1, $2, $3, $4, 0, $5, CURRENT_TIMESTAMP)`,
      [idRedefinicao, req.usuario.id, novaSenhaHash, codigoHash, expiraEm]
    );

    try {
      await transporter.sendMail({
        from: `"Open sound" <${process.env.GMAIL_USER}>`,
        to: usuarioLogado.email,
        subject: 'Código para redefinir sua senha',
        text: `Seu código de confirmação para redefinir a senha é: ${codigo}`
      });
    } catch (erroMail) {
      console.error('Erro ao enviar e-mail de redefinição de senha:', erroMail);
      await pool.query('DELETE FROM redefinicoes_senha WHERE id = $1', [idRedefinicao]);
      return res.status(500).json({ status: 'erro', mensagem: 'Falha ao enviar o e-mail com o código de verificação.' });
    }

    return res.status(200).json({ status: 'sucesso', mensagem: 'Código enviado com sucesso!', idRedefinicao });

  } catch (erro) {
    console.error('Erro ao solicitar redefinição de senha:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// Rota 10: confirma o código e efetiva a troca de senha.
app.post('/api/usuarios/redefinir-senha/confirmar', verificarAutenticacao, limitarRedefinicaoIP, async (req, res) => {
  const { codigo, idRedefinicao } = req.body;

  if (!codigo || !idRedefinicao) {
    return res.status(400).json({ status: 'erro', mensagem: 'Dados incompletos.' });
  }

  try {
    const resultado = await pool.query('SELECT * FROM redefinicoes_senha WHERE id = $1', [idRedefinicao]);
    const redefinicao = resultado.rows[0];

    if (!redefinicao) {
      return res.status(400).json({ status: 'erro', mensagem: 'Verificação não encontrada ou expirada.' });
    }

    // Garante que a verificação pertence ao mesmo usuário logado — impede
    // usar o idRedefinicao de outra pessoa mesmo que alguém consiga adivinhar o UUID.
    if (redefinicao.usuario_id !== req.usuario.id) {
      return res.status(403).json({ status: 'erro', mensagem: 'Verificação não pertence a este usuário.' });
    }

    if (new Date(redefinicao.expira_em) < new Date()) {
      await pool.query('DELETE FROM redefinicoes_senha WHERE id = $1', [idRedefinicao]);
      return res.status(400).json({ status: 'erro', mensagem: 'O tempo limite do código expirou. Solicite novamente.' });
    }

    if (redefinicao.tentativas >= 5) {
      await pool.query('DELETE FROM redefinicoes_senha WHERE id = $1', [idRedefinicao]);
      return res.status(429).json({ status: 'erro', mensagem: 'Número máximo de tentativas excedido. Solicite novamente.' });
    }

    const codigoConfere = await bcrypt.compare(codigo.trim(), redefinicao.codigo_hash);

    if (!codigoConfere) {
      await pool.query('UPDATE redefinicoes_senha SET tentativas = tentativas + 1 WHERE id = $1', [idRedefinicao]);
      return res.status(400).json({ status: 'erro', mensagem: 'Código incorreto.' });
    }

    await pool.query(
      'UPDATE usuarios SET senha = $1, senha_redefinida_em = CURRENT_TIMESTAMP WHERE id = $2',
      [redefinicao.nova_senha_hash, req.usuario.id]
    );
    await pool.query('DELETE FROM redefinicoes_senha WHERE id = $1', [idRedefinicao]);

    return res.status(200).json({ status: 'sucesso', mensagem: 'Senha redefinida com sucesso!' });

  } catch (erro) {
    console.error('Erro ao confirmar redefinição de senha:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// ============================================================
// EXCLUSÃO DE CONTA (com frase de segurança)
// ============================================================

// Extrai o caminho relativo dentro do bucket a partir de uma URL pública do
// Supabase Storage, pra poder apagar o arquivo de verdade (não só o registro
// no banco). Retorna null se a URL não bater com o padrão esperado.
function extrairCaminhoStorage(urlPublica) {
  if (!urlPublica) return null;
  const marcador = `/storage/v1/object/public/${SUPABASE_BUCKET}/`;
  const indice = urlPublica.indexOf(marcador);
  if (indice === -1) return null;
  return urlPublica.slice(indice + marcador.length);
}

// Rota 11: deleta a conta e todas as músicas dela — irreversível.
// Exige a frase de segurança exata: "eu desejo deletar <nome de usuário>"
// (ou o e-mail, pra contas antigas sem nome de usuário cadastrado).
app.delete('/api/usuarios/eu', verificarAutenticacao, async (req, res) => {
  const { fraseConfirmacao } = req.body;

  if (!fraseConfirmacao) {
    return res.status(400).json({ status: 'erro', mensagem: 'Frase de confirmação é obrigatória.' });
  }

  const client = await pool.connect();

  try {
    const resultadoUsuario = await client.query(
      'SELECT email, nome_usuario, url_avatar FROM usuarios WHERE id = $1',
      [req.usuario.id]
    );
    const usuarioLogado = resultadoUsuario.rows[0];

    if (!usuarioLogado) {
      client.release();
      return res.status(404).json({ status: 'erro', mensagem: 'Usuário não encontrado.' });
    }

    const identificador = usuarioLogado.nome_usuario || usuarioLogado.email;
    const fraseEsperada = `eu desejo deletar ${identificador}`;

    if (fraseConfirmacao.trim().toLowerCase() !== fraseEsperada.toLowerCase()) {
      client.release();
      return res.status(400).json({
        status: 'erro',
        mensagem: `Frase de confirmação incorreta. Digite exatamente: "eu desejo deletar ${identificador}"`
      });
    }

    // Busca as URLs das músicas ANTES de apagar, pra poder limpar o Storage.
    const resultadoMusicas = await client.query(
      'SELECT url_audio, url_capa FROM musicas WHERE usuario_id = $1',
      [req.usuario.id]
    );

    // Limpeza do Storage é melhor-esforço: se falhar, não impede a exclusão
    // da conta (evita deixar o usuário "preso" por causa de um arquivo órfão).
    const caminhosParaApagar = [];
    resultadoMusicas.rows.forEach((musica) => {
      const caminhoAudio = extrairCaminhoStorage(musica.url_audio);
      const caminhoCapa = extrairCaminhoStorage(musica.url_capa);
      if (caminhoAudio) caminhosParaApagar.push(caminhoAudio);
      if (caminhoCapa) caminhosParaApagar.push(caminhoCapa);
    });

    const caminhoAvatarConta = extrairCaminhoStorage(usuarioLogado.url_avatar);
    if (caminhoAvatarConta) caminhosParaApagar.push(caminhoAvatarConta);

    if (caminhosParaApagar.length > 0) {
      const { error: erroStorage } = await supabase.storage.from(SUPABASE_BUCKET).remove(caminhosParaApagar);
      if (erroStorage) {
        console.error('Erro ao apagar arquivos do Storage (exclusão da conta segue mesmo assim):', erroStorage);
      }
    }

    // Transação: apaga músicas + verificações pendentes + a conta em si,
    // tudo ou nada. Deletar as músicas primeiro satisfaz a foreign key
    // antes de deletar o usuário, sem precisar mexer na constraint.
    await client.query('BEGIN');
    await client.query('DELETE FROM musicas WHERE usuario_id = $1', [req.usuario.id]);
    await client.query('DELETE FROM playlists WHERE usuario_id = $1', [req.usuario.id]);   // <-- NOVA
    await client.query('DELETE FROM redefinicoes_senha WHERE usuario_id = $1', [req.usuario.id]);
    await client.query('DELETE FROM usuarios WHERE id = $1', [req.usuario.id]);
    await client.query('COMMIT');

    return res.status(200).json({ status: 'sucesso', mensagem: 'Conta e músicas excluídas com sucesso.' });

  } catch (erro) {
    await client.query('ROLLBACK');
    console.error('Erro ao excluir conta:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  } finally {
    client.release();
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const tiposAudio = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg'];
    const tiposImagem = ['image/jpeg', 'image/png', 'image/webp'];

    if (file.fieldname === 'audio' && !tiposAudio.includes(file.mimetype)) {
      return cb(new Error('Formato de áudio não suportado. Use MP3, WAV ou OGG.'));
    }
    if (file.fieldname === 'capa' && !tiposImagem.includes(file.mimetype)) {
      return cb(new Error('Formato de imagem não suportado. Use JPEG, PNG ou WEBP.'));
    }
    cb(null, true);
  }
});

const limitarUploadIP = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: {
    status: 'erro',
    mensagem: 'Muitos uploads a partir deste IP. Tente novamente mais tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.post(
  '/api/musicas',
  verificarAutenticacao,
  limitarUploadIP,
  upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'capa', maxCount: 1 }]),
  async (req, res) => {
    try {
      const { titulo } = req.body;
      const arquivoAudio = req.files?.audio?.[0];
      const arquivoCapa = req.files?.capa?.[0];

      if (!titulo) {
        return res.status(400).json({ status: 'erro', mensagem: 'Título é obrigatório.' });
      }
      if (!arquivoAudio) {
        return res.status(400).json({ status: 'erro', mensagem: 'O arquivo de áudio é obrigatório.' });
      }

      // O nome de artista não vem mais do cliente — é puxado da conta.
      // Isso é o que garante que TODO upload dessa conta usa o mesmo nome,
      // e também bloqueia quem tentar chamar a rota direto sem ter
      // passado pelo cadastro de artista (POST /api/usuarios/artista).
      const resultadoUsuario = await pool.query(
        'SELECT eh_artista, nome_artista FROM usuarios WHERE id = $1',
        [req.usuario.id]
      );
      const usuarioLogado = resultadoUsuario.rows[0];

      if (!usuarioLogado || !usuarioLogado.eh_artista || !usuarioLogado.nome_artista) {
        return res.status(403).json({
          status: 'erro',
          codigo: 'ARTISTA_NAO_CADASTRADO',
          mensagem: 'Cadastre um nome de artista antes de enviar músicas.'
        });
      }

      const artista = usuarioLogado.nome_artista;

      const idUnico = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const caminhoAudio = `audio/${idUnico}-${arquivoAudio.originalname}`;

      const { error: erroUploadAudio } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(caminhoAudio, arquivoAudio.buffer, { contentType: arquivoAudio.mimetype });

      if (erroUploadAudio) {
        console.error('Erro ao subir áudio pro Supabase Storage:', erroUploadAudio);
        return res.status(500).json({ status: 'erro', mensagem: 'Falha ao enviar o arquivo de áudio.' });
      }

      const { data: dadosUrlAudio } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(caminhoAudio);
      const urlAudio = dadosUrlAudio.publicUrl;

      let urlCapa = null;
      if (arquivoCapa) {
        const caminhoCapa = `capas/${idUnico}-${arquivoCapa.originalname}`;
        const { error: erroUploadCapa } = await supabase.storage
          .from(SUPABASE_BUCKET)
          .upload(caminhoCapa, arquivoCapa.buffer, { contentType: arquivoCapa.mimetype });

        if (erroUploadCapa) {
          console.error('Erro ao subir capa pro Supabase Storage (música seguirá sem capa):', erroUploadCapa);
        } else {
          const { data: dadosUrlCapa } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(caminhoCapa);
          urlCapa = dadosUrlCapa.publicUrl;
        }
      }

      const resultado = await pool.query(
        `INSERT INTO musicas (titulo, artista, url_audio, url_capa, usuario_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [titulo, artista, urlAudio, urlCapa, req.usuario.id]
      );

      return res.status(201).json({ status: 'sucesso', musica: resultado.rows[0] });

    } catch (erro) {
      console.error('Erro no upload de música:', erro);
      return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
    }
  }
);

// ============================================================
// CONTAGEM DE REPRODUÇÕES
// ============================================================

// Rota 14: registra UMA reprodução de uma música.
//
// Chamar só quando o áudio começa a tocar de verdade (o frontend chama a
// partir do evento 'play' do player), nunca no clique do botão.
//
// Exige sessão pelo mesmo motivo de ouvir música exigir login no frontend.
// Sem token válido a reprodução nem é contada, o que evita que um visitante
// anônimo infle o ranking chamando a rota direto.
//
// O incremento acontece inteiro dentro do Postgres ("SET x = x + 1"), sem
// ler o valor antes: se dois usuários towcarem a mesma música no mesmo
// instante, o banco serializa os dois incrementos e nenhum se perde.
app.post('/api/musicas/:id/reproduzir', verificarAutenticacao, async (req, res) => {
  const idMusica = parseInt(req.params.id, 10);

  if (!Number.isInteger(idMusica)) {
    return res.status(400).json({ 
      status: 'erro', 
      mensagem: 'ID de música inválido.' 
    });
  }

  try {
    // === LOG DE DIAGNÓSTICO (temporário) ===
    const antes = await pool.query('SELECT titulo, reproducoes FROM musicas WHERE id = $1', [idMusica]);
    console.log(`[PLAY] servidor recebeu POST /api/musicas/${idMusica}/reproduzir | usuario ${req.usuario.id}` +
      (antes.rows[0] ? ` | "${antes.rows[0].titulo}" tinha ${antes.rows[0].reproducoes}` : ' | música não encontrada'));

    // COALESCE só protege contra uma linha antiga com reproducoes NULL
    // (somar em cima de NULL daria NULL). O incremento continua sendo
    // atômico, feito em uma única instrução.
    const resultado = await pool.query(
      'UPDATE musicas SET reproducoes = COALESCE(reproducoes, 0) + 1 WHERE id = $1 RETURNING id, reproducoes',
      [idMusica]
    );

    if (resultado.rows.length === 0) {
      console.log(`[PLAY] servidor: música ${idMusica} não existe -> 404 (nada foi contabilizado)`);
      return res.status(404).json({ 
        status: 'erro', 
        mensagem: 'Música não encontrada.' 
      });
    }

    console.log(`[PLAY] servidor: música ${idMusica} -> ${resultado.rows[0].reproducoes} reproduções (gravado no PostgreSQL)`);

    return res.status(200).json({
      status: 'sucesso',
      musica: resultado.rows[0]
    });

  } catch (erro) {
    console.error('Erro ao registrar reprodução:', erro);
    return res.status(500).json({ 
      status: 'erro', 
      mensagem: 'Erro interno no servidor.' 
    });
  }
});

app.get('/api/musicas', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM musicas ORDER BY criado_em DESC LIMIT 50');
    return res.status(200).json({ status: 'sucesso', musicas: resultado.rows });
  } catch (erro) {
    console.error('Erro ao listar músicas:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// Ranking público das músicas mais tocadas — ranking geral por total de
// reproduções acumuladas. NÃO é ranking mensal: não existe histórico de
// data/hora por reprodução, então não há como filtrar por período. A
// ordenação é feita pelo próprio Postgres.
//
// Colunas explícitas em vez de SELECT * porque esta resposta só alimenta o
// carrossel da home; não há motivo para expor tudo da linha.
app.get('/api/musicas/mais-tocadas', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT
         id,
         titulo,
         artista,
         url_audio,
         url_capa,
         reproducoes,
         usuario_id,
         criado_em
       FROM musicas
       ORDER BY reproducoes DESC NULLS LAST, criado_em DESC
       LIMIT 10`
    );

    return res.status(200).json({ status: 'sucesso', musicas: resultado.rows });
  } catch (erro) {
    console.error('Erro ao listar músicas mais tocadas:', erro);
    return res.status(500).json({ 
      status: 'erro', 
      mensagem: 'Erro interno no servidor.' 
    });
  }
});

// Ranking público dos artistas mais ouvidos: a soma das reproduções de
// todas as músicas enviadas pela conta.
//
// O agrupamento é por u.id (o mesmo usuario_id de musicas) e NÃO pelo texto
// musicas.artista. Aquele campo é só uma cópia do nome artístico feita no
// momento do upload, sem chave: se duas contas diferentes escolherem o
// mesmo nome artisticamente, agrupar pelo texto fundiria dois artistas
// distintos num só. Agrupando pelo usuário, isso não acontece.
app.get('/api/artistas/mais-ouvidos', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT
         u.id AS usuario_id,
         u.nome_artista AS artista,
         CAST(COUNT(m.id) AS INTEGER) AS musicas,
         CAST(COALESCE(SUM(m.reproducoes), 0) AS INTEGER) AS reproducoes
       FROM usuarios u
       JOIN musicas m
         ON m.usuario_id = u.id
       WHERE u.eh_artista = TRUE
         AND u.nome_artista IS NOT NULL
         AND u.nome_artista <> ''
       GROUP BY u.id, u.nome_artista
       ORDER BY reproducoes DESC, u.nome_artista ASC
       LIMIT 10`
    );

    return res.status(200).json({ status: 'sucesso', artistas: resultado.rows });
  } catch (erro) {
    console.error('Erro ao listar artistas mais ouvidos:', erro);
    return res.status(500).json({ 
      status: 'erro', 
      mensagem: 'Erro interno no servidor.' 
    });
  }
});

// Busca por título OU artista, correspondência parcial (case-insensitive)
// — cobre "parecidas" e "exatamente iguais" na mesma query. Pública,
// igual à listagem geral: buscar não exige login.
app.get('/api/musicas/buscar', async (req, res) => {
  const termo = req.query.q;

  if (!termo || !termo.trim()) {
    return res.status(400).json({ status: 'erro', mensagem: 'Digite um termo de busca.' });
  }

  try {
    const padrao = `%${termo.trim()}%`;
    const resultado = await pool.query(
      'SELECT * FROM musicas WHERE titulo ILIKE $1 OR artista ILIKE $1 ORDER BY criado_em DESC LIMIT 50',
      [padrao]
    );
    return res.status(200).json({ status: 'sucesso', musicas: resultado.rows });
  } catch (erro) {
    console.error('Erro ao buscar músicas:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// ============================================================
// "MINHAS MÚSICAS" — listar e excluir (com cooldown de 24h)
// ============================================================

const COOLDOWN_EXCLUSAO_MUSICA_MS = 24 * 60 * 60 * 1000; // 24 horas

// Rota 12: lista só as músicas do usuário logado — usada na página
// "Minhas Músicas" do menu hamburguer.
app.get('/api/musicas/minhas', verificarAutenticacao, async (req, res) => {
  try {
    const resultado = await pool.query(
      'SELECT * FROM musicas WHERE usuario_id = $1 ORDER BY criado_em DESC',
      [req.usuario.id]
    );
    return res.status(200).json({ status: 'sucesso', musicas: resultado.rows });
  } catch (erro) {
    console.error('Erro ao listar músicas do usuário:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// Rota 13: exclui uma música — só o dono pode, e só depois de 24h do
// momento em que foi postada (usa musicas.criado_em, sem coluna nova).
app.delete('/api/musicas/:id', verificarAutenticacao, async (req, res) => {
  const idMusica = parseInt(req.params.id, 10);

  if (!Number.isInteger(idMusica)) {
    return res.status(400).json({ status: 'erro', mensagem: 'ID de música inválido.' });
  }

  try {
    const resultado = await pool.query('SELECT * FROM musicas WHERE id = $1', [idMusica]);
    const musica = resultado.rows[0];

    if (!musica) {
      return res.status(404).json({ status: 'erro', mensagem: 'Música não encontrada.' });
    }

    if (musica.usuario_id !== req.usuario.id) {
      return res.status(403).json({ status: 'erro', mensagem: 'Você só pode excluir suas próprias músicas.' });
    }

    const tempoDesdePostagem = Date.now() - new Date(musica.criado_em).getTime();
    if (tempoDesdePostagem < COOLDOWN_EXCLUSAO_MUSICA_MS) {
      const restanteMs = COOLDOWN_EXCLUSAO_MUSICA_MS - tempoDesdePostagem;
      return res.status(429).json({
        status: 'erro',
        codigo: 'COOLDOWN_EXCLUSAO_ATIVO',
        mensagem: 'Aguarde 24h após a postagem para poder excluir esta música.',
        restanteMs
      });
    }

    // Limpeza do Storage é melhor-esforço — mesmo padrão da exclusão de conta.
    const caminhosParaApagar = [];
    const caminhoAudio = extrairCaminhoStorage(musica.url_audio);
    const caminhoCapa = extrairCaminhoStorage(musica.url_capa);
    if (caminhoAudio) caminhosParaApagar.push(caminhoAudio);
    if (caminhoCapa) caminhosParaApagar.push(caminhoCapa);

    if (caminhosParaApagar.length > 0) {
      const { error: erroStorage } = await supabase.storage.from(SUPABASE_BUCKET).remove(caminhosParaApagar);
      if (erroStorage) {
        console.error('Erro ao apagar arquivos do Storage (exclusão da música segue mesmo assim):', erroStorage);
      }
    }

    await pool.query('DELETE FROM musicas WHERE id = $1', [idMusica]);

    return res.status(200).json({ status: 'sucesso', mensagem: 'Música excluída com sucesso.' });

  } catch (erro) {
    console.error('Erro ao excluir música:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// ============================================================
// PLAYLISTS (criar, listar, adicionar/remover músicas) + FAVORITOS
// ============================================================

// "Favoritos" é criada sob demanda (lazy) — assim, contas criadas antes
// dessa funcionalidade existir também ganham a playlist automaticamente
// na primeira vez que precisarem dela, sem precisar de migração manual.
async function obterOuCriarPlaylistFavoritos(usuarioId) {
  const existente = await pool.query(
    'SELECT * FROM playlists WHERE usuario_id = $1 AND eh_favoritos = TRUE',
    [usuarioId]
  );
  if (existente.rows[0]) return existente.rows[0];

  const criada = await pool.query(
    `INSERT INTO playlists (nome, usuario_id, eh_favoritos)
     VALUES ('Favoritos', $1, TRUE) RETURNING *`,
    [usuarioId]
  );
  return criada.rows[0];
}

const uploadCapaPlaylist = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB — é só uma capa, não precisa do limite de 25MB do áudio
  fileFilter: (req, file, cb) => {
    const tiposImagem = ['image/jpeg', 'image/png', 'image/webp'];
    if (!tiposImagem.includes(file.mimetype)) {
      return cb(new Error('Formato de imagem não suportado. Use JPEG, PNG ou WEBP.'));
    }
    cb(null, true);
  }
});

// Lista as playlists do usuário logado. Favoritos sempre aparece primeiro
// (ORDER BY eh_favoritos DESC) e é garantida a existir antes de listar.
app.get('/api/playlists', verificarAutenticacao, async (req, res) => {
  try {
    await obterOuCriarPlaylistFavoritos(req.usuario.id);

    // ?musicaId=X é opcional: quando vem, cada playlist informa se já contém a música.
    const idMusica = parseInt(req.query.musicaId, 10);
    const musicaId = Number.isInteger(idMusica) ? idMusica : null;

    const resultado = await pool.query(
      `SELECT
         p.*,
         CAST((SELECT COUNT(*) FROM playlist_musicas pm WHERE pm.playlist_id = p.id) AS INTEGER) AS total_musicas,
         EXISTS (
           SELECT 1 FROM playlist_musicas pm
           WHERE pm.playlist_id = p.id AND pm.musica_id = $2
         ) AS contem_musica
       FROM playlists p
       WHERE p.usuario_id = $1
       ORDER BY p.eh_favoritos DESC, p.criado_em ASC`,
      [req.usuario.id, musicaId]
    );
    return res.status(200).json({ status: 'sucesso', playlists: resultado.rows });
  } catch (erro) {
    console.error('Erro ao listar playlists:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// Cria uma playlist nova (nome obrigatório, capa opcional).
app.post('/api/playlists', verificarAutenticacao, uploadCapaPlaylist.single('capa'), async (req, res) => {
  const { nome } = req.body;

  if (!nome || !nome.trim()) {
    return res.status(400).json({ status: 'erro', mensagem: 'Nome da playlist é obrigatório.' });
  }

  try {
    let urlCapa = null;

    if (req.file) {
      const caminhoCapa = `capas-playlist/${Date.now()}-${Math.round(Math.random() * 1e9)}-${req.file.originalname}`;
      const { error: erroUpload } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(caminhoCapa, req.file.buffer, { contentType: req.file.mimetype });

      if (erroUpload) {
        console.error('Erro ao subir capa da playlist (playlist seguirá sem capa):', erroUpload);
      } else {
        const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(caminhoCapa);
        urlCapa = data.publicUrl;
      }
    }

    const resultado = await pool.query(
      `INSERT INTO playlists (nome, url_capa, usuario_id, eh_favoritos)
       VALUES ($1, $2, $3, FALSE) RETURNING *`,
      [nome.trim(), urlCapa, req.usuario.id]
    );

    return res.status(201).json({ status: 'sucesso', playlist: resultado.rows[0] });
  } catch (erro) {
    console.error('Erro ao criar playlist:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// Detalhe de uma playlist + suas músicas — só o dono pode ver.
app.get('/api/playlists/:id', verificarAutenticacao, async (req, res) => {
  const idPlaylist = parseInt(req.params.id, 10);
  if (!Number.isInteger(idPlaylist)) {
    return res.status(400).json({ status: 'erro', mensagem: 'ID de playlist inválido.' });
  }

  try {
    const resultadoPlaylist = await pool.query('SELECT * FROM playlists WHERE id = $1', [idPlaylist]);
    const playlist = resultadoPlaylist.rows[0];

    if (!playlist) {
      return res.status(404).json({ status: 'erro', mensagem: 'Playlist não encontrada.' });
    }
    if (playlist.usuario_id !== req.usuario.id) {
      return res.status(403).json({ status: 'erro', mensagem: 'Você não tem acesso a esta playlist.' });
    }

    const resultadoMusicas = await pool.query(
      `SELECT m.* FROM musicas m
       JOIN playlist_musicas pm ON pm.musica_id = m.id
       WHERE pm.playlist_id = $1
       ORDER BY pm.adicionado_em DESC`,
      [idPlaylist]
    );

    return res.status(200).json({ status: 'sucesso', playlist, musicas: resultadoMusicas.rows });
  } catch (erro) {
    console.error('Erro ao buscar playlist:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// Exclui uma playlist — a de Favoritos é protegida e nunca pode ser excluída.
app.delete('/api/playlists/:id', verificarAutenticacao, async (req, res) => {
  const idPlaylist = parseInt(req.params.id, 10);
  if (!Number.isInteger(idPlaylist)) {
    return res.status(400).json({ status: 'erro', mensagem: 'ID de playlist inválido.' });
  }

  try {
    // "AND usuario_id" na própria cláusula do DELETE: só o dono apaga, e a
    // resposta para "não existe" e "é de outra pessoa" é a mesma (404).
    // Antes, um 403 para playlist de outro usuário confirmava que aquele ID
    // existia, o que permite sondar IDs alheios.
    const resultado = await pool.query(
      'DELETE FROM playlists WHERE id = $1 AND usuario_id = $2 AND eh_favoritos = FALSE RETURNING id',
      [idPlaylist, req.usuario.id]
    );

    if (resultado.rows.length === 0) {
      // Ainda pode ser a de Favoritos do próprio usuário — a única distinção
      // que pode ser revelada sem vazar nada, porque a busca também é
      // filtrada por usuario_id.
      const propria = await pool.query(
        'SELECT eh_favoritos FROM playlists WHERE id = $1 AND usuario_id = $2',
        [idPlaylist, req.usuario.id]
      );

      if (propria.rows[0] && propria.rows[0].eh_favoritos) {
        return res.status(400).json({ status: 'erro', mensagem: 'A playlist de Favoritos não pode ser excluída.' });
      }
      return res.status(404).json({ status: 'erro', mensagem: 'Playlist não encontrada.' });
    }
    return res.status(200).json({ status: 'sucesso', mensagem: 'Playlist excluída.' });
  } catch (erro) {
    console.error('Erro ao excluir playlist:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// Adiciona uma música a uma playlist — ON CONFLICT evita duplicar.
app.post('/api/playlists/:id/musicas', verificarAutenticacao, async (req, res) => {
  const idPlaylist = parseInt(req.params.id, 10);
  const idMusica = parseInt(req.body.musicaId, 10);

  if (!Number.isInteger(idPlaylist) || !Number.isInteger(idMusica)) {
    return res.status(400).json({ status: 'erro', mensagem: 'Dados inválidos.' });
  }

  if (!Number.isInteger(idPlaylist) || !musicaId) {
    return res.status(400).json({ status: 'erro', mensagem: 'Dados inválidos.' });
  }

  try {
    const resultadoPlaylist = await pool.query('SELECT * FROM playlists WHERE id = $1', [idPlaylist]);
    const playlist = resultadoPlaylist.rows[0];

    if (!playlist || playlist.usuario_id !== req.usuario.id) {
      return res.status(403).json({ status: 'erro', mensagem: 'Você não tem acesso a esta playlist.' });
    }
        const musicaExiste = await pool.query('SELECT 1 FROM musicas WHERE id = $1', [idMusica]);
    if (!musicaExiste.rows[0]) {
      return res.status(404).json({ status: 'erro', mensagem: 'Música não encontrada.' });
    }

    await pool.query(
      `INSERT INTO playlist_musicas (playlist_id, musica_id) VALUES ($1, $2)
       ON CONFLICT (playlist_id, musica_id) DO NOTHING`,
      [idPlaylist, idMusica]
    );

    return res.status(200).json({ status: 'sucesso', mensagem: 'Música adicionada à playlist.' });
  } catch (erro) {
    console.error('Erro ao adicionar música à playlist:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// Remove uma música de uma playlist.
app.delete('/api/playlists/:id/musicas/:musicaId', verificarAutenticacao, async (req, res) => {
  const idPlaylist = parseInt(req.params.id, 10);
  const idMusica = parseInt(req.params.musicaId, 10);

  if (!Number.isInteger(idPlaylist) || !Number.isInteger(idMusica)) {
    return res.status(400).json({ status: 'erro', mensagem: 'Dados inválidos.' });
  }

  try {
    const resultadoPlaylist = await pool.query('SELECT * FROM playlists WHERE id = $1', [idPlaylist]);
    const playlist = resultadoPlaylist.rows[0];

    if (!playlist || playlist.usuario_id !== req.usuario.id) {
      return res.status(403).json({ status: 'erro', mensagem: 'Você não tem acesso a esta playlist.' });
    }

    await pool.query(
      'DELETE FROM playlist_musicas WHERE playlist_id = $1 AND musica_id = $2',
      [idPlaylist, idMusica]
    );

    return res.status(200).json({ status: 'sucesso', mensagem: 'Música removida da playlist.' });
  } catch (erro) {
    console.error('Erro ao remover música da playlist:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// Atalhos de favoritar/desfavoritar — por baixo dos panos usam a playlist
// Favoritos, mas o frontend não precisa saber o ID dela pra isso.
app.post('/api/musicas/:id/favoritar', verificarAutenticacao, async (req, res) => {
  const idMusica = parseInt(req.params.id, 10);
  if (!Number.isInteger(idMusica)) {
    return res.status(400).json({ status: 'erro', mensagem: 'ID de música inválido.' });
  }
    const musicaExiste = await pool.query('SELECT 1 FROM musicas WHERE id = $1', [idMusica]);
  if (!musicaExiste.rows[0]) {
    return res.status(404).json({ status: 'erro', mensagem: 'Música não encontrada.' });
  }

  try {
    const favoritos = await obterOuCriarPlaylistFavoritos(req.usuario.id);

    await pool.query(
      `INSERT INTO playlist_musicas (playlist_id, musica_id) VALUES ($1, $2)
       ON CONFLICT (playlist_id, musica_id) DO NOTHING`,
      [favoritos.id, idMusica]
    );

    return res.status(200).json({ status: 'sucesso', mensagem: 'Música favoritada.' });
  } catch (erro) {
    console.error('Erro ao favoritar música:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

app.delete('/api/musicas/:id/favoritar', verificarAutenticacao, async (req, res) => {
  const idMusica = parseInt(req.params.id, 10);
  if (!Number.isInteger(idMusica)) {
    return res.status(400).json({ status: 'erro', mensagem: 'ID de música inválido.' });
  }

  try {
    const favoritos = await obterOuCriarPlaylistFavoritos(req.usuario.id);

    await pool.query(
      'DELETE FROM playlist_musicas WHERE playlist_id = $1 AND musica_id = $2',
      [favoritos.id, idMusica]
    );

    return res.status(200).json({ status: 'sucesso', mensagem: 'Música removida dos favoritos.' });
  } catch (erro) {
    console.error('Erro ao desfavoritar música:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// IDs das músicas favoritadas pelo usuário logado — o frontend busca isso
// uma vez e usa pra decidir qual coração pintar de preenchido nos cards.
app.get('/api/musicas/favoritos/ids', verificarAutenticacao, async (req, res) => {
  try {
    const favoritos = await obterOuCriarPlaylistFavoritos(req.usuario.id);

    const resultado = await pool.query(
      'SELECT musica_id FROM playlist_musicas WHERE playlist_id = $1',
      [favoritos.id]
    );

    return res.status(200).json({ status: 'sucesso', ids: resultado.rows.map((r) => r.musica_id) });
  } catch (erro) {
    console.error('Erro ao buscar favoritos:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

app.use((erro, req, res, next) => {
  // Arquivo acima do limite do Multer é 413 (Payload Too Large), não um 400
  // genérico: o pedido é sintaticamente válido, o corpo é que não cabe. As
  // rotas com limite próprio (avatar, capa de playlist) já traduzem antes
  // com a mensagem exata; aqui fica o resto dos uploads, sem número, porque
  // o MulterError não carrega o limite que foi estourado.
  if (erro instanceof multer.MulterError && erro.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      status: 'erro',
      mensagem: 'O arquivo enviado é grande demais. Escolha um arquivo menor.'
    });
  }
  if (erro instanceof multer.MulterError || erro.message?.includes('suportado')) {
    return res.status(400).json({ status: 'erro', mensagem: erro.message });
  }
  console.error('Erro não tratado:', erro);
  return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
});