// ajudantes.js
// Funções pequenas e reutilizáveis pelo server.js. Sem rotas e sem estado.


// ---------- Sistema de Logs de Desenvolvimento ----------
// Fonte única da formatação: todo o resto do projeto chama logInfo/logWarn/
// logError, então remover o sistema inteiro é apagar este bloco e os helpers.
// Controla-se com DEBUG_LOGS=true (ou LOG_LEVEL=debug) no .env. Erro e aviso
// SEMPRE aparecem, independente do flag — silenciar erro esconde problema.
const DEBUG_LOGS = process.env.DEBUG_LOGS === 'true' || process.env.LOG_LEVEL === 'debug';

function logTimestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(prefixo, nivel, mensagem, dados = null) {
  const ts = logTimestamp();
  const saida = `[${ts}] [${prefixo}] ${mensagem}${dados ? ` ${JSON.stringify(dados)}` : ''}`;
  if (nivel === 'error') {
    console.error(saida);
  } else if (nivel === 'warn') {
    console.warn(saida);
  } else if (DEBUG_LOGS) {
    console.log(saida);
  }
}

function logInfo(prefixo, mensagem, dados = null) {
  log(prefixo, 'info', mensagem, dados);
}

function logWarn(prefixo, mensagem, dados = null) {
  log(prefixo, 'warn', mensagem, dados);
}

function logError(prefixo, mensagem, dados = null) {
  log(prefixo, 'error', mensagem, dados);
}

// ---------- erros de regra de negócio ----------
// Lançados dentro de transações; as rotas traduzem cada um para o status certo.
class UsuarioInexistente extends Error {}
class MusicaInexistente extends Error {}
class LimiteDePlaylists extends Error {}

// ---------- contagem de caracteres ----------
// `.length` conta unidades UTF-16 (emoji = 2); o Postgres conta pontos de
// código (emoji = 1). O spread converte em pontos de código.
const tamanhoEmCaracteres = (texto) => [...texto].length;

// Aceita só inteiros positivos "de verdade" (nada de "12abc", 1.5 ou "").
function paraIdValido(valor) {
  const numero = typeof valor === 'string' && /^\d+$/.test(valor) ? Number(valor) : valor;
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

// ---------- nome de usuário (@) e nome de exibição ----------
// Modelo Discord: o @ é um identificador estrito e único; o nome que
// aparece na tela é livre e pode ter acento, espaço e emoji.
//
// A regra do @ mora aqui (e não no server.js) porque o servidor valida o
// que chega na requisição E o database.js usa o mesmo padrão para
// normalizar as contas antigas. Duplicar a regra faria os dois lados
// divergirem com o tempo.
const NOME_USUARIO_MIN = 3;
const NOME_USUARIO_MAX = 28;
const NOME_EXIBICAO_MAX = 40;

// Montado a partir das constantes para o padrão não poder sair de sincronia.
const PADRAO_NOME_USUARIO = new RegExp(
  `^[A-Za-z0-9._-]{${NOME_USUARIO_MIN},${NOME_USUARIO_MAX}}$`
);

// Sem espaços, sem acento, sem emoji: é o que permite um @ estável na URL.
const nomeUsuarioValido = (valor) =>
  typeof valor === 'string' && PADRAO_NOME_USUARIO.test(valor);

// Erros de digitação mais comuns, com a dica do que trocar.
const MENSAGENS_NOME_USUARIO = {
  vazio: 'Escolha um nome de usuário para a sua conta.',
  curto: `O @ precisa ter pelo menos ${NOME_USUARIO_MIN} caracteres.`,
  longo: `O @ pode ter no máximo ${NOME_USUARIO_MAX} caracteres.`,
  caracteres: 'O @ só pode ter letras, números, ponto (.), underline (_) e hífen (-). Sem espaços.'
};

// Devolve a mensagem certa para um @ inválido, ou null quando ele é válido.
function mensagemNomeUsuarioInvalido(valor) {
  if (typeof valor !== 'string' || !valor.trim()) return MENSAGENS_NOME_USUARIO.vazio;
  const tamanho = tamanhoEmCaracteres(valor);
  if (tamanho < NOME_USUARIO_MIN) return MENSAGENS_NOME_USUARIO.curto;
  if (tamanho > NOME_USUARIO_MAX) return MENSAGENS_NOME_USUARIO.longo;
  if (!PADRAO_NOME_USUARIO.test(valor)) return MENSAGENS_NOME_USUARIO.caracteres;
  return null;
}

// Base plausível a partir do e-mail: parte antes do @, só com os
// caracteres permitidos, cortada no limite e sem pontuação na borda.
function baseDeNomeDeUsuario(email) {
  const local = String(email || '').split('@')[0] || '';
  let base = local
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '')
    .replace(/^[._-]+/, '')
    .replace(/[._-]+$/, '');

  if (base.length > NOME_USUARIO_MAX) {
    base = base.slice(0, NOME_USUARIO_MAX).replace(/[._-]+$/, '');
  }
  if (base.length < NOME_USUARIO_MIN) base = `${base}user`.slice(0, NOME_USUARIO_MAX);
  return base || 'user';
}

