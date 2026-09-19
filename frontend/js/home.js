// ============================================================
// TEMA CLARO / ESCURO
// ============================================================
// Ativa/desativa [data-theme="light"] na <html>, que é o seletor
// usado pelo theme.css para trocar as variáveis de cor.
const btnTema = document.getElementById('btn-tema');
const CHAVE_TEMA = 'temaOpenSound';

function aplicarTema(tema) {
  if (tema === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  if (btnTema) btnTema.textContent = tema === 'light' ? '🌙' : '☀️';
}

aplicarTema(localStorage.getItem(CHAVE_TEMA) || 'dark');

if (btnTema) {
  btnTema.addEventListener('click', () => {
    const temaAtual = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const novoTema = temaAtual === 'light' ? 'dark' : 'light';
    localStorage.setItem(CHAVE_TEMA, novoTema);
    aplicarTema(novoTema);
  });
}

// ============================================================
// HOME: MÚSICAS POPULARES / ARTISTAS / GÊNEROS
// ============================================================
// =====================================================
// MOCK
// DADOS TEMPORÁRIOS PARA DESENVOLVIMENTO
// SUBSTITUIR PELA API (GET /api/home) QUANDO O BACK-END ESTIVER PRONTO
// =====================================================
const homeMock = {
  musicasPopulares: [
    { id: 1, titulo: 'Amor de Primavera', artista: 'oShaman', capa: '', vinil: '' },
    { id: 2, titulo: 'Música 2', artista: 'Artista 2', capa: '' },
    { id: 3, titulo: 'Música 3', artista: 'Artista 3', capa: '' },
    { id: 4, titulo: 'Música 4', artista: 'Artista 4', capa: '' },
    { id: 5, titulo: 'Música 5', artista: 'Artista 5', capa: '' },
    { id: 6, titulo: 'Música 6', artista: 'Artista 6', capa: '' },
    { id: 7, titulo: 'Música 7', artista: 'Artista 7', capa: '' }
  ],
  artistasPopulares: [
    { id: 10, nome: 'oShaman', avatar: '', ouvintesMensais: 151669, reproducoesMes: 600959 },
    { id: 11, nome: 'Artista 2', avatar: '', ouvintesMensais: 98234, reproducoesMes: 320441 }
  ],
  generos: [
    { id: 1, nome: 'Rádio', imagem: '' },
    { id: 2, nome: 'Forró & Brega', imagem: '' },
    { id: 3, nome: 'MPB', imagem: '' },
    { id: 4, nome: 'Rock', imagem: '' }
  ]
};
// FIM DO MOCK
// =====================================================

// Índice da música atualmente em destaque no carrossel (a que está "aberta").
// Começa em 0 (primeira música do mock/API).
let indiceMscAtual = 0;

// Monta o card de destaque (música atualmente em foco no carrossel). Recebe
// um objeto de música no mesmo formato que GET /api/home vai devolver.
function criarDestaqueMusica(musica) {
  const div = document.createElement('div');
  div.className = 'msc-destaque';

  const capaWrap = document.createElement('div');
  capaWrap.className = 'msc-capa';

  const imgCapa = document.createElement('img');
  imgCapa.className = 'msc-capa-img';
  imgCapa.src = musica.capa || '';
  imgCapa.alt = 'Capa do álbum';

  const imgVinil = document.createElement('img');
  imgVinil.className = 'msc-vinil';
  imgVinil.src = musica.vinil || '';
  imgVinil.alt = '';
  imgVinil.setAttribute('aria-hidden', 'true');

  capaWrap.appendChild(imgCapa);
  capaWrap.appendChild(imgVinil);

  const info = document.createElement('div');
  info.className = 'msc-info';

  const nome = document.createElement('h3');
  nome.className = 'msc-nome';
  nome.textContent = musica.titulo;

  const artista = document.createElement('p');
  artista.className = 'msc-artista';
  artista.textContent = musica.artista;

  const btnPlay = document.createElement('button');
  btnPlay.type = 'button';
  btnPlay.className = 'btn-play';
  btnPlay.setAttribute('aria-label', 'Tocar música');
  btnPlay.textContent = '▶';

  info.appendChild(nome);
  info.appendChild(artista);
  info.appendChild(btnPlay);

  div.appendChild(capaWrap);
  div.appendChild(info);

  return div;
}

// Monta uma mini-capa clicável (usada tanto pras músicas já vistas à
// esquerda quanto pras próximas à direita). Clicar nela chama focarMusica
// com a posição real dela dentro da lista completa.
function criarMiniCapa(musica, indiceReal, classeExtra) {
  const img = document.createElement('img');
  img.className = classeExtra;
  img.src = musica.capa || '';
  img.alt = `Capa da música ${musica.titulo || ''}`.trim();
  img.addEventListener('click', () => focarMusica(indiceReal));
  return img;
}

// Renderiza o destaque + as mini-capas (já vistas à esquerda, próximas à
// direita) dentro de #msc-wrapper, com base em indiceMscAtual.
// "lista" é o array "musicasPopulares" (mock ou vindo da API futuramente).
function renderMusicasPopulares(lista) {
  const wrapper = document.getElementById('msc-wrapper');
  if (!wrapper || !Array.isArray(lista) || lista.length === 0) return;

  if (indiceMscAtual < 0) indiceMscAtual = 0;
  if (indiceMscAtual > lista.length - 1) indiceMscAtual = lista.length - 1;

  wrapper.innerHTML = '';

  // Músicas antes do índice atual = "já vistas", viram mini-capa à esquerda
  const anteriores = document.createElement('div');
  anteriores.className = 'msc-anteriores';
  lista.slice(0, indiceMscAtual).forEach((musica, i) => {
    anteriores.appendChild(criarMiniCapa(musica, i, 'msc-mini'));
  });
  wrapper.appendChild(anteriores);

  // Música do índice atual = destaque (capa + vinil + título + artista + play)
  wrapper.appendChild(criarDestaqueMusica(lista[indiceMscAtual]));

  // Músicas depois do índice atual = "próximas", continuam na tira do carrossel
  const carrossel = document.createElement('div');
  carrossel.className = 'msc-carrossel';
  lista.slice(indiceMscAtual + 1).forEach((musica, i) => {
    const indiceReal = indiceMscAtual + 1 + i;
    carrossel.appendChild(criarMiniCapa(musica, indiceReal, 'msc-carrossel-item'));
  });
  wrapper.appendChild(carrossel);
}

// Troca a música em foco do carrossel e renderiza de novo.
function focarMusica(novoIndice) {
  indiceMscAtual = novoIndice;
  renderMusicasPopulares(homeMock.musicasPopulares);
}

// Setas de navegação: avançam/voltam uma música por vez.
const btnMscSetaEsq = document.getElementById('msc-seta-esq');
const btnMscSetaDir = document.getElementById('msc-seta-dir');

if (btnMscSetaEsq) {
  btnMscSetaEsq.addEventListener('click', () => {
    if (indiceMscAtual > 0) focarMusica(indiceMscAtual - 1);
  });
}

if (btnMscSetaDir) {
  btnMscSetaDir.addEventListener('click', () => {
    if (indiceMscAtual < homeMock.musicasPopulares.length - 1) focarMusica(indiceMscAtual + 1);
  });
}

// Monta um <li> do ranking de artistas mais tocados.
function criarItemArtista(artista, posicao) {
  const li = document.createElement('li');
  li.className = 'art-item';

  const posicaoSpan = document.createElement('span');
  posicaoSpan.className = 'art-posicao';
  posicaoSpan.textContent = `${posicao}º`;

  const card = document.createElement('div');
  card.className = 'art-card';

  const avatar = document.createElement('img');
  avatar.className = 'art-avatar';
  avatar.src = artista.avatar || '';
  avatar.alt = `Foto de ${artista.nome}`;

  const info = document.createElement('div');
  info.className = 'art-info';

  const nome = document.createElement('h3');
  nome.className = 'art-nome';
  nome.textContent = artista.nome;

  const ouvintes = document.createElement('p');
  ouvintes.className = 'art-ouvintes';
  ouvintes.textContent = `${(artista.ouvintesMensais || 0).toLocaleString('pt-BR')} ouvintes mensais`;

  const reproducoes = document.createElement('p');
  reproducoes.className = 'art-reproducoes';
  const reproducoesNum = document.createElement('span');
  reproducoesNum.className = 'art-reproducoes-num';
  reproducoesNum.textContent = (artista.reproducoesMes || 0).toLocaleString('pt-BR');
  reproducoes.appendChild(reproducoesNum);
  reproducoes.appendChild(document.createTextNode(' Reproduções neste mês'));

  info.appendChild(nome);
  info.appendChild(ouvintes);
  info.appendChild(reproducoes);

  const btnFavoritar = document.createElement('button');
  btnFavoritar.type = 'button';
  btnFavoritar.className = 'btn-favoritar';
  btnFavoritar.setAttribute('aria-label', `Favoritar ${artista.nome}`);
  btnFavoritar.textContent = '♥';

  card.appendChild(avatar);
  card.appendChild(info);
  card.appendChild(btnFavoritar);

  li.appendChild(posicaoSpan);
  li.appendChild(card);

  return li;
}

// Renderiza o ranking inteiro dentro de #art-lista.
function renderArtistasPopulares(lista) {
  const listaEl = document.getElementById('art-lista');
  if (!listaEl || !Array.isArray(lista)) return;

  listaEl.innerHTML = '';
  lista.forEach((artista, indice) => {
    listaEl.appendChild(criarItemArtista(artista, indice + 1));
  });
}

// Monta um card de gênero.
function criarCardGenero(genero) {
  const div = document.createElement('div');
  div.className = 'gen-card';

  const nome = document.createElement('h3');
  nome.className = 'gen-nome';
  nome.textContent = genero.nome;

  const img = document.createElement('img');
  img.className = 'gen-img';
  img.src = genero.imagem || '';
  img.alt = '';

  div.appendChild(nome);
  div.appendChild(img);

  return div;
}

// Renderiza a grade de gêneros dentro de #gen-grid.
function renderGeneros(lista) {
  const grid = document.getElementById('gen-grid');
  if (!grid || !Array.isArray(lista)) return;

  grid.innerHTML = '';
  lista.forEach((genero) => {
    grid.appendChild(criarCardGenero(genero));
  });
}

// Por enquanto usa o MOCK acima. Quando GET /api/home existir no back-end,
// é só trocar estas 3 linhas por um fetch, ex:
//
// fetch('http://localhost:3000/api/home')
//   .then((r) => r.json())
//   .then((dados) => {
//     renderMusicasPopulares(dados.musicasPopulares);
//     renderArtistasPopulares(dados.artistasPopulares);
//     renderGeneros(dados.generos);
//   });
renderMusicasPopulares(homeMock.musicasPopulares);
renderArtistasPopulares(homeMock.artistasPopulares);
renderGeneros(homeMock.generos);

// === ELEMENTOS DO DOM ===
const modal = document.getElementById('modal-registro');
const btnFechar = document.getElementById('btn-fechar');
const formRegistro = document.getElementById('form-registro');
const etapaRegistro = document.getElementById('etapa-registro');
const etapa2fa = document.getElementById('etapa-2fa');
const btnRegister = document.getElementById('btn-register');
const btnSubmitRegistro = formRegistro ? formRegistro.querySelector('button[type="submit"]') : null;

const inputSenha = document.getElementById('input-senha');
const btnToggleSenha = document.getElementById('btn-toggle-senha');

// Elementos das Regras de Senha
const regraTam = document.getElementById('regra-tam');
const regraMai = document.getElementById('regra-mai');
const regraMin = document.getElementById('regra-min');
const regraNum = document.getElementById('regra-num');
const regraEsp = document.getElementById('regra-esp');

// Elementos da Etapa 2FA (Grade OTP e Máscara)
const btnConfirmar2FA = document.getElementById('btn-confirmar-2fa');
const btnReenviar2FA = document.getElementById('btn-reenviar-2fa');
const mensagemTimer = document.getElementById('mensagem-timer');
const inputsOTP = document.querySelectorAll('.input-otp');
const spanEmailMascarado = document.getElementById('email-mascarado');

// Elementos do Modal/Etapa de Login
const modalLogin = document.getElementById('modal-login');
const btnFecharLogin = document.getElementById('btn-fechar-login');
const formLogin = document.getElementById('form-login');
const btnEntrar = document.getElementById('btn-entrar');
const btnSair = document.getElementById('btn-sair');

// Elementos do Modal de Upload e do Container Universal de Músicas
const modalUpload = document.getElementById('modal-upload');
const btnFecharUpload = document.getElementById('btn-fechar-upload');
const formUpload = document.getElementById('form-upload');
const btnUpload = document.getElementById('btn-upload');
const listaMusicas = document.getElementById('lista-musicas');

// Regex de Validação
const regexEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const regexSenha = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@()!%*?&#])[A-Za-z\d@()!%*?&#]{8,}$/;

let emailUsuarioAtual = '';
let tempoRestante = 60;
let intervaloTimer = null;
let idVerificacaoAtual = '';

// === FUNÇÃO PARA MASCARAR E-MAIL ===
// CORREÇÃO: os "${...}" tinham virado "\(...\)" (provável erro de escape ao colar).
function mascararEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [usuario, dominio] = email.split('@');
  if (usuario.length <= 2) {
    return `${usuario[0]}***@${dominio}`;
  }
  return `${usuario.slice(0, 2)}***${usuario.slice(-1)}@${dominio}`;
}

