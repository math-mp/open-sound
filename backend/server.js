require('dotenv').config(); // Puxa variáveis globais do .env
const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const pool = require('./database'); // Importa a conexão com o PostgreSQL
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const app = express();
app.use(cors());
app.use(express.json());

// CORREÇÃO: sem fallback fraco hardcoded. Se a variável não existir,
// o servidor para na inicialização em vez de rodar com um segredo previsível.
// CORREÇÃO: segredo separado do usado no fluxo de 2FA. Manter os dois JWTs
// (pendência de cadastro vs. sessão de login) com segredos diferentes evita
// que um token de um fluxo seja reaproveitado indevidamente no outro.
const JWT_SECRET_2FA = process.env.JWT_SECRET_2FA;
const JWT_SECRET_SESSAO = process.env.JWT_SECRET_SESSAO;
if (!JWT_SECRET_2FA || !JWT_SECRET_SESSAO) {
  throw new Error('JWT_SECRET_2FA e JWT_SECRET_SESSAO precisam estar definidos no .env. Defina valores fortes antes de subir o servidor.');
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  },
  // ATENÇÃO: rejectUnauthorized: false volta a desativar a verificação do
  // certificado TLS. Reativado aqui só porque a rede local está fazendo
  // inspeção HTTPS (antivírus/proxy) e injetando um certificado autoassinado.
  // Não é recomendado para produção — antes de publicar o projeto de verdade,
  // resolva a causa raiz (confiar no certificado do proxy via
  // NODE_EXTRA_CA_CERTS) e remova essa linha de novo.
  tls: { rejectUnauthorized: false }
});

// Funções de validação via RegEx
function validarEmail(email) {
  const regexEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regexEmail.test(email);
}

function validarSenhaForte(senha) {
  // Mínimo 8 caracteres, 1 maiúscula, 1 minúscula, 1 número e 1 caractere especial
  const regexSenha = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@()!%*?&#])[A-Za-z\d@()!%*?&#]{8,}$/;
  return regexSenha.test(senha);
}