// primeiro @ livre a partir da base, com sufixo numérico quando precisa.
// `usados` é um Set com os @ já ocupados, em minúsculas.
function gerarNomeDeUsuario(email, usados) {
  const ocupados = usados instanceof Set ? usados : new Set();
  const base = baseDeNomeDeUsuario(email);
  if (!ocupados.has(base.toLowerCase())) return base;

  for (let numero = 2; numero < 10000; numero++) {
    const sufixo = String(numero);
    const limite = NOME_USUARIO_MAX - sufixo.length;
    const tronco = base.length > limite ? base.slice(0, limite).replace(/[._-]+$/, '') : base;
    const tentativa = `${tronco}${sufixo}`;
    if (tentativa.length >= NOME_USUARIO_MIN && !ocupados.has(tentativa.toLowerCase())) {
      return tentativa;
    }
  }
  // Só chega aqui com a base inteira ocupada; o número aleatório é o
  // último recurso para nunca devolver um @ que já existe.
  return `${base.slice(0, NOME_USUARIO_MAX - 7)}${Math.floor(Math.random() * 1e6)}`;
}

// @ em uso? Considera tanto as contas já criadas quanto os cadastros
// pendentes de 2FA, que guardam o @ antes de a conta existir — senão a
// pessoa só descobriria a colisão depois de confirmar o e-mail.
async function nomeDeUsuarioDisponivel(pool, nomeUsuario, ignorarUsuarioId = null) {
  const taken = await pool.query(
    `SELECT 1 FROM usuarios
      WHERE LOWER(nome_usuario) = LOWER($1)
        AND ($2::int IS NULL OR id <> $2)
      LIMIT 1`,
    [nomeUsuario, ignorarUsuarioId]
  );
  if (taken.rows.length > 0) return false;

  const reservado = await pool.query(
    `SELECT 1 FROM verificacoes_2fa
      WHERE LOWER(nome_usuario) = LOWER($1)
        AND expira_em > CURRENT_TIMESTAMP
      LIMIT 1`,
    [nomeUsuario]
  );
  return reservado.rows.length === 0;
}


// ---------- validação real de arquivos (pelos bytes, não pelo MIME) ----------

const TIPOS_IMAGEM = {
  'image/png': { extensao: 'png' },
  'image/jpeg': { extensao: 'jpg' },
  'image/webp': { extensao: 'webp' }
};

// O mimetype enviado pelo cliente é só uma declaração e é trivial de forjar.
// Como o bucket é público, decidimos pelos primeiros bytes.
function detectarTipoImagem(buffer) {
  if (!buffer || buffer.length < 12) return null;

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ...TIPOS_IMAGEM['image/png'] };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ...TIPOS_IMAGEM['image/jpeg'] };
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mime: 'image/webp', ...TIPOS_IMAGEM['image/webp'] };
  }
  return null;
}

// ---------- detecção de GIF (só banner e fundo de página) ----------
// detectarTipoImagem acima é compartilhado com avatar e capa de playlist
// e NÃO aceita GIF de propósito: avatar e capa são um quadro só, e GIF
// ali não faria sentido. Este é um detector separado, com o mesmo
// formato de retorno, usado apenas onde a animação faz sentido.
const TIPOS_IMAGEM_ANIMADA = {
  'image/gif': { extensao: 'gif' }
};