// === CONTROLE E NAVEGAÇÃO DOS INPUTS OTP (6 DÍGITOS) ===
inputsOTP.forEach((input, index) => {
  // Garante apenas números e avança o foco automaticamente
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '');
    if (input.value && index < inputsOTP.length - 1) {
      inputsOTP[index + 1].focus();
    }
  });

  // Volta o foco ao apertar Backspace em um campo vazio
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && index > 0) {
      inputsOTP[index - 1].focus();
    }
  });

  // Suporte a colar o código completo de 6 dígitos
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const dadosColados = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
    if (dadosColados) {
      dadosColados.split('').forEach((char, i) => {
        if (inputsOTP[i]) inputsOTP[i].value = char;
      });
      const proximoVazio = Array.from(inputsOTP).find(inp => !inp.value);
      if (proximoVazio) {
        proximoVazio.focus();
      } else if (inputsOTP.length > 0) {
        inputsOTP[inputsOTP.length - 1].focus();
      }
    }
  });
});

// === CONTROLE DO MODAL ===
if (btnRegister && modal) {
  btnRegister.addEventListener('click', () => modal.classList.remove('hidden'));
}

if (btnFechar && modal) {
  btnFechar.addEventListener('click', () => modal.classList.add('hidden'));
}

// === MOSTRAR / OCULTAR SENHA ===
if (btnToggleSenha && inputSenha) {
  btnToggleSenha.addEventListener('click', () => {
    const tipoAtual = inputSenha.getAttribute('type');
    if (tipoAtual === 'password') {
      inputSenha.setAttribute('type', 'text');
      btnToggleSenha.textContent = '🙈';
    } else {
      inputSenha.setAttribute('type', 'password');
      btnToggleSenha.textContent = '👁️';
    }
  });
}

