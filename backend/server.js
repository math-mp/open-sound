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

// Rota 1: Cadastra o usuário e envia o código 2FA por e-mail
// Armazena a verificação no banco (verificacoes_2fa) em vez de JWT temporário
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
      return res.status(400).json({
        status: 'erro',
        codigo: 'EMAIL_JA_CADASTRADO',
        mensagem: 'Este e-mail já está cadastrado. Por favor, faça login.'
      });
    }

    // 2.Gera o código de 6 dígitos
    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    // 3.Criptografa a senha
    const senhaHash = await bcrypt.hash(password, 10);
    // 4.Gera hash do código 2FA (não salva o código puro no banco)
    const codigoHash = await bcrypt.hash(codigo, 10);
    // 5.Cria identificador único para a verificação
    const idVerificacao = crypto.randomUUID();
    // 6.Define expiração (10 minutos)
    const expiraEm = new Date(Date.now() + 10 * 60 * 1000);
    // 7. Salva no PostgreSQL
    const queryInsertVerificacao = `
      INSERT INTO verificacoes_2fa (id, email, senha_hash, codigo_hash, tentativas, expira_em, ultimo_envio_em)
      VALUES ($1, $2, $3, $4, 0, $5, CURRENT_TIMESTAMP)
    `;
    await pool.query(queryInsertVerificacao, [idVerificacao, email, senhaHash, codigoHash, expiraEm]);

    // 8. Envia o e-mail com o código em texto puro (só para envio)
    try {
      await transporter.sendMail({
        from: `"Open sound" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: 'Seu código de verificação 2FA',
        text: `Seu código de confirmação é: ${codigo}`
      });
    } catch (erroMail) {
      console.error('Erro ao enviar e-mail pelo Nodemailer:', erroMail);
      //Se falhar o envio, remove a verificação criada
      await pool.query('DELETE FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);
      return res.status(500).json({ status: 'erro', mensagem: 'Falha ao enviar o e-mail com o código de verificação.' });
    }

    // 9. Retorna apenas o idVerificacao para o frontend (sem dados sensíveis)
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

// Rota 2: Valida o código 2FA usando o idVerificacao do banco
app.post('/api/validar-2fa', limitarValidacaoIP, async (req, res) => {
  const { codigo, idVerificacao } = req.body;

  if (!codigo || !idVerificacao) {
    return res.status(400).json({ status: 'erro', mensagem: 'Dados incompletos.' });
  }

  try {
    // 1. Busca a verificação no banco
    const resultado = await pool.query('SELECT * FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);
    const verificacao = resultado.rows[0];

    if (!verificacao) {
      return res.status(400).json({ status: 'erro', mensagem: 'Verificação não encontrada ou expirada.' });
    }

    // 2. Verifica se a verificação expirou
    if (new Date(verificacao.expira_em) < new Date()) {
      await pool.query('DELETE FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);
      return res.status(400).json({ status: 'erro', mensagem: 'O tempo limite do código expirou. Solicite um novo cadastro.' });
    }

    // 3. Verifica se excedeu o máximo de tentativas (5)
    if (verificacao.tentativas >= 5) {
      await pool.query('DELETE FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);
      return res.status(429).json({ status: 'erro', mensagem: 'Número máximo de tentativas excedido. Solicite um novo cadastro.' });
    }

    // 4. Compara o código digitado com o hash armazenado
    const codigoConfere = await bcrypt.compare(codigo.trim(), verificacao.codigo_hash);

    if (!codigoConfere) {
      // Incrementa tentativas
      await pool.query('UPDATE verificacoes_2fa SET tentativas = tentativas + 1 WHERE id = $1', [idVerificacao]);
      return res.status(400).json({ status: 'erro', mensagem: 'Código 2FA incorreto.' });
    }

    // 5. Código correto: cria o usuário no PostgreSQL
    const queryInsert = `
      INSERT INTO usuarios (email, senha, verificado)
      VALUES ($1, $2, TRUE)
    `;
    await pool.query(queryInsert, [verificacao.email, verificacao.senha_hash]);

    // 6. Remove a verificação usada
    await pool.query('DELETE FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);

    return res.status(200).json({ status: 'sucesso', mensagem: 'Conta registrada e ativada com sucesso!' });

  } catch (erro) {
    console.error('Erro na validação 2FA:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
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

// Rota 3: Reenvia o código 2FA atualizando o registro no banco
app.post('/api/reenviar-2fa', limitarReenvioIP, async (req, res) => {
  const { idVerificacao } = req.body;

  if (!idVerificacao) {
    return res.status(400).json({ status: 'erro', mensagem: 'Sessão inválida ou expirada.' });
  }

  try {
    // 1. Busca a verificação no banco
    const resultado = await pool.query('SELECT * FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);
    const verificacao = resultado.rows[0];

    if (!verificacao) {
      return res.status(400).json({ status: 'erro', mensagem: 'Sessão inválida ou expirada.' });
    }

    // 2. Verifica se a verificação expirou
    if (new Date(verificacao.expira_em) < new Date()) {
      await pool.query('DELETE FROM verificacoes_2fa WHERE id = $1', [idVerificacao]);
      return res.status(400).json({ status: 'erro', mensagem: 'O tempo limite expirou. Solicite um novo cadastro.' });
    }

    // 3. Validação dos 60 segundos desde o último envio
    const agora = Date.now();
    const tempoDecorrido = Math.floor((agora - new Date(verificacao.ultimo_envio_em).getTime()) / 1000);

    if (tempoDecorrido < 60) {
      const segundosRestantes = 60 - tempoDecorrido;
      return res.status(429).json({
        status: 'erro',
        mensagem: `Aguarde ${segundosRestantes}s para solicitar um novo código.`
      });
    }

    // 4. Gera novo código e hash
    const novoCodigo = Math.floor(100000 + Math.random() * 900000).toString();
    const novoCodigoHash = await bcrypt.hash(novoCodigo, 10);

    // 5. Atualiza o registro no banco (novo código, zera tentativas, atualiza último envio)
    await pool.query(
      'UPDATE verificacoes_2fa SET codigo_hash = $1, tentativas = 0, ultimo_envio_em = CURRENT_TIMESTAMP WHERE id = $2',
      [novoCodigoHash, idVerificacao]
    );

    // 6. Envia o novo e-mail
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

    // ATENÇÃO (trade-off de segurança, feito a pedido): mensagens
    // diferenciadas revelam se um e-mail está cadastrado ou não — o oposto
    // da proteção contra enumeração de contas que existia antes aqui.
    // O campo "codigo" é pro frontend decidir a ação (abrir modal de
    // cadastro) sem depender do texto exato da mensagem.
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

// ============================================================
// UPLOAD E LISTAGEM DE MÚSICAS
// ============================================================

// Recebe os arquivos em memória (buffer) e repassa pro Supabase Storage —
// não grava nada em disco local, então funciona igual em qualquer ambiente.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB por arquivo
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
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 20,
  message: {
    status: 'erro',
    mensagem: 'Muitos uploads a partir deste IP. Tente novamente mais tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rota 5: Upload de música — exige login (verificarAutenticacao) e tem rate limit.
app.post(
  '/api/musicas',
  verificarAutenticacao,
  limitarUploadIP,
  upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'capa', maxCount: 1 }]),
  async (req, res) => {
    try {
      const { titulo, artista } = req.body;
      const arquivoAudio = req.files?.audio?.[0];
      const arquivoCapa = req.files?.capa?.[0];

      if (!titulo || !artista) {
        return res.status(400).json({ status: 'erro', mensagem: 'Título e artista são obrigatórios.' });
      }
      if (!arquivoAudio) {
        return res.status(400).json({ status: 'erro', mensagem: 'O arquivo de áudio é obrigatório.' });
      }

      // Prefixo único evita colisão de nomes se duas pessoas subirem
      // arquivos com o mesmo nome original ao mesmo tempo.
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

      // A capa é opcional — se falhar, não aborta o upload da música inteira.
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

// Rota 6: Lista músicas — pública (navegar/ver o catálogo não exige login,
// só tocar exigirá). Mais recentes primeiro, sem filtros: ORDER BY
// criado_em DESC já resolve o "mostrar recém-uploadadas" sem precisar de
// nenhuma lógica de análise de dados.
app.get('/api/musicas', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM musicas ORDER BY criado_em DESC LIMIT 50');
    return res.status(200).json({ status: 'sucesso', musicas: resultado.rows });
  } catch (erro) {
    console.error('Erro ao listar músicas:', erro);
    return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
  }
});

// Tratador de erro global — pega erros do multer (arquivo grande demais,
// tipo não suportado) e devolve JSON em vez da página de erro padrão do Express.
app.use((erro, req, res, next) => {
  if (erro instanceof multer.MulterError || erro.message?.includes('suportado')) {
    return res.status(400).json({ status: 'erro', mensagem: erro.message });
  }
  console.error('Erro não tratado:', erro);
  return res.status(500).json({ status: 'erro', mensagem: 'Erro interno no servidor.' });
});