function detectarTipoImagemComGif(buffer) {
  const gif = detectarGif(buffer);
  if (gif) return gif;
  // sem GIF, cai no detector de sempre (PNG/JPEG/WEBP), que é o
  // comportamento já validado nos outros dois usos.
  return detectarTipoImagem(buffer);
}

function detectarGif(buffer) {
  if (!buffer || buffer.length < 6) return null;
  const assinatura = buffer.subarray(0, 6).toString('ascii');
  if (assinatura !== 'GIF87a' && assinatura !== 'GIF89a') return null;
  return { mime: 'image/gif', ...TIPOS_IMAGEM_ANIMADA['image/gif'] };
}

// MP3 (com ou sem tag ID3), WAV e OGG.
function detectarTipoAudio(buffer) {
  if (!buffer || buffer.length < 12) return null;

  const inicio = buffer.subarray(0, 4).toString('ascii');
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) {
    return { mime: 'audio/mpeg', extensao: 'mp3' };
  }
  if (inicio === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') {
    return { mime: 'audio/wav', extensao: 'wav' };
  }
  if (inicio === 'OggS') {
    return { mime: 'audio/ogg', extensao: 'ogg' };
  }
  return null;
}

// ---------- integridade referencial ----------
//   23503 -> chave estrangeira (a linha referenciada sumiu)
//   23505 -> restrição única (duplicata)
const ehViolacaoDeChave = (erro, codigos = ['23503', '23505']) =>
  Boolean(erro) && codigos.includes(erro.code);

const ehMusicaSumida = (erro) =>
  erro instanceof MusicaInexistente || ehViolacaoDeChave(erro, ['23503']);

// ---------- transação com trava de linha por usuário ----------
// Requisições do MESMO usuário rodam em fila; usuários diferentes seguem em
// paralelo. FOR NO KEY UPDATE (e não FOR UPDATE) para não conflitar com o
// FOR KEY SHARE que o Postgres toma ao validar chaves estrangeiras.
async function comTravaDoUsuario(pool, usuarioId, trabalho) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const trava = await client.query(
      'SELECT id FROM usuarios WHERE id = $1 FOR NO KEY UPDATE',
      [usuarioId]
    );
    if (trava.rows.length === 0) throw new UsuarioInexistente();

    const resultado = await trabalho(client);

    await client.query('COMMIT');
    return resultado;
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}

// ---------- personalização visual do perfil ----------
// Tudo que o usuário escolhe é validado por lista fechada (whitelist) ou
// por formato. Nada do que vem do navegador entra no CSS ou no HTML sem
// passar por aqui: é o que impede alguém de injetar regra de estilo pela
// própria personalização.

// Cada aba tem a sua cor: são três, não uma. Guardar as três juntas num
// objeto é o que permite a página pintar cada etiqueta com a sua.
const CHAVES_ACENTO = ['perfil', 'config', 'biblioteca'];

// Cor tem que ser #RRGGBB, nada mais. Anchoring nos dois lados impede que
// "red; background:url(...)" passe como se fosse uma cor.
const REGEX_COR = /^#[0-9a-fA-F]{6}$/;

const BORDAS_AVATAR = ['nenhuma', 'tracejada', 'brilho', 'arcoiris', 'holo', 'glitch'];
const FONTES_NOME = ['padrao', 'baloo', 'terminal', 'serifada'];
const EFEITOS_PERFIL = ['nenhum', 'chuva', 'petalas', 'fogo', 'estrelas', 'nevoa'];

// Cores de fábrica por aba, quando a pessoa ainda não escolheu nenhuma.
// São as pastéis que já existem no tema.
const ACENTOS_PADRAO = {
  perfil: '#cfbaf0',
  config: '#fde4cf',
  biblioteca: '#98f5e1'
};

const corValida = (valor) => typeof valor === 'string' && REGEX_COR.test(valor);

// Uma cor que não está na lista vira a cor padrão da aba, em vez de dar
// erro: é o comportamento que não quebra a página se um dia o valor
// gravado for de uma opção que saiu do ar.
const acentoSeguro = (chave, valor) =>
  (corValida(valor) ? valor.toLowerCase() : ACENTOS_PADRAO[chave]);