// === LISTA DE REQUISITOS EM TEMPO REAL ===
function atualizarRegra(elemento, estaValido, texto) {
  if (!elemento) return;
  if (estaValido) {
    elemento.classList.add('valido');
    elemento.textContent = `✔ ${texto}`;
  } else {
    elemento.classList.remove('valido');
    elemento.textContent = `❌ ${texto}`;
  }
}

if (inputSenha) {
  inputSenha.addEventListener('input', () => {
    const valor = inputSenha.value || '';
    atualizarRegra(regraTam, valor.length >= 8, 'Mínimo de 8 caracteres');
    atualizarRegra(regraMai, /[A-Z]/.test(valor), 'Ao menos 1 letra maiúscula');
    atualizarRegra(regraMin, /[a-z]/.test(valor), 'Ao menos 1 letra minúscula');
    atualizarRegra(regraNum, /[0-9]/.test(valor), 'Ao menos 1 número');
    atualizarRegra(regraEsp, /[@()!%*?&#]/.test(valor), 'Ao menos 1 caractere especial (@$!%*?&#)');
  });
}

// === SUBMIT DO REGISTRO ===
if (formRegistro) {
  formRegistro.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (btnSubmitRegistro && btnSubmitRegistro.disabled) return;

    const campoEmail = formRegistro.querySelector('input[type="email"]');
    const campoSenha = document.getElementById('input-senha');

    const email = campoEmail ? campoEmail.value.trim() : '';
    const password = campoSenha ? campoSenha.value.trim() : '';

    if (!regexEmail.test(email)) {
      alert('Insira um formato de e-mail válido (exemplo: usuario@email.com).');
      return;
    }

    if (!regexSenha.test(password)) {
      alert('A senha precisa ter no mínimo 8 caracteres, com pelo menos uma letra maiúscula, uma minúscula, um número e um símbolo especial (@$!%*?&#).');
      return;
    }

    if (btnSubmitRegistro) {
      btnSubmitRegistro.disabled = true;
      btnSubmitRegistro.textContent = 'Enviando...';
    }

    try {
      const resposta = await fetch('http://localhost:3000/api/registro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        emailUsuarioAtual = email;
        idVerificacaoAtual = dados.idVerificacao;

        if (spanEmailMascarado) spanEmailMascarado.textContent = mascararEmail(email);
        if (etapaRegistro) etapaRegistro.classList.add('hidden');
        if (etapa2fa) etapa2fa.classList.remove('hidden');

        inputsOTP.forEach(inp => inp.value = '');
        setTimeout(() => inputsOTP[0]?.focus(), 100);

        iniciarTimer2FA();
      } else {
        // Redireciona pro login quando o e-mail já existe, em vez de só
        // mostrar o erro e deixar o usuário preso no formulário de cadastro.
        if (dados.codigo === 'EMAIL_JA_CADASTRADO') {
          alert(dados.mensagem);
          if (modal) modal.classList.add('hidden');
          if (modalLogin) {
            modalLogin.classList.remove('hidden');
            const campoLoginEmail = document.getElementById('login-email');
            if (campoLoginEmail) campoLoginEmail.value = email;
          }
        } else {
          alert(dados.mensagem || 'Erro ao processar o registro.');
        }
      }

    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
    } finally {
      if (btnSubmitRegistro) {
        btnSubmitRegistro.disabled = false;
        btnSubmitRegistro.textContent = 'Enviar';
      }
    }
  });
}

