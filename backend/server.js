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
    const usuarioExistente = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (usuarioExistente.rows.length > 0) {
      return res.status(400).json({
        status: 'erro',
        codigo: 'EMAIL_JA_CADASTRADO',
        mensagem: 'Este e-mail já está cadastrado. Por favor, faça login.'
      });
    }

    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    const senhaHash = await bcrypt.hash(password, 10);
    const codigoHash = await bcrypt.hash(codigo, 10);
    const idVerificacao = crypto.randomUUID();
    const expiraEm = new Date(Date.now() + 10 * 60 * 1000);

    const queryInsertVerificacao = `
      INSERT INTO verificacoes_2fa (id, email, senha_hash, codigo_hash, tentativas, expira_em, ultimo_envio_em)
      VALUES ($1, $2, $3, $4, 0, $5, CURRENT_TIMESTAMP)
    `;
    await pool.query(queryInsertVerificacao, [idVerificacao, email, senhaHash, codigoHash, expiraEm]);

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
      INSERT INTO usuarios (email, senha, verificado)
      VALUES ($1, $2, TRUE)
    `;
    await pool.query(queryInsert, [verificacao.email, verificacao.senha_hash]);

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
      'SELECT id, email, eh_artista, nome_artista FROM usuarios WHERE id = $1',
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

app.get('/api/musicas', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM musicas ORDER BY criado_em DESC LIMIT 50');
    return res.status(200).json({ status: 'sucesso', musicas: resultado.rows });
  } catch (erro) {
    console.error('Erro ao listar músicas:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

app.use((erro, req, res, next) => {
  if (erro instanceof multer.MulterError || erro.message?.includes('suportado')) {
    return res.status(400).json({ status: 'erro', mensagem: erro.message });
  }
  console.error('Erro não tratado:', erro);
  return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
});