const emLista = (valor, lista, padrao) =>
  (typeof valor === 'string' && lista.includes(valor) ? valor : padrao);

// Aceita só as chaves conhecidas e descarta o resto. Devolve o objeto
// completo (com padrões preenchidos), para o front nunca receber um
// campo faltando.
function normalizarPersonalizacao(bruto) {
  const entrada = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};

  const acentos = {};
  CHAVES_ACENTO.forEach((chave) => {
    acentos[chave] = acentoSeguro(chave, entrada.acentos && entrada.acentos[chave]);
  });

  const degradê = entrada.degrade_nome && typeof entrada.degrade_nome === 'object'
    ? {
        // a segunda cor é opcional: com uma só, o nome fica sólido
        cor1: corValida(entrada.degrade_nome.cor1) ? entrada.degrade_nome.cor1.toLowerCase() : null,
        cor2: corValida(entrada.degrade_nome.cor2) ? entrada.degrade_nome.cor2.toLowerCase() : null
      }
    : { cor1: null, cor2: null };

  return {
    acentos,
    borda_avatar: emLista(entrada.borda_avatar, BORDAS_AVATAR, 'nenhuma'),
    fonte_nome: emLista(entrada.fonte_nome, FONTES_NOME, 'padrao'),
    efeito: emLista(entrada.efeito, EFEITOS_PERFIL, 'nenhum'),
    textura_banner: entrada.textura_banner === true,
    degrade_nome: degradê
  };
}

// Texto legível sobre a cor escolhida. A referência SteamWave usava um
// quase-preto fixo e ficava ilegível com acento claro; aqui a escolha é
// calculada pela luminância relativa do WCAG (fórmula de contraste da
// especificação, a mesma usada em medidores de acessibilidade).
const luminanciaRelativa = (corHex) => {
  const n = parseInt(String(corHex).slice(1), 16);
  const canal = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal((n >> 16) & 255)
       + 0.7152 * canal((n >> 8) & 255)
       + 0.0722 * canal(n & 255);
};

// Razão de contraste do WCAG entre duas luminâncias: (Lclaro + 0.05) /
// (Lescuro + 0.05). É o mesmo número que o Leitor de Contraste do
// navegador mostra.
const razaoDeContraste = (a, b) => {
  const [claro, escuro] = a > b ? [a, b] : [b, a];
  return (claro + 0.05) / (escuro + 0.05);
};

// Escolhe o tom de texto sobre uma cor escolhida pelo usuário.
//
// A ordem importa: o tom do tema vem PRIMEIRO e é usado sempre que ele
// já passa de 4.5:1 (WCAG AA). Assim a paleta do site é preservada no
// caso normal — quase todo pastel escolhido passa fácil. Só quando nem o
// tom do tema nem o tom claro chegam a 4.5:1 (a faixa do cinza médio,
// em que os dois empatam perto de 4:1) é que se cai nos extremos
// preto/branco, que são a única garantia de não ficar ilegível.
const TONS_ESCUROS = { escuro: '#3a3350', claro: '#302a34' };
const TOM_CLARO = '#fff8f3';
const TOM_EXTREMOS = ['#000000', '#ffffff'];
const MINIMO_AA = 4.5;

function corDeTextoSobre(corHex, temaClaro) {
  const fundo = luminanciaRelativa(corHex);

  const tomDoTema = temaClaro ? TONS_ESCUROS.claro : TONS_ESCUROS.escuro;
  if (razaoDeContraste(fundo, luminanciaRelativa(tomDoTema)) >= MINIMO_AA) return tomDoTema;

  if (razaoDeContraste(fundo, luminanciaRelativa(TOM_CLARO)) >= MINIMO_AA) return TOM_CLARO;

  let melhor = TOM_EXTREMOS[0];
  let melhorRazao = -1;
  TOM_EXTREMOS.forEach((tom) => {
    const razao = razaoDeContraste(fundo, luminanciaRelativa(tom));
    if (razao > melhorRazao) { melhorRazao = razao; melhor = tom; }
  });
  return melhor;
}

// ---------- status do perfil ----------
// Emoji + texto curto ao lado do avatar.