// === VALIDAÇÃO DO 2FA ===
if (btnConfirmar2FA) {
  btnConfirmar2FA.addEventListener('click', async () => {
    // Concatena os valores de cada uma das caixas OTP
    let codigoDigitado = '';
    inputsOTP.forEach(inp => codigoDigitado += inp.value.trim());

    if (codigoDigitado.length < 6) {
      alert('Por favor, digite os 6 dígitos do código.');
      return;
    }

    try {
      const resposta = await fetch('http://localhost:3000/api/validar-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo: codigoDigitado,
          idVerificacao: idVerificacaoAtual
        })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        alert('Conta validada com sucesso!');
        if (modal) modal.classList.add('hidden');
        if (formRegistro) formRegistro.reset();

        inputsOTP.forEach(inp => inp.value = '');

        if (etapa2fa) etapa2fa.classList.add('hidden');
        if (etapaRegistro) etapaRegistro.classList.remove('hidden');
        if (intervaloTimer) clearInterval(intervaloTimer);
      } else {
        alert(dados.mensagem || 'Código incorreto ou expirado.');
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Não foi possível conectar ao servidor.');
    }
  });
}

// === TIMER E REENVIO DO 2FA ===
function iniciarTimer2FA() {
  tempoRestante = 60;
  if (btnReenviar2FA) btnReenviar2FA.disabled = true;
  if (mensagemTimer) mensagemTimer.textContent = `Aguarde ${tempoRestante}s para solicitar um novo código.`;

  if (intervaloTimer) clearInterval(intervaloTimer);

  intervaloTimer = setInterval(() => {
    tempoRestante--;

    if (tempoRestante <= 0) {
      clearInterval(intervaloTimer);
      if (btnReenviar2FA) btnReenviar2FA.disabled = false;
      if (mensagemTimer) mensagemTimer.textContent = '';
    } else {
      if (mensagemTimer) mensagemTimer.textContent = `Aguarde ${tempoRestante}s para solicitar um novo código.`;
    }
  }, 1000);
}

