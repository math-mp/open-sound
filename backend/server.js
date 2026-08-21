require('dotenv').config(); //puxa variaveis globais da env
const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const pool = require('./database'); // Importa a conexão com o PostgreSQL
const rateLimit = require('express-rate-limit');

const app = express();
app.use(cors());
app.use(express.json());

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  },
  tls: { rejectUnauthorized: false }
});

// Rota 1: Cadastra o usuário 
app.post('/api/registro', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ status: 'erro', mensagem: 'E-mail e senha são obrigatórios.' });
  }

  try {
    // 1. Busca se o usuário já existe e calcula a diferença de segundos direto pelo banco
  const usuarioExistente = await pool.query(
  `SELECT *, EXTRACT(EPOCH FROM (NOW() - ultimo_envio_2fa))::INT AS diferenca_segundos 
   FROM usuarios 
   WHERE email = $1`,
  [email]
);

if (usuarioExistente.rows.length > 0) {
  const usuario = usuarioExistente.rows[0];

  // Cenário A: Se já estiver verificado, bloqueia
  if (usuario.verificado) {
    return res.status(400).json({ 
      status: 'erro', 
      mensagem: 'Este e-mail já está verificado. Por favor, faça login.' 
    });
  }

  // Cenário B: Se a diferença calculada pelo banco for menor que 60 segundos
  if (usuario.diferenca_segundos !== null && usuario.diferenca_segundos < 60) {
    const segundosRestantes = 60 - usuario.diferenca_segundos;
    return res.status(429).json({
      status: 'erro',
      mensagem: `Um código já foi enviado para este e-mail. Aguarde ${segundosRestantes}s para solicitar outro.`
    });
  }
}

    // 2. Se o e-mail for novo ou não tiver verificado, gera o código 2FA
    const codigo = Math.floor(100000 + Math.random() * 900000).toString();

    // 3. Insere o novo usuário no banco
    // 3. REGISTRA OU ATUALIZA SALVANDO O TIMESTAMP ATUAL (NOW())
    const query = `
      INSERT INTO usuarios (email, senha, codigo_2fa, verificado, ultimo_envio_2fa)
      VALUES ($1, $2, $3, FALSE, NOW())
      ON CONFLICT (email) 
      DO UPDATE SET 
        senha = $2, 
        codigo_2fa = $3, 
        verificado = FALSE, 
        ultimo_envio_2fa = NOW();
    `;

    await pool.query(query, [email, password, codigo]);

    // 4. Envia o e-mail de verificação
    await transporter.sendMail({
      from: `"Open sound" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: 'Seu código de verificação 2FA',
      text: `Seu código de confirmação é: ${codigo}`
    });

    res.status(200).json({ status: 'sucesso', mensagem: 'E-mail enviado e dados salvos!' });

  } catch (erro) {
    console.error('Erro no servidor:', erro);
    res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// Rota 2: Valida o código no PostgreSQL e ativa a conta
app.post('/api/validar-2fa', async (req, res) => {
  const { email, codigo } = req.body;

  try {
    // Busca o usuário pelo e-mail e código 2FA
    const resultado = await pool.query(
      'SELECT * FROM usuarios WHERE email = $1 AND codigo_2fa = $2',
      [email, codigo]
    );

    if (resultado.rows.length === 0) {
      return res.status(400).json({ status: 'erro', mensagem: 'Código incorreto ou inválido.' });
    }

    // Atualiza o status para verificado e limpa o código temporário
    await pool.query(
      'UPDATE usuarios SET verificado = TRUE, codigo_2fa = NULL WHERE email = $1',
      [email]
    );

    res.status(200).json({ status: 'sucesso', mensagem: 'Conta ativada com sucesso!' });
  } catch (erro) {
    console.error('Erro na validação do 2FA:', erro);
    res.status(500).json({ status: 'erro', mensagem: 'Erro interno ao validar o código.' });
  }
});

// ----------------------------------------------------
// BOAS PRÁTICAS: LIMITE DE REQUISIÇÕES POR IP
// Permitir no máximo 5 reenvios por hora por IP
// ----------------------------------------------------
const limitarReenvioIP = rateLimit({
  windowMs: 60 * 60 * 1000, // Janela de 1 hora (em milissegundos)
  max: 5, // Limite de 5 tentativas por IP dentro do intervalo
  message: {
    status: 'erro',
    mensagem: 'Você excedeu o limite de 5 tentativas por hora. Tente novamente mais tarde.'
  },
  standardHeaders: true, // Retorna as informações do limite nos cabeçalhos HTTP
  legacyHeaders: false
});

// Rota 3: Reenvia um novo código 2FA
app.post('/api/reenviar-2fa', limitarReenvioIP, async (req, res) => {
  const { email } = req.body;

  try {
    // 1. Busca o usuário e calcula os segundos passados
    const resultado = await pool.query(
      `SELECT *, EXTRACT(EPOCH FROM (NOW() - ultimo_envio_2fa))::INT AS diferenca_segundos 
      FROM usuarios 
      WHERE email = $1`,
      [email]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ status: 'erro', mensagem: 'Usuário não encontrado.' });
    }

    const usuario = resultado.rows[0];

    if (usuario.verificado) {
      return res.status(400).json({ status: 'erro', mensagem: 'Esta conta já foi verificada.' });
    }

    // 2. Validação dos 60 segundos
    if (usuario.diferenca_segundos !== null && usuario.diferenca_segundos < 60) {
      const segundosRestantes = 60 - usuario.diferenca_segundos;
      return res.status(429).json({
        status: 'erro',
        mensagem: `Aguarde ${segundosRestantes} segundo(s) antes de solicitar outro código.`
      });
    }

    // 3. Gera um novo código de 6 dígitos
    const novoCodigo = Math.floor(100000 + Math.random() * 900000).toString();

    // 4. Atualiza o código e o timestamp do envio no banco de dados
    await pool.query(
      'UPDATE usuarios SET codigo_2fa = $1, ultimo_envio_2fa = NOW() WHERE email = $2',
      [novoCodigo, email]
    );

    // 5. Envia o e-mail
    await transporter.sendMail({
      from: `"Open sound" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: 'Seu novo código de verificação 2FA',
      text: `Seu novo código de confirmação é: ${novoCodigo}`
    });

    return res.status(200).json({
      status: 'sucesso',
      mensagem: 'Novo código enviado com sucesso!'
    });

  } catch (erro) {
    console.error('Erro ao reenviar código:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

app.listen(3000, () => {
  console.log('Servidor rodando na porta 3000 com PostgreSQL');
});