// O texto é medido em GRAFEMAS, não em unidades de código: um emoji
// como 👨‍👩‍👧 são várias unidades de código (7), e `.length` cortaria
// o status no meio da pessoa. O Intl.Segmenter é o jeito certo e é o
// mesmo que o front usa, para os dois lados concordarem no corte.
const STATUS_TEXTO_MAX = 40;
const STATUS_EMOJI_MAX = 1;

// Separa o texto em grafemas. O Intl.Segmenter é o jeito certo e é o
// mesmo que o front usa, para os dois lados concordarem no corte.
const grafemasDe = (texto) => {  const valor = typeof texto === 'string' ? texto : '';
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' });
    return Array.from(segmenter.segment(valor), (parte) => parte.segment);
  }
  // Node/navegador sem Segmenter: array de pontos de código. Não é
  // perfeito para emoji composto, mas nunca deixa passar mais do que o
  // limite — que é o que importa para não gravar lixo.
  return Array.from(valor);
};

// NÚMERO de grafemas. Precisa devolver número e não a lista: comparar
// um array com `>` o converte para NaN por causa do toString, e
// `NaN > 40` é false — ou seja, a validação passaria qualquer tamanho.
const contarGrafemas = (texto) => grafemasDe(texto).length;

// Recorta em grafemas (nunca no meio de um emoji).
const recortarPorGrafemas = (texto, limite) => grafemasDe(texto).slice(0, limite).join('');

// ---------- limpeza de arquivos no Storage (melhor-esforço) ----------

// Transforma a URL pública de volta no caminho dentro do bucket.
function extrairCaminhoNoBucket(urlPublica, bucket) {
  if (!urlPublica) return null;
  const marcador = `/storage/v1/object/public/${bucket}/`;
  const indice = urlPublica.indexOf(marcador);
  if (indice === -1) return null;
  return urlPublica.slice(indice + marcador.length);
}

// Apaga vários arquivos de uma vez. Nunca lança: um arquivo órfão não pode
// impedir a operação que chamou isto.
async function removerArquivosDoStorage(supabase, bucket, urlsPublicas) {
  const caminhos = urlsPublicas
    .map((url) => extrairCaminhoNoBucket(url, bucket))
    .filter(Boolean);

  if (caminhos.length === 0) return false;

  let tudoCerto = true;
  for (let i = 0; i < caminhos.length; i += 100) {
    const { error } = await supabase.storage.from(bucket).remove(caminhos.slice(i, i + 100));
    if (error) {
      logError('ERROR', 'Não foi possível apagar arquivos do Storage', { codigo: error.code, mensagem: error.message });
      tudoCerto = false;
    }
  }
  return tudoCerto;
}

const removerArquivoDoStorage = (supabase, bucket, urlPublica) =>
  removerArquivosDoStorage(supabase, bucket, [urlPublica]);

module.exports = {
  UsuarioInexistente,
  MusicaInexistente,
  LimiteDePlaylists,
  tamanhoEmCaracteres,
  paraIdValido,
  NOME_USUARIO_MIN,
  NOME_USUARIO_MAX,
  NOME_EXIBICAO_MAX,
  PADRAO_NOME_USUARIO,
  nomeUsuarioValido,
  mensagemNomeUsuarioInvalido,
  baseDeNomeDeUsuario,
  gerarNomeDeUsuario,
  nomeDeUsuarioDisponivel,
  TIPOS_IMAGEM,
  detectarTipoImagem,
  detectarTipoImagemComGif,
  detectarGif,
  CHAVES_ACENTO,
  ACENTOS_PADRAO,
  BORDAS_AVATAR,
  FONTES_NOME,
  EFEITOS_PERFIL,
  corValida,
  normalizarPersonalizacao,
  STATUS_TEXTO_MAX,
  STATUS_EMOJI_MAX,
  contarGrafemas,
  recortarPorGrafemas,
  luminanciaRelativa,
  razaoDeContraste,
  corDeTextoSobre,
  detectarTipoAudio,
  ehViolacaoDeChave,
  ehMusicaSumida,
  comTravaDoUsuario,
  extrairCaminhoNoBucket,
  removerArquivosDoStorage,
  removerArquivoDoStorage,
  logInfo,
  logWarn,
  logError,
  DEBUG_LOGS
};