if (btnReenviar2FA) {
  btnReenviar2FA.addEventListener('click', async () => {
    if (tempoRestante > 0) return;

    btnReenviar2FA.disabled = true;
    if (mensagemTimer) mensagemTimer.textContent = 'Enviando novo código...';

    try {
      const resposta = await fetch('http://localhost:3000/api/reenviar-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idVerificacao: idVerificacaoAtual })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        inputsOTP.forEach(inp => inp.value = '');
        setTimeout(() => inputsOTP[0]?.focus(), 100);

        iniciarTimer2FA();
      } else {
        btnReenviar2FA.disabled = false;
        if (mensagemTimer) mensagemTimer.textContent = dados.mensagem;
      }
    } catch (erro) {
      btnReenviar2FA.disabled = false;
      if (mensagemTimer) mensagemTimer.textContent = 'Erro ao conectar ao servidor.';
    }
  });
}

// ============================================================
// LOGIN / SESSÃO
// ============================================================

// CHAVE_SESSAO: nome usado no localStorage para guardar o tokenSessao
// devolvido por POST /api/login.
const CHAVE_SESSAO = 'tokenSessao';

function obterTokenSessao() {
  return localStorage.getItem(CHAVE_SESSAO);
}

function estaLogado() {
  return !!obterTokenSessao();
}

// Atualiza a navbar: some Entrar/Registre-se e mostra Sair quando logado,
// e vice-versa quando deslogado. Chame sempre que o estado de login mudar.
function atualizarUIAutenticacao() {
  const logado = estaLogado();

  if (btnEntrar) btnEntrar.classList.toggle('hidden', logado);
  if (btnRegister) btnRegister.classList.toggle('hidden', logado);
  if (btnSair) btnSair.classList.toggle('hidden', !logado);
}

// Helper para requisições futuras que exigem login (ex: tocar música,
// upload). Injeta o header Authorization automaticamente e trata o 401
// (sessão expirada/inválida) de forma centralizada.
async function fetchComAutenticacao(url, opcoes = {}) {
  const token = obterTokenSessao();
  const headers = { ...(opcoes.headers || {}), Authorization: `Bearer ${token}` };

  const resposta = await fetch(url, { ...opcoes, headers });

  if (resposta.status === 401) {
    // Token inválido/expirado: desloga localmente e avisa o usuário.
    localStorage.removeItem(CHAVE_SESSAO);
    atualizarUIAutenticacao();
    alert('Sua sessão expirou. Faça login novamente.');
  }

  return resposta;
}

// Abre o modal de login ao clicar em "Entrar"
if (btnEntrar && modalLogin) {
  btnEntrar.addEventListener('click', () => modalLogin.classList.remove('hidden'));
}

if (btnFecharLogin && modalLogin) {
  btnFecharLogin.addEventListener('click', () => modalLogin.classList.add('hidden'));
}

