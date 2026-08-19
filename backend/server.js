const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const pool = require('./database'); // Importa a conexão com o PostgreSQL

const app = express();
app.use(cors());
app.use(express.json());

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'matheus.minami.pacheco10@gmail.com',
    pass: 'gysy mvba vzkl gfbk'
  },
  tls: { rejectUnauthorized: false }
});

// Rota 1: Cadastra o usuário apenas se o e-mail for novo
app.post('/api/registro', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ status: 'erro', mensagem: 'E-mail e senha são obrigatórios.' });
  }

  try {
    // 1. Verifica se o e-mail já existe no PostgreSQL
    const usuarioExistente = await pool.query(
      'SELECT * FROM usuarios WHERE email = $1',
      [email]
    );

    // Se encontrar algum registro, bloqueia o envio
    if (usuarioExistente.rows.length > 0) {
      return res.status(400).json({ 
        status: 'erro', 
        mensagem: 'Este e-mail já está cadastrado. Tente fazer login.' 
      });
    }

    // 2. Se o e-mail for novo, gera o código 2FA
    const codigo = Math.floor(100000 + Math.random() * 900000).toString();

    // 3. Insere o novo usuário no banco
    const queryInsert = `
      INSERT INTO usuarios (email, senha, codigo_2fa, verificado)
      VALUES ($1, $2, $3, FALSE)
    `;
    await pool.query(queryInsert, [email, password, codigo]);

    // 4. Envia o e-mail de verificação
    await transporter.sendMail({
      from: '"Spotify Clone" <matheus.minami.pacheco10@gmail.com>',
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

// Rota 3: Reenvia um novo código 2FA
app.post('/api/reenviar-2fa', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ status: 'erro', mensagem: 'e-mail não identificado. Recarregue a página e tente novamente.' });
  }

  try {
    // 1. Verifica se o e-mail realmente está cadastrado no banco
    const usuario = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);

    if (usuario.rows.length === 0) {
      return res.status(404).json({ status: 'erro', mensagem: 'E-mail não encontrado.' });
    }

    // 2. Gera um novo código de 6 dígitos
    const novoCodigo = Math.floor(100000 + Math.random() * 900000).toString();

    // 3. Atualiza o código do usuário no PostgreSQL
    await pool.query(
      'UPDATE usuarios SET codigo_2fa = $1 WHERE email = $2',
      [novoCodigo, email]
    );

    // 4. Reenvia o e-mail com o novo código
    await transporter.sendMail({
      from: '"Spotify Clone" <seu.email@gmail.com>',
      to: email,
      subject: 'Seu novo código de verificação 2FA',
      text: `Seu novo código de confirmação é: ${novoCodigo}`
    });

    res.status(200).json({ status: 'sucesso', mensagem: 'Novo código enviado para o seu e-mail!' });

  } catch (erro) {
    console.error('Erro ao reenviar código:', erro);
    res.status(500).json({ status: 'erro', mensagem: 'Falha ao reenviar o código.' });
  }
});

app.listen(3000, () => {
  console.log('Servidor rodando na porta 3000 com PostgreSQL');
});