// CORREÇÃO: rate limit para a rota de registro. Sem isso, alguém podia
// gerar tokens pendentes (e disparar e-mails, e rodar bcrypt.hash — ambos
// caros) repetidamente e sem limite algum vindo do mesmo IP.
const limitarRegistroIP = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5,
  message: {
    status: 'erro',
    mensagem: 'Muitas tentativas de registro a partir deste IP. Tente novamente mais tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rota 1: Cadastra o usuário e envia o JWT
app.post('/api/registro', limitarRegistroIP, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ status: 'erro', mensagem: 'E-mail e senha são obrigatórios.' });
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
    // 1. Verifica se o e-mail JÁ existe no banco
    const usuarioExistente = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (usuarioExistente.rows.length > 0) {
      return res.status(400).json({ status: 'erro', mensagem: 'Este e-mail já está cadastrado.' });
    }

    // 2. Gera o código de 6 dígitos
    const codigo = Math.floor(100000 + Math.random() * 900000).toString();

    // 3. Criptografa a senha antes de colocar no token
    const senhaHash = await bcrypt.hash(password, 10);

    // 4. Cria o Token Temporário que expira em 10 minutos (600s)
    // CORREÇÃO: adicionado campo "tentativas" para controlar tentativas erradas do código 2FA
    const tokenPendencia = jwt.sign(
      {
        email,
        senhaHash,
        codigo,
        tentativas: 0,
        enviadoEm: Date.now()
      },
      JWT_SECRET_2FA,
      { expiresIn: '10m' }
    );

    // 5. Envia o e-mail de forma protegida
    try {
      await transporter.sendMail({
        from: `"Open sound" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: 'Seu código de verificação 2FA',
        text: `Seu código de confirmação é: ${codigo}`
      });
    } catch (erroMail) {
      console.error('Erro ao enviar e-mail pelo Nodemailer:', erroMail);
      return res.status(500).json({ status: 'erro', mensagem: 'Falha ao enviar o e-mail com o código de verificação.' });
    }

    // Retorna o token para o frontend
    return res.status(200).json({
      status: 'sucesso',
      mensagem: 'Código enviado com sucesso!',
      tokenPendencia
    });

  } catch (erro) {
    console.error('Erro no servidor durante o registro:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// CORREÇÃO: rate limit dedicado para a rota de validação do código,
// que antes não tinha nenhum limite e era vulnerável a força bruta.
const limitarValidacaoIP = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  message: {
    status: 'erro',
    mensagem: 'Muitas tentativas de verificação. Tente novamente mais tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rota 2: Valida o token + código e faz o INSERT no banco
app.post('/api/validar-2fa', limitarValidacaoIP, async (req, res) => {
  const { codigo, tokenPendencia } = req.body;

  if (!codigo || !tokenPendencia) {
    return res.status(400).json({ status: 'erro', mensagem: 'Dados incompletos.' });
  }

  try {
    // 1. Decodifica e valida o token temporário
    const payload = jwt.verify(tokenPendencia, JWT_SECRET_2FA);

    // 2. CORREÇÃO: bloqueia após 5 tentativas erradas dentro do mesmo token,
    // além do rate limit por IP acima.
    if ((payload.tentativas || 0) >= 5) {
      return res.status(429).json({ status: 'erro', mensagem: 'Número máximo de tentativas excedido. Solicite um novo cadastro.' });
    }

    // 3. Confere o código com tratamento de tipos (String)
    if (String(payload.codigo) !== String(codigo).trim()) {
      // Gera um novo token com o contador de tentativas incrementado
      const tokenAtualizado = jwt.sign(
        { ...payload, tentativas: (payload.tentativas || 0) + 1 },
        JWT_SECRET_2FA,
        { expiresIn: '10m' }
      );
      return res.status(400).json({
        status: 'erro',
        mensagem: 'Código 2FA incorreto.',
        tokenPendencia: tokenAtualizado
      });
    }

    // 4. Cria a conta no PostgreSQL
    const queryInsert = `
      INSERT INTO usuarios (email, senha, verificado)
      VALUES ($1, $2, TRUE)
    `;
    await pool.query(queryInsert, [payload.email, payload.senhaHash]);

    return res.status(200).json({ status: 'sucesso', mensagem: 'Conta registrada e ativada com sucesso!' });

  } catch (erro) {
    if (erro.name === 'TokenExpiredError') {
      return res.status(400).json({ status: 'erro', mensagem: 'O tempo limite do código expirou. Solicite um novo cadastro.' });
    }
    return res.status(400).json({ status: 'erro', mensagem: 'Token de verificação inválido ou alterado.' });
  }
});

// Limite de requisições por IP
const limitarReenvioIP = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  message: {
    status: 'erro',
    mensagem: 'Você excedeu o limite de 5 tentativas por hora. Tente novamente mais tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rota 3: Reenvia o código 2FA via JWT
app.post('/api/reenviar-2fa', limitarReenvioIP, async (req, res) => {
  const { tokenPendencia } = req.body;

  if (!tokenPendencia) {
    return res.status(400).json({ status: 'erro', mensagem: 'Sessão inválida ou expirada.' });
  }

  try {
    let payload;
    try {
      // Tenta validar o token normalmente
      payload = jwt.verify(tokenPendencia, JWT_SECRET_2FA);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        // Ignora a expiração para poder renovar a sessão no reenvio
        payload = jwt.verify(tokenPendencia, JWT_SECRET_2FA, { ignoreExpiration: true });
      } else {
        throw err;
      }
    }

    // Validação dos 60 segundos
    const agora = Date.now();
    const tempoDecorrido = Math.floor((agora - payload.enviadoEm) / 1000);

    if (tempoDecorrido < 60) {
      const segundosRestantes = 60 - tempoDecorrido;
      return res.status(429).json({
        status: 'erro',
        mensagem: `Aguarde ${segundosRestantes}s para solicitar um novo código.`
      });
    }

    // Gera novo código e atualiza o timestamp (zera tentativas também)
    const { email, senhaHash } = payload;
    const novoCodigo = Math.floor(100000 + Math.random() * 900000).toString();

    const novoTokenPendencia = jwt.sign(
      {
        email,
        senhaHash,
        codigo: novoCodigo,
        tentativas: 0,
        enviadoEm: Date.now()
      },
      JWT_SECRET_2FA,
      { expiresIn: '10m' }
    );

    // Envia o novo e-mail
    try {
      await transporter.sendMail({
        from: `"Open sound" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: 'Seu novo código de verificação 2FA',
        text: `Seu novo código de confirmação é: ${novoCodigo}`
      });
    } catch (erroMail) {
      console.error('Erro no Nodemailer durante reenvio:', erroMail);
      return res.status(500).json({ status: 'erro', mensagem: 'Falha ao reenviar o e-mail de verificação.' });
    }

    return res.status(200).json({
      status: 'sucesso',
      mensagem: 'Novo código enviado com sucesso!',
      novoTokenPendencia
    });

  } catch (erro) {
    console.error('Erro ao reenviar código:', erro);
    return res.status(400).json({ status: 'erro', mensagem: 'Sessão inválida ou token corrompido.' });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Servidor rodando na porta ${process.env.PORT || 3000} com PostgreSQL`);
});

// Rate limit para o login: protege contra força bruta / credential stuffing.
const limitarLoginIP = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  message: {
    status: 'erro',
    mensagem: 'Muitas tentativas de login a partir deste IP. Tente novamente mais tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rota 4: Login — confere e-mail/senha e devolve um token de sessão
app.post('/api/login', limitarLoginIP, async (req, res) => {
  const { email, password, lembrarDeMim } = req.body;

  if (!email || !password) {
    return res.status(400).json({ status: 'erro', mensagem: 'E-mail e senha são obrigatórios.' });
  }

  try {
    const resultado = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    const usuario = resultado.rows[0];

    // Mensagem genérica de propósito: não revela se o e-mail existe ou não,
    // nem se foi a senha que errou — evita enumeração de contas.
    const erroGenerico = { status: 'erro', mensagem: 'E-mail ou senha inválidos.' };

    if (!usuario) {
      return res.status(401).json(erroGenerico);
    }

    if (!usuario.verificado) {
      return res.status(403).json({ status: 'erro', mensagem: 'Conta ainda não verificada. Conclua o cadastro com o código 2FA.' });
    }

    const senhaConfere = await bcrypt.compare(password, usuario.senha);
    if (!senhaConfere) {
      return res.status(401).json(erroGenerico);
    }

    // Gera o token de sessão. Guarda só o essencial (id, email) — nunca o hash da senha.
    // "Lembrar de mim": 30 dias se marcado, 7 dias por padrão.
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

// Middleware: bloqueia qualquer rota que exija usuário logado.
// Lê o header "Authorization: Bearer <token>", valida e anexa req.usuario.
// Aplique isso em toda rota que sirva/stream arquivo de música, upload, perfil etc.
// — a proteção precisa estar no backend porque o frontend (botões escondidos,
// redirecionamento pro modal) pode ser sempre contornado via DevTools.
function verificarAutenticacao(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ status: 'erro', mensagem: 'Faça login para acessar este recurso.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET_SESSAO);
    req.usuario = payload; // { id, email }
    next();
  } catch (erro) {
    return res.status(401).json({ status: 'erro', mensagem: 'Sessão inválida ou expirada. Faça login novamente.' });
  }
}

// EXEMPLO de uso — troque pela rota real de streaming de música quando ela existir:
//
// app.get('/api/musicas/:id/audio', verificarAutenticacao, async (req, res) => {
//   // req.usuario.id e req.usuario.email já estão disponíveis aqui.
//   // Só chega até este ponto quem tiver um tokenSessao válido no header.
// });