// Submit do formulário de login
if (formLogin) {
  formLogin.addEventListener('submit', async (event) => {
    event.preventDefault();

    const campoEmail = document.getElementById('login-email');
    const campoSenha = document.getElementById('login-senha');
    const campoLembrar = document.getElementById('login-lembrar');

    const email = campoEmail ? campoEmail.value.trim() : '';
    const password = campoSenha ? campoSenha.value.trim() : '';
    const lembrarDeMim = campoLembrar ? campoLembrar.checked : false;

    const btnSubmitLogin = formLogin.querySelector('button[type="submit"]');
    if (btnSubmitLogin) {
      btnSubmitLogin.disabled = true;
      btnSubmitLogin.textContent = 'Entrando...';
    }

    try {
      const resposta = await fetch('http://localhost:3000/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, lembrarDeMim })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        localStorage.setItem(CHAVE_SESSAO, dados.tokenSessao);
        atualizarUIAutenticacao();

        if (modalLogin) modalLogin.classList.add('hidden');
        formLogin.reset();
      } else {
        // Redireciona pro cadastro quando o e-mail não existe, em vez de só
        // mostrar o erro e deixar o usuário preso no formulário de login.
        if (dados.codigo === 'EMAIL_NAO_CADASTRADO') {
          alert(dados.mensagem);
          if (modalLogin) modalLogin.classList.add('hidden');
          if (modal) {
            modal.classList.remove('hidden');
            if (etapaRegistro) etapaRegistro.classList.remove('hidden');
            if (etapa2fa) etapa2fa.classList.add('hidden');
            const campoRegistroEmail = formRegistro ? formRegistro.querySelector('input[type="email"]') : null;
            if (campoRegistroEmail) campoRegistroEmail.value = email;
          }
        } else {
          alert(dados.mensagem || 'Não foi possível fazer login.');
        }
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
    } finally {
      if (btnSubmitLogin) {
        btnSubmitLogin.disabled = false;
        btnSubmitLogin.textContent = 'Entrar';
      }
    }
  });
}

// Logout: só precisa apagar o token local — não existe nada pra invalidar
// no servidor porque o token é stateless (JWT).
if (btnSair) {
  btnSair.addEventListener('click', () => {
    const confirmou = confirm('Você realmente deseja deslogar da sua conta?');
    if (!confirmou) return;

    localStorage.removeItem(CHAVE_SESSAO);
    atualizarUIAutenticacao();
    alert('Você foi deslogado.');
  });
}

// Estado inicial da navbar ao carregar a página
atualizarUIAutenticacao();

// ============================================================
// CONTAINER UNIVERSAL DE MÚSICAS (carregar + renderizar cards)
// ============================================================

// Elementos da barra de player fixa (parte inferior da página)
const playerBarra = document.getElementById('player-barra');
const playerCapa = document.getElementById('player-capa');
const playerTitulo = document.getElementById('player-titulo');
const playerArtista = document.getElementById('player-artista');
const playerPlayPause = document.getElementById('player-play-pause');
const playerTempoAtual = document.getElementById('player-tempo-atual');
const playerTempoTotal = document.getElementById('player-tempo-total');
const playerSeek = document.getElementById('player-seek');

// UM ÚNICO elemento de áudio compartilhado por toda a página — em vez de
// criar um "new Audio()" a cada clique (jeito antigo), reutilizamos sempre
// o mesmo. Isso é o que permite ter uma barra fixa embaixo controlando
// "a música que está tocando agora", em vez de cada card ser independente.
const elementoAudio = new Audio();
let botaoAudioAtual = null; // botão do card da música tocando agora
let arrastandoSeek = false; // true enquanto o usuário está arrastando a barrinha de progresso

function formatarTempo(segundosTotais) {
  if (!isFinite(segundosTotais) || segundosTotais < 0) return '0:00';
  const minutos = Math.floor(segundosTotais / 60);
  const segundos = Math.floor(segundosTotais % 60).toString().padStart(2, '0');
  return `${minutos}:${segundos}`;
}

// Troca a música atual e começa a tocar (ou pausa/retoma, se for a mesma).
function tocarMusica(musica, botaoClicado) {
  const clicouNaMesmaMusica = botaoAudioAtual === botaoClicado && elementoAudio.src;

  if (clicouNaMesmaMusica) {
    if (elementoAudio.paused) {
      elementoAudio.play();
    } else {
      elementoAudio.pause();
    }
    return;
  }

  // Trocou de música: reseta o texto do botão do card anterior.
  if (botaoAudioAtual) botaoAudioAtual.textContent = '▶ Tocar';
  botaoAudioAtual = botaoClicado;

  elementoAudio.src = musica.url_audio;
  elementoAudio.play().catch((erro) => {
    console.error('Erro ao tocar áudio:', erro);
    alert('Não foi possível tocar esta música.');
  });

  if (playerCapa) playerCapa.src = musica.url_capa || '';
  if (playerTitulo) playerTitulo.textContent = musica.titulo;
  if (playerArtista) playerArtista.textContent = musica.artista;
  if (playerBarra) playerBarra.classList.remove('hidden');
}

// Eventos do elemento de áudio compartilhado — mantêm o card e a barra
// inferior sincronizados, não importa qual dos dois iniciou a ação.
elementoAudio.addEventListener('play', () => {
  if (botaoAudioAtual) botaoAudioAtual.textContent = '⏸ Pausar';
  if (playerPlayPause) playerPlayPause.textContent = '⏸';
});

elementoAudio.addEventListener('pause', () => {
  if (botaoAudioAtual) botaoAudioAtual.textContent = '▶ Tocar';
  if (playerPlayPause) playerPlayPause.textContent = '▶';
});

elementoAudio.addEventListener('ended', () => {
  if (botaoAudioAtual) botaoAudioAtual.textContent = '▶ Tocar';
  botaoAudioAtual = null;
});

// Assim que os metadados carregam, já sabemos a duração total —
// usada pra configurar o máximo da barrinha de progresso.
elementoAudio.addEventListener('loadedmetadata', () => {
  if (playerSeek) playerSeek.max = elementoAudio.duration;
  if (playerTempoTotal) playerTempoTotal.textContent = formatarTempo(elementoAudio.duration);
});

// A cada avanço da música, atualiza a posição da barrinha e o tempo atual
// — a menos que o usuário esteja arrastando ela manualmente agora.
elementoAudio.addEventListener('timeupdate', () => {
  if (!arrastandoSeek) {
    if (playerSeek) playerSeek.value = elementoAudio.currentTime;
    if (playerTempoAtual) playerTempoAtual.textContent = formatarTempo(elementoAudio.currentTime);
  }
});

if (playerSeek) {
  // Enquanto arrasta, só atualiza o texto do tempo (não pula a música ainda).
  playerSeek.addEventListener('input', () => {
    arrastandoSeek = true;
    if (playerTempoAtual) playerTempoAtual.textContent = formatarTempo(playerSeek.value);
  });

  // Ao soltar, aí sim pula pra posição escolhida — isso é o "ajustar em que
  // parte da música quero escutar" que você pediu.
  playerSeek.addEventListener('change', () => {
    elementoAudio.currentTime = playerSeek.value;
    arrastandoSeek = false;
  });
}

if (playerPlayPause) {
  playerPlayPause.addEventListener('click', () => {
    if (!elementoAudio.src) return;
    if (elementoAudio.paused) {
      elementoAudio.play();
    } else {
      elementoAudio.pause();
    }
  });
}

// Template do card — recebe um objeto de música (linha vinda de
// GET /api/musicas) e devolve o elemento DOM pronto. Usa textContent (não
// innerHTML) para título/artista porque esses valores vêm do que outros
// usuários digitaram no upload — textContent evita que algo digitado ali
// seja interpretado como HTML/script.
function criarCardMusica(musica) {
  const card = document.createElement('div');
  card.className = 'card-musica';

  const capa = document.createElement('img');
  capa.className = 'capa-musica';
  capa.src = musica.url_capa || '';
  capa.alt = `Capa de ${musica.titulo}`;

  const info = document.createElement('div');
  info.className = 'info-musica';

  const titulo = document.createElement('p');
  titulo.className = 'titulo-musica';
  titulo.textContent = musica.titulo;

  const artista = document.createElement('p');
  artista.className = 'artista-musica';
  artista.textContent = musica.artista;

  info.appendChild(titulo);
  info.appendChild(artista);

  const btnPlay = document.createElement('button');
  btnPlay.className = 'btn-play';
  btnPlay.textContent = '▶ Tocar';

  btnPlay.addEventListener('click', () => {
    // Gate: tocar exige login, mesmo que o card já esteja visível pra todo
    // mundo (navegar/ver o catálogo é livre — a ação de tocar não é).
    if (!estaLogado()) {
      alert('Faça login para tocar as músicas.');
      if (modalLogin) modalLogin.classList.remove('hidden');
      return;
    }

    tocarMusica(musica, btnPlay);
  });

  card.appendChild(capa);
  card.appendChild(info);
  card.appendChild(btnPlay);

  return card;
}

// Busca as músicas no backend e preenche o container universal.
// GET /api/musicas é pública — não precisa de token pra listar/ver o catálogo.
async function carregarMusicas() {
  if (!listaMusicas) return;

  try {
    const resposta = await fetch('http://localhost:3000/api/musicas');
    const dados = await resposta.json();

    if (!resposta.ok) {
      listaMusicas.innerHTML = '';
      const mensagem = document.createElement('p');
      mensagem.className = 'mensagem-lista';
      mensagem.textContent = dados.mensagem || 'Não foi possível carregar as músicas.';
      listaMusicas.appendChild(mensagem);
      return;
    }

    listaMusicas.innerHTML = '';

    if (!dados.musicas || dados.musicas.length === 0) {
      const mensagem = document.createElement('p');
      mensagem.className = 'mensagem-lista';
      mensagem.textContent = 'Nenhuma música enviada ainda. Seja o primeiro a fazer upload!';
      listaMusicas.appendChild(mensagem);
      return;
    }

    dados.musicas.forEach((musica) => {
      listaMusicas.appendChild(criarCardMusica(musica));
    });

  } catch (erro) {
    console.error('Erro ao carregar músicas:', erro);
    listaMusicas.innerHTML = '';
    const mensagem = document.createElement('p');
    mensagem.className = 'mensagem-lista';
    mensagem.textContent = 'Erro de conexão ao carregar as músicas.';
    listaMusicas.appendChild(mensagem);
  }
}

carregarMusicas();

// ============================================================
// UPLOAD DE MÚSICA
// ============================================================

// Clique em "Upload": exige login. Se não estiver logado, abre o modal de
// login em vez do de upload (mesmo padrão de gate usado no botão de play).
if (btnUpload) {
  btnUpload.addEventListener('click', () => {
    if (!estaLogado()) {
      alert('Faça login para enviar músicas.');
      if (modalLogin) modalLogin.classList.remove('hidden');
      return;
    }
    if (modalUpload) modalUpload.classList.remove('hidden');
  });
}

if (btnFecharUpload && modalUpload) {
  btnFecharUpload.addEventListener('click', () => {
    modalUpload.classList.add('hidden');
    if (formUpload) formUpload.reset();
    resetarPreviewUpload();
  });
}

// Elementos do formulário e da preview ao vivo
const campoTitulo = document.getElementById('upload-titulo');
const campoArtista = document.getElementById('upload-artista');
const campoAudio = document.getElementById('upload-audio');
const campoCapa = document.getElementById('upload-capa');

const previewCapa = document.getElementById('preview-upload-capa');
const previewCapaVazio = document.getElementById('preview-upload-capa-vazio');
const previewTitulo = document.getElementById('preview-upload-titulo');
const previewArtista = document.getElementById('preview-upload-artista');
const previewAudio = document.getElementById('preview-upload-audio');

let urlObjetoCapaAtual = null; // pra liberar da memória a preview anterior antes de criar outra

function resetarPreviewUpload() {
  if (urlObjetoCapaAtual) {
    URL.revokeObjectURL(urlObjetoCapaAtual);
    urlObjetoCapaAtual = null;
  }
  if (previewCapa) {
    previewCapa.src = '';
    previewCapa.classList.add('hidden');
  }
  if (previewCapaVazio) previewCapaVazio.classList.remove('hidden');
  if (previewTitulo) previewTitulo.textContent = 'Título da música';
  if (previewArtista) previewArtista.textContent = 'Nome do artista';
  if (previewAudio) previewAudio.textContent = 'Nenhum áudio selecionado';
}

// Título e artista: atualiza a cada tecla digitada — mostrando o texto
// INTEIRO (sem cortar), pra o usuário conferir antes de enviar.
if (campoTitulo && previewTitulo) {
  campoTitulo.addEventListener('input', () => {
    previewTitulo.textContent = campoTitulo.value.trim() || 'Título da música';
  });
}

if (campoArtista && previewArtista) {
  campoArtista.addEventListener('input', () => {
    previewArtista.textContent = campoArtista.value.trim() || 'Nome do artista';
  });
}

// Áudio: só mostra o nome do arquivo escolhido (não dá pra tocar/pré-ouvir
// sem subir pro storage primeiro, mas já confirma visualmente qual arquivo foi selecionado).
if (campoAudio && previewAudio) {
  campoAudio.addEventListener('change', () => {
    const arquivo = campoAudio.files[0];
    previewAudio.textContent = arquivo ? `🎵 ${arquivo.name}` : 'Nenhum áudio selecionado';
  });
}

// Capa: gera uma URL local temporária (createObjectURL) pra mostrar a
// imagem antes mesmo do upload acontecer — é só isso, nunca sai do navegador.
if (campoCapa && previewCapa && previewCapaVazio) {
  campoCapa.addEventListener('change', () => {
    const arquivo = campoCapa.files[0];

    if (urlObjetoCapaAtual) {
      URL.revokeObjectURL(urlObjetoCapaAtual);
      urlObjetoCapaAtual = null;
    }

    if (arquivo) {
      urlObjetoCapaAtual = URL.createObjectURL(arquivo);
      previewCapa.src = urlObjetoCapaAtual;
      previewCapa.classList.remove('hidden');
      previewCapaVazio.classList.add('hidden');
    } else {
      previewCapa.src = '';
      previewCapa.classList.add('hidden');
      previewCapaVazio.classList.remove('hidden');
    }
  });
}

if (formUpload) {
  formUpload.addEventListener('submit', async (event) => {
    event.preventDefault();

    const titulo = campoTitulo ? campoTitulo.value.trim() : '';
    const artista = campoArtista ? campoArtista.value.trim() : '';
    const arquivoAudio = campoAudio && campoAudio.files[0] ? campoAudio.files[0] : null;
    const arquivoCapa = campoCapa && campoCapa.files[0] ? campoCapa.files[0] : null;

    if (!titulo || !artista || !arquivoAudio) {
      alert('Preencha título, artista e selecione o arquivo de áudio.');
      return;
    }

    const dadosFormulario = new FormData();
    dadosFormulario.append('titulo', titulo);
    dadosFormulario.append('artista', artista);
    dadosFormulario.append('audio', arquivoAudio);
    if (arquivoCapa) dadosFormulario.append('capa', arquivoCapa);

    const btnSubmitUpload = formUpload.querySelector('button[type="submit"]');
    if (btnSubmitUpload) {
      btnSubmitUpload.disabled = true;
      btnSubmitUpload.textContent = 'Enviando...';
    }

    try {
      // Não define Content-Type manualmente aqui: o navegador precisa
      // gerar o boundary do multipart/form-data sozinho. fetchComAutenticacao
      // só injeta o header Authorization, sem mexer nos demais.
      const resposta = await fetchComAutenticacao('http://localhost:3000/api/musicas', {
        method: 'POST',
        body: dadosFormulario
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        alert('Música enviada com sucesso!');
        if (modalUpload) modalUpload.classList.add('hidden');
        formUpload.reset();
        resetarPreviewUpload();
        carregarMusicas(); // atualiza o container universal com o item novo
      } else {
        alert(dados.mensagem || 'Não foi possível enviar a música.');
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
    } finally {
      if (btnSubmitUpload) {
        btnSubmitUpload.disabled = false;
        btnSubmitUpload.textContent = 'Enviar';
      }
    }
  });
}