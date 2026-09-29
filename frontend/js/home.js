// ============================================================
// TEMA CLARO / ESCURO (salvo no localStorage e sincronizado com backend)
// ============================================================
const btnTema = document.getElementById('btn-tema');
const CHAVE_TEMA = 'opensound_tema';
const API_BASE = 'http://localhost:3000';
const CHAVE_SESSAO = 'tokenSessao';

function obterTokenSessao() {
  return localStorage.getItem(CHAVE_SESSAO);
}

function estaLogado() {
  return !!obterTokenSessao();
}

async function fetchComAutenticacao(url, opcoes = {}) {
  const token = obterTokenSessao();
  const headers = { ...(opcoes.headers || {}), Authorization: `Bearer ${token}` };

  const resposta = await fetch(url, { ...opcoes, headers });

  if (resposta.status === 401) {
    localStorage.removeItem(CHAVE_SESSAO);
    atualizarUIAutenticacao();
    alert('Sua sessão expirou. Faça login novamente.');
  }

  return resposta;
}

function aplicarTema(tema) {
  if (tema === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  if (btnTema) btnTema.textContent = tema === 'light' ? '🌙' : '☀️';
}

// Aplica tema do localStorage imediatamente (evita flash)
aplicarTema(localStorage.getItem(CHAVE_TEMA) || 'dark');

async function carregarTemaDoBackend() {
  if (!estaLogado()) return;
  try {
    const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil`);
    if (resposta.ok) {
      const { perfil } = await resposta.json();
      if (perfil?.usuario?.tema) {
        const tema = perfil.usuario.tema;
        localStorage.setItem(CHAVE_TEMA, tema);
        aplicarTema(tema);
      }
    }
  } catch (erro) {
    console.error('Erro ao carregar tema do backend:', erro);
  }
}

async function salvarTemaNoBackend(tema) {
  if (!estaLogado()) return;
  try {
    await fetchComAutenticacao(`${API_BASE}/api/perfil/tema`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tema })
    });
  } catch (erro) {
    console.error('Erro ao salvar tema no backend:', erro);
  }
}

if (btnTema) {
  btnTema.addEventListener('click', async () => {
    const temaAtual = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const novoTema = temaAtual === 'light' ? 'dark' : 'light';
    localStorage.setItem(CHAVE_TEMA, novoTema);
    aplicarTema(novoTema);
    await salvarTemaNoBackend(novoTema);
  });
}

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

// === CONTADOR DO NOME DE USUÁRIO ===

const campoNomeUsuarioCadastro = document.getElementById('registro-nome-usuario');
const contadorUsuario = document.querySelector('.contador-usuario');

if (campoNomeUsuarioCadastro && contadorUsuario) {
  const atualizarContadorUsuario = () => {
    contadorUsuario.textContent =
      `${campoNomeUsuarioCadastro.value.length} / 28`;
  };

  campoNomeUsuarioCadastro.addEventListener(
    'input',
    atualizarContadorUsuario
  );

  atualizarContadorUsuario();
}

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
const btnPerfilAvatar = document.getElementById('btn-perfil-avatar');
const perfilAvatarImg = document.getElementById('perfil-avatar-navbar');
const linkSairDropdown = document.getElementById('link-sair-dropdown');

// Elementos do Modal de Upload e do Container Universal de Músicas
const modalUpload = document.getElementById('modal-upload');
const btnFecharUpload = document.getElementById('btn-fechar-upload');
const formUpload = document.getElementById('form-upload');
const btnUpload = document.getElementById('btn-upload');
const listaMusicas = document.getElementById('lista-musicas');
const listaArtistas = document.getElementById('lista-artistas');

// Elementos do Modal de Cadastro de Artista
const modalArtista = document.getElementById('modal-artista');
const btnFecharArtista = document.getElementById('btn-fechar-artista');
const formArtista = document.getElementById('form-artista');

// Regex de Validação
const regexEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const regexSenha = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@()!%*?&#])[A-Za-z\d@()!%*?&#]{8,}$/;

let emailUsuarioAtual = '';
let tempoRestante = 60;
let intervaloTimer = null;
let idVerificacaoAtual = '';

// === FUNÇÃO PARA MASCARAR E-MAIL ===
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
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '');
    if (input.value && index < inputsOTP.length - 1) {
      inputsOTP[index + 1].focus();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && index > 0) {
      inputsOTP[index - 1].focus();
    }
  });

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

// === MENU HAMBURGUER ===
const btnHamburguer = document.getElementById('btn-hamburguer');
const dropdownHamburguer = document.getElementById('dropdown-hamburguer');

if (btnHamburguer && dropdownHamburguer) {
  btnHamburguer.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownHamburguer.classList.toggle('hidden');
  });

  // Fecha o dropdown se o usuário clicar em qualquer outro lugar da página.
  document.addEventListener('click', (e) => {
    if (!dropdownHamburguer.classList.contains('hidden') && !dropdownHamburguer.contains(e.target)) {
      dropdownHamburguer.classList.add('hidden');
    }
  });
}

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
      btnToggleSenha.textContent = '👁️';
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

      const aceiteTermos = formRegistro.querySelector(
      '.aceite-termos input[type="checkbox"]'
      );

    if (!aceiteTermos || !aceiteTermos.checked) {
      aceiteTermos?.focus();
      alert('Você precisa aceitar os Termos de Uso para criar sua conta.');
      return;
    }

    if (btnSubmitRegistro && btnSubmitRegistro.disabled) return;

    const campoNomeUsuario = document.getElementById('registro-nome-usuario');
    const campoEmail = formRegistro.querySelector('input[type="email"]');
    const campoSenha = document.getElementById('input-senha');

    const nomeUsuario = campoNomeUsuario ? campoNomeUsuario.value.trim() : '';
    const email = campoEmail ? campoEmail.value.trim() : '';
    const password = campoSenha ? campoSenha.value.trim() : '';

    if (!nomeUsuario) {
      alert('Digite um nome de usuário.');
      return;
    }

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
        body: JSON.stringify({ email, password, nomeUsuario })
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

function atualizarUIAutenticacao() {
  const logado = estaLogado();

  if (btnEntrar) btnEntrar.classList.toggle('hidden', logado);
  if (btnRegister) btnRegister.classList.toggle('hidden', logado);
  if (btnPerfilAvatar) btnPerfilAvatar.classList.toggle('hidden', !logado);
  if (linkSairDropdown) linkSairDropdown.classList.toggle('hidden', !logado);
  
  if (logado) {
    carregarAvatarPerfil();
  }
}

if (btnEntrar && modalLogin) {
  btnEntrar.addEventListener('click', () => modalLogin.classList.remove('hidden'));
}

if (btnFecharLogin && modalLogin) {
  btnFecharLogin.addEventListener('click', () => modalLogin.classList.add('hidden'));
}

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

        carregarFavoritos();
        carregarTemaDoBackend();  // Carrega tema salvo no perfil

        if (modalLogin) modalLogin.classList.add('hidden');
        formLogin.reset();
      } else {
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

if (btnSair) {
  btnSair.addEventListener('click', () => {
    const confirmou = confirm('Você realmente deseja deslogar da sua conta?');
    if (!confirmou) return;

    localStorage.removeItem(CHAVE_SESSAO);
    atualizarUIAutenticacao();
    idsFavoritos.clear();        // <- ADICIONAR
    atualizarTodosCoracoes();    // <- ADICIONAR
    alert('Você foi deslogado.');
  });
}

if (linkSairDropdown) {
  linkSairDropdown.addEventListener('click', (e) => {
    e.preventDefault();
    const confirmou = confirm('Você realmente deseja deslogar da sua conta?');
    if (!confirmou) return;

    localStorage.removeItem(CHAVE_SESSAO);
    atualizarUIAutenticacao();
    idsFavoritos.clear();
    atualizarTodosCoracoes();
    alert('Você foi deslogado.');
  });
}

if (btnPerfilAvatar) {
  btnPerfilAvatar.addEventListener('click', () => {
    window.location.href = 'perfil.html';
  });
}

// Estado inicial da navbar ao carregar a página
atualizarUIAutenticacao();
if (estaLogado()) carregarTemaDoBackend();

// ============================================================
// CARREGAR AVATAR DO PERFIL NA NAVBAR
// ============================================================
async function carregarAvatarPerfil() {
  if (!estaLogado() || !perfilAvatarImg) return;
  
  try {
    const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil`);
    if (resposta.ok) {
      const { perfil } = await resposta.json();
      const urlAvatar = perfil.usuario?.avatar_url || '../assets/avatar-padrao.png';
      perfilAvatarImg.src = urlAvatar;
    }
  } catch (erro) {
    console.error('Erro ao carregar avatar do perfil:', erro);
    perfilAvatarImg.src = '../assets/avatar-padrao.png';
  }
}

// ============================================================
// MODAL DE LOGIN — MELHORIAS (olho, links, toggle modais)
// ============================================================

// Elementos do modal de login
const btnToggleLoginSenha = document.getElementById('btn-toggle-login-senha');
const inputLoginSenha = document.getElementById('login-senha');
const linkEsqueciSenha = document.getElementById('link-esqueci-senha');
const linkIrRegistro = document.getElementById('link-ir-registro');

// Elementos do modal "esqueci minha senha"
const modalEsqueciSenha = document.getElementById('modal-esqueci-senha');
const btnFecharEsqueci = document.getElementById('btn-fechar-esqueci');
const formEsqueciSenha = document.getElementById('form-esqueci-senha');
const etapaEsqueci = document.getElementById('etapa-esqueci');
const etapaEsqueci2fa = document.getElementById('etapa-esqueci-2fa');
const etapaEsqueciNovaSenha = document.getElementById('etapa-esqueci-nova-senha');
const esqueciEmailMascarado = document.getElementById('esqueci-email-mascarado');
const inputsOTPEsqueci = document.querySelectorAll('#modal-esqueci-senha .input-otp');
const btnConfirmarEsqueci = document.getElementById('btn-confirmar-esqueci');
const btnReenviarEsqueci = document.getElementById('btn-reenviar-esqueci');
const esqueciMensagemTimer = document.getElementById('esqueci-mensagem-timer');
const formEsqueciNovaSenha = document.getElementById('form-esqueci-nova-senha');
const esqueciNovaSenha = document.getElementById('esqueci-nova-senha');
const esqueciConfirmaSenha = document.getElementById('esqueci-confirma-senha');
const btnToggleEsqueciSenha = document.getElementById('btn-toggle-esqueci-senha');
const btnToggleEsqueciConfirma = document.getElementById('btn-toggle-esqueci-confirma');

// Regras de senha — etapa nova senha
const esqueciRegraTam = document.getElementById('esqueci-regra-tam');
const esqueciRegraMai = document.getElementById('esqueci-regra-mai');
const esqueciRegraMin = document.getElementById('esqueci-regra-min');
const esqueciRegraNum = document.getElementById('esqueci-regra-num');
const esqueciRegraEsp = document.getElementById('esqueci-regra-esp');

// Links de voltar
const linkVoltarLogin = document.getElementById('link-voltar-login');
const linkVoltarLogin2 = document.getElementById('link-voltar-login-2');
const linkVoltarLogin3 = document.getElementById('link-voltar-login-3');

// Estado do fluxo esqueci senha
let esqueciEmailAtual = '';
let esqueciTempoRestante = 60;
let esqueciIntervaloTimer = null;
let esqueciIdVerificacao = '';

// === OLHO NA SENHA — LOGIN ===
if (btnToggleLoginSenha && inputLoginSenha) {
  btnToggleLoginSenha.addEventListener('click', () => {
    const tipoAtual = inputLoginSenha.getAttribute('type');
    if (tipoAtual === 'password') {
      inputLoginSenha.setAttribute('type', 'text');
    } else {
      inputLoginSenha.setAttribute('type', 'password');
    }
  });
}

// === LINK "ESQUECI MINHA SENHA" — ABRE MODAL ESQUECI, FECHA LOGIN ===
if (linkEsqueciSenha) {
  linkEsqueciSenha.addEventListener('click', (e) => {
    e.preventDefault();
    if (modalLogin) modalLogin.classList.add('hidden');
    if (modalEsqueciSenha) {
      modalEsqueciSenha.classList.remove('hidden');
      resetarFluxoEsqueci();
    }
  });
}

// === LINK "CADASTRE-SE" — ABRE MODAL REGISTRO, FECHA LOGIN ===
if (linkIrRegistro) {
  linkIrRegistro.addEventListener('click', (e) => {
    e.preventDefault();
    if (modalLogin) modalLogin.classList.add('hidden');
    if (modal) modal.classList.remove('hidden');
    if (etapaRegistro) etapaRegistro.classList.remove('hidden');
    if (etapa2fa) etapa2fa.classList.add('hidden');
  });
}

// === LINKS VOLTAR PARA LOGIN ===
function voltarParaLogin() {
  if (modalEsqueciSenha) modalEsqueciSenha.classList.add('hidden');
  if (modalLogin) modalLogin.classList.remove('hidden');
  resetarFluxoEsqueci();
}

if (linkVoltarLogin) linkVoltarLogin.addEventListener('click', (e) => { e.preventDefault(); voltarParaLogin(); });
if (linkVoltarLogin2) linkVoltarLogin2.addEventListener('click', (e) => { e.preventDefault(); voltarParaLogin(); });
if (linkVoltarLogin3) linkVoltarLogin3.addEventListener('click', (e) => { e.preventDefault(); voltarParaLogin(); });

// === FECHAR MODAL ESQUECI ===
if (btnFecharEsqueci && modalEsqueciSenha) {
  btnFecharEsqueci.addEventListener('click', () => {
    modalEsqueciSenha.classList.add('hidden');
    resetarFluxoEsqueci();
  });
}

// === RESETAR FLUXO ESQUECI SENHA ===
function resetarFluxoEsqueci() {
  if (etapaEsqueci) etapaEsqueci.classList.remove('hidden');
  if (etapaEsqueci2fa) etapaEsqueci2fa.classList.add('hidden');
  if (etapaEsqueciNovaSenha) etapaEsqueciNovaSenha.classList.add('hidden');
  if (formEsqueciSenha) formEsqueciSenha.reset();
  if (formEsqueciNovaSenha) formEsqueciNovaSenha.reset();
  inputsOTPEsqueci.forEach(inp => inp.value = '');
  if (esqueciMensagemTimer) esqueciMensagemTimer.textContent = '';
  if (btnReenviarEsqueci) btnReenviarEsqueci.disabled = true;
  if (esqueciIntervaloTimer) clearInterval(esqueciIntervaloTimer);
  esqueciEmailAtual = '';
  esqueciIdVerificacao = '';
}

// === NAVEGAÇÃO OTP — ESQUECI SENHA ===
inputsOTPEsqueci.forEach((input, index) => {
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '');
    if (input.value && index < inputsOTPEsqueci.length - 1) {
      inputsOTPEsqueci[index + 1].focus();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && index > 0) {
      inputsOTPEsqueci[index - 1].focus();
    }
  });

  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const dadosColados = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
    if (dadosColados) {
      dadosColados.split('').forEach((char, i) => {
        if (inputsOTPEsqueci[i]) inputsOTPEsqueci[i].value = char;
      });
      const proximoVazio = Array.from(inputsOTPEsqueci).find(inp => !inp.value);
      if (proximoVazio) proximoVazio.focus();
      else if (inputsOTPEsqueci.length > 0) inputsOTPEsqueci[inputsOTPEsqueci.length - 1].focus();
    }
  });
});

// === REGRAS DE SENHA TEMPO REAL — ETAPA NOVA SENHA ===
function atualizarRegraEsqueci(elemento, estaValido, texto) {
  if (!elemento) return;
  if (estaValido) {
    elemento.classList.add('valido');
    elemento.textContent = `✔ ${texto}`;
  } else {
    elemento.classList.remove('valido');
    elemento.textContent = `❌ ${texto}`;
  }
}

if (esqueciNovaSenha) {
  esqueciNovaSenha.addEventListener('input', () => {
    const valor = esqueciNovaSenha.value || '';
    atualizarRegraEsqueci(esqueciRegraTam, valor.length >= 8, 'Mínimo de 8 caracteres');
    atualizarRegraEsqueci(esqueciRegraMai, /[A-Z]/.test(valor), 'Ao menos 1 letra maiúscula');
    atualizarRegraEsqueci(esqueciRegraMin, /[a-z]/.test(valor), 'Ao menos 1 letra minúscula');
    atualizarRegraEsqueci(esqueciRegraNum, /[0-9]/.test(valor), 'Ao menos 1 número');
    atualizarRegraEsqueci(esqueciRegraEsp, /[@()!%*?&#]/.test(valor), 'Ao menos 1 caractere especial (@$!%*?&#)');
  });
}

// === OLHO NA SENHA — ESQUECI SENHA (nova senha e confirma) ===
function configurarOlhoSenha(btnToggle, inputSenha) {
  if (btnToggle && inputSenha) {
    btnToggle.addEventListener('click', () => {
      const tipoAtual = inputSenha.getAttribute('type');
      if (tipoAtual === 'password') {
        inputSenha.setAttribute('type', 'text');
      } else {
        inputSenha.setAttribute('type', 'password');
      }
    });
  }
}

configurarOlhoSenha(btnToggleEsqueciSenha, esqueciNovaSenha);
configurarOlhoSenha(btnToggleEsqueciConfirma, esqueciConfirmaSenha);

// === ETAPA 1: SOLICITAR CÓDIGO (EMAIL) ===
if (formEsqueciSenha) {
  formEsqueciSenha.addEventListener('submit', async (event) => {
    event.preventDefault();

    const campoEmail = document.getElementById('esqueci-email');
    const email = campoEmail ? campoEmail.value.trim() : '';

    if (!regexEmail.test(email)) {
      alert('Insira um e-mail válido.');
      return;
    }

    const btnSubmit = formEsqueciSenha.querySelector('button[type="submit"]');
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Enviando...';
    }

    try {
      // TODO: Endpoint não existe ainda no backend — implementar POST /api/auth/esqueci-senha
      const resposta = await fetch('http://localhost:3000/api/auth/esqueci-senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        esqueciEmailAtual = email;
        esqueciIdVerificacao = dados.idVerificacao;

        if (esqueciEmailMascarado) esqueciEmailMascarado.textContent = mascararEmail(email);
        if (etapaEsqueci) etapaEsqueci.classList.add('hidden');
        if (etapaEsqueci2fa) etapaEsqueci2fa.classList.remove('hidden');

        inputsOTPEsqueci.forEach(inp => inp.value = '');
        setTimeout(() => inputsOTPEsqueci[0]?.focus(), 100);

        iniciarTimerEsqueci();
      } else {
        alert(dados.mensagem || 'Não foi possível enviar o código.');
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
    } finally {
      const btnSubmit = formEsqueciSenha.querySelector('button[type="submit"]');
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Enviar código';
      }
    }
  });
}

// === TIMER REENVIO — ESQUECI SENHA ===
function iniciarTimerEsqueci() {
  esqueciTempoRestante = 60;
  if (btnReenviarEsqueci) btnReenviarEsqueci.disabled = true;
  if (esqueciMensagemTimer) esqueciMensagemTimer.textContent = `Aguarde ${esqueciTempoRestante}s para solicitar um novo código.`;

  if (esqueciIntervaloTimer) clearInterval(esqueciIntervaloTimer);

  esqueciIntervaloTimer = setInterval(() => {
    esqueciTempoRestante--;

    if (esqueciTempoRestante <= 0) {
      clearInterval(esqueciIntervaloTimer);
      if (btnReenviarEsqueci) btnReenviarEsqueci.disabled = false;
      if (esqueciMensagemTimer) esqueciMensagemTimer.textContent = '';
    } else {
      if (esqueciMensagemTimer) esqueciMensagemTimer.textContent = `Aguarde ${esqueciTempoRestante}s para solicitar um novo código.`;
    }
  }, 1000);
}

// === REENVIAR CÓDIGO — ESQUECI SENHA ===
if (btnReenviarEsqueci) {
  btnReenviarEsqueci.addEventListener('click', async () => {
    if (esqueciTempoRestante > 0) return;

    btnReenviarEsqueci.disabled = true;
    if (esqueciMensagemTimer) esqueciMensagemTimer.textContent = 'Enviando novo código...';

    try {
      // TODO: Endpoint não existe ainda — implementar POST /api/auth/reenviar-esqueci
      const resposta = await fetch('http://localhost:3000/api/auth/reenviar-esqueci', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idVerificacao: esqueciIdVerificacao })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        inputsOTPEsqueci.forEach(inp => inp.value = '');
        setTimeout(() => inputsOTPEsqueci[0]?.focus(), 100);
        iniciarTimerEsqueci();
      } else {
        btnReenviarEsqueci.disabled = false;
        if (esqueciMensagemTimer) esqueciMensagemTimer.textContent = dados.mensagem;
      }
    } catch (erro) {
      btnReenviarEsqueci.disabled = false;
      if (esqueciMensagemTimer) esqueciMensagemTimer.textContent = 'Erro ao conectar ao servidor.';
    }
  });
}

// === ETAPA 2: CONFIRMAR CÓDIGO 2FA ===
if (btnConfirmarEsqueci) {
  btnConfirmarEsqueci.addEventListener('click', async () => {
    let codigoDigitado = '';
    inputsOTPEsqueci.forEach(inp => codigoDigitado += inp.value.trim());

    if (codigoDigitado.length < 6) {
      alert('Por favor, digite os 6 dígitos do código.');
      return;
    }

    try {
      // TODO: Endpoint não existe ainda — implementar POST /api/auth/validar-esqueci
      const resposta = await fetch('http://localhost:3000/api/auth/validar-esqueci', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: codigoDigitado, idVerificacao: esqueciIdVerificacao })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        if (etapaEsqueci2fa) etapaEsqueci2fa.classList.add('hidden');
        if (etapaEsqueciNovaSenha) etapaEsqueciNovaSenha.classList.remove('hidden');
        if (esqueciIntervaloTimer) clearInterval(esqueciIntervaloTimer);
      } else {
        alert(dados.mensagem || 'Código incorreto ou expirado.');
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Não foi possível conectar ao servidor.');
    }
  });
}

// === ETAPA 3: NOVA SENHA ===
if (formEsqueciNovaSenha) {
  formEsqueciNovaSenha.addEventListener('submit', async (event) => {
    event.preventDefault();

    const novaSenha = esqueciNovaSenha ? esqueciNovaSenha.value.trim() : '';
    const confirmaSenha = esqueciConfirmaSenha ? esqueciConfirmaSenha.value.trim() : '';

    if (novaSenha !== confirmaSenha) {
      alert('As senhas não conferem.');
      return;
    }

    if (!regexSenha.test(novaSenha)) {
      alert('A senha precisa ter no mínimo 8 caracteres, com pelo menos uma letra maiúscula, uma minúscula, um número e um símbolo especial (@$!%*?&#).');
      return;
    }

    const btnSubmit = formEsqueciNovaSenha.querySelector('button[type="submit"]');
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Salvando...';
    }

    try {
      // TODO: Endpoint não existe ainda — implementar POST /api/auth/confirmar-esqueci
      const resposta = await fetch('http://localhost:3000/api/auth/confirmar-esqueci', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novaSenha, idVerificacao: esqueciIdVerificacao })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        alert('Senha alterada com sucesso! Faça login com a nova senha.');
        if (modalEsqueciSenha) modalEsqueciSenha.classList.add('hidden');
        if (modalLogin) modalLogin.classList.remove('hidden');
        resetarFluxoEsqueci();
      } else {
        alert(dados.mensagem || 'Não foi possível alterar a senha.');
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
    } finally {
      const btnSubmit = formEsqueciNovaSenha.querySelector('button[type="submit"]');
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Salvar nova senha';
      }
    }
  });
}

// ============================================================
// CONTAINER UNIVERSAL DE MÚSICAS (carregar + renderizar cards)
// ============================================================

function formatarReproducoes(quantidade) {
  const numero = Number(quantidade);
  if (!Number.isFinite(numero)) return '0 reproduções';
  return `${numero} ${numero === 1 ? 'reprodução' : 'reproduções'}`;
}

// ============================================================
// FAVORITOS + ADICIONAR À PLAYLIST
// ============================================================

const playerFavoritar = document.getElementById('player-favoritar');
const playerAddPlaylist = document.getElementById('player-add-playlist');
const modalAddPlaylist = document.getElementById('modal-add-playlist');
const btnFecharAddPlaylist = document.getElementById('btn-fechar-add-playlist');
const listaPlaylistsModal = document.getElementById('lista-playlists-modal');

// IDs (números) das músicas favoritadas pela conta logada.
let idsFavoritos = new Set();
// IDs com uma requisição em andamento — evita duplo clique no coração.
const favoritosPendentes = new Set();
// Música que o modal "Adicionar à Playlist" está tratando agora.
let musicaParaAdicionar = null;

function criarBotaoIcone(classeExtra, texto, rotulo) {
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = classeExtra ? `btn-icone ${classeExtra}` : 'btn-icone';
  botao.textContent = texto;
  botao.setAttribute('aria-label', rotulo);
  botao.title = rotulo;
  return botao;
}

function pintarCoracao(botao, favoritado) {
  if (!botao) return;
  const rotulo = favoritado ? 'Remover dos favoritos' : 'Favoritar';
  botao.classList.toggle('ativo', favoritado);
  botao.textContent = favoritado ? '♥' : '♡';
  botao.setAttribute('aria-label', rotulo);
  botao.title = rotulo;
}

// Repinta o coração do destaque atual e o da barra do player.
function atualizarTodosCoracoes() {
  document.querySelectorAll('.btn-favoritar-destaque').forEach((botao) => {
    pintarCoracao(botao, idsFavoritos.has(Number(botao.dataset.musicaId)));
  });
  pintarCoracao(playerFavoritar, !!musicaNoPlayer && idsFavoritos.has(Number(musicaNoPlayer.id)));
}

// Carga silenciosa: usa fetch puro (e não fetchComAutenticacao) pra que um
// token expirado NÃO dispare o alert de "sessão expirada" só de abrir a home.
async function carregarFavoritos() {
  idsFavoritos = new Set();

  if (estaLogado()) {
    try {
      const resposta = await fetch('http://localhost:3000/api/musicas/favoritos/ids', {
        headers: { Authorization: `Bearer ${obterTokenSessao()}` }
      });
      if (resposta.ok) {
        const dados = await resposta.json();
        (dados.ids || []).forEach((id) => idsFavoritos.add(Number(id)));
      }
    } catch (erro) {
      console.error('Erro ao carregar favoritos:', erro);
    }
  }

  atualizarTodosCoracoes();
}

// Atualização otimista: o coração muda na hora e volta atrás se o servidor falhar.
async function alternarFavorito(musica) {
  if (!musica || !musica.id) return;

  if (!estaLogado()) {
    alert('Faça login para favoritar músicas.');
    if (modalLogin) modalLogin.classList.remove('hidden');
    return;
  }

  const id = Number(musica.id);
  if (favoritosPendentes.has(id)) return;

  const eraFavorita = idsFavoritos.has(id);
  favoritosPendentes.add(id);

  if (eraFavorita) idsFavoritos.delete(id);
  else idsFavoritos.add(id);
  atualizarTodosCoracoes();

  try {
    const resposta = await fetchComAutenticacao(`http://localhost:3000/api/musicas/${id}/favoritar`, {
      method: eraFavorita ? 'DELETE' : 'POST'
    });
    if (!resposta.ok) throw new Error(String(resposta.status));
  } catch (erro) {
    if (eraFavorita) idsFavoritos.add(id);
    else idsFavoritos.delete(id);
    atualizarTodosCoracoes();
    // Em 401 o fetchComAutenticacao já avisou — não duplica o alert.
    if (erro.message !== '401') alert('Não foi possível atualizar seus favoritos.');
  } finally {
    favoritosPendentes.delete(id);
  }
}

// --- Modal "Adicionar à Playlist" ---

function mostrarMensagemModalPlaylists(texto) {
  if (!listaPlaylistsModal) return;
  listaPlaylistsModal.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'mensagem-lista';
  p.textContent = texto;
  listaPlaylistsModal.appendChild(p);
}

// textContent em tudo: nome de playlist é texto digitado pelo usuário.
function criarItemPlaylistModal(playlist, musica) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'item-playlist-modal';

  let capa;
  if (playlist.url_capa) {
    capa = document.createElement('img');
    capa.src = playlist.url_capa;
    capa.alt = '';
  } else {
    capa = document.createElement('span');
    capa.textContent = playlist.eh_favoritos ? '⭐' : '🎵';
  }
  capa.classList.add('item-playlist-capa');

  const nome = document.createElement('span');
  nome.className = 'item-playlist-nome';
  nome.textContent = playlist.nome;

  const estado = document.createElement('span');
  estado.className = 'item-playlist-estado';

  if (playlist.contem_musica) {
    item.classList.add('adicionada');
    estado.textContent = '✔ Já está aqui';
  }

  item.appendChild(capa);
  item.appendChild(nome);
  item.appendChild(estado);

  item.addEventListener('click', async () => {
    if (item.classList.contains('adicionada') || item.disabled) return;
    item.disabled = true;

    try {
      const resposta = await fetchComAutenticacao(`http://localhost:3000/api/playlists/${playlist.id}/musicas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ musicaId: musica.id })
      });
      if (!resposta.ok) throw new Error(String(resposta.status));

      item.classList.add('adicionada');
      estado.textContent = '✔ Adicionada';

      // Adicionar em "Favoritos" pelo modal equivale a favoritar: o coração acompanha.
      if (playlist.eh_favoritos) {
        idsFavoritos.add(Number(musica.id));
        atualizarTodosCoracoes();
      }
    } catch (erro) {
      if (erro.message !== '401') alert('Não foi possível adicionar a música à playlist.');
    } finally {
      item.disabled = false;
    }
  });

  return item;
}

async function abrirModalAddPlaylist(musica) {
  if (!musica || !musica.id) return;

  if (!estaLogado()) {
    alert('Faça login para adicionar músicas a playlists.');
    if (modalLogin) modalLogin.classList.remove('hidden');
    return;
  }

  musicaParaAdicionar = musica;
  if (modalAddPlaylist) modalAddPlaylist.classList.remove('hidden');
  mostrarMensagemModalPlaylists('Carregando...');

  try {
    const resposta = await fetchComAutenticacao(`http://localhost:3000/api/playlists?musicaId=${musica.id}`);
    const dados = await resposta.json();

    // Se o usuário fechou o modal ou abriu outra música enquanto carregava, descarta.
    if (musicaParaAdicionar !== musica) return;

    if (!resposta.ok) {
      mostrarMensagemModalPlaylists(dados.mensagem || 'Não foi possível carregar suas playlists.');
      return;
    }

    listaPlaylistsModal.innerHTML = '';
    dados.playlists.forEach((playlist) => {
      listaPlaylistsModal.appendChild(criarItemPlaylistModal(playlist, musica));
    });

    const dica = document.createElement('p');
    dica.className = 'link-cadastro';
    dica.appendChild(document.createTextNode('Quer outra playlist? '));
    const link = document.createElement('a');
    link.href = 'biblioteca.html';
    link.textContent = 'Crie na Biblioteca';
    dica.appendChild(link);
    listaPlaylistsModal.appendChild(dica);

  } catch (erro) {
    console.error('Erro ao carregar playlists:', erro);
    if (musicaParaAdicionar === musica) {
      mostrarMensagemModalPlaylists('Erro de conexão ao carregar suas playlists.');
    }
  }
}

if (btnFecharAddPlaylist && modalAddPlaylist) {
  btnFecharAddPlaylist.addEventListener('click', () => {
    modalAddPlaylist.classList.add('hidden');
    musicaParaAdicionar = null;
  });
}

// --- Botões da barra do player: agem sobre a música que está tocando ---
if (playerFavoritar) {
  playerFavoritar.addEventListener('click', () => {
    if (musicaNoPlayer) alternarFavorito(musicaNoPlayer);
  });
}

if (playerAddPlaylist) {
  playerAddPlaylist.addEventListener('click', () => {
    if (musicaNoPlayer) abrirModalAddPlaylist(musicaNoPlayer);
  });
}

// --- Botão "Minha Biblioteca" da navbar (a página chega na Parte 4) ---
const btnBiblioteca = document.getElementById('btn-biblioteca');
if (btnBiblioteca) {
  btnBiblioteca.addEventListener('click', () => {
    if (!estaLogado()) {
      alert('Faça login para acessar sua biblioteca.');
      if (modalLogin) modalLogin.classList.remove('hidden');
      return;
    }
    window.location.href = 'biblioteca.html';
  });
}

// Elementos da busca + do título da seção de músicas. Declarados aqui
// (antes do carrossel) porque carregarMusicas()/carregarMusicasMaisTocadas()
// já mexem no título, e um const declarado depois ficaria inacessível
// ("Cannot access before initialization") quando elas rodam.
const formBusca = document.querySelector('.nav-center form');
const campoBusca = formBusca ? formBusca.querySelector('input[name="q"]') : null;
const tituloSecaoMusicas = document.querySelector('.secao-titulo.aba-musicas');

// ============================================================
// CARROSSEL "MÚSICAS MAIS TOCADAS"
// ============================================================
// O carrossel é o mesmo: quem muda é só a origem dos dados.
// carregarMusicasMaisTocadas() (ranking) alimenta musicasAtuais e cai no
// catálogo geral se ainda não houver nenhuma reprodução — assim a home
// nunca fica vazia num banco novo, e a busca e o botão "inicio" seguem
// funcionando igual.
let musicasAtuais = [];
let indiceMscAtual = 0;

// Monta o card de destaque (música atualmente em foco no carrossel).
function criarDestaqueMusica(musica) {
  const div = document.createElement('div');
  div.className = 'msc-destaque';

  const capa = document.createElement('img');
  capa.className = 'msc-capa-img';
  capa.src = musica.url_capa || '';
  capa.alt = `Capa de ${musica.titulo}`;

  const info = document.createElement('div');
  info.className = 'msc-info';

  const nome = document.createElement('p');
  nome.className = 'msc-nome';
  nome.textContent = musica.titulo;

  const artista = document.createElement('p');
  artista.className = 'msc-artista';
  artista.textContent = musica.artista;

  const btnPlay = document.createElement('button');
  btnPlay.type = 'button';
  btnPlay.className = 'btn-play';
  btnPlay.textContent = '▶ Tocar';

  // Mesmo comportamento do botão de play do card antigo: exige login e
  // usa a mesma função tocarMusica() que já toca o áudio de verdade.
  btnPlay.addEventListener('click', () => {
    if (!estaLogado()) {
      alert('Faça login para tocar as músicas.');
      if (modalLogin) modalLogin.classList.remove('hidden');
      return;
    }
    tocarMusica(musica, btnPlay);
  });

  info.appendChild(nome);
  info.appendChild(artista);
  info.appendChild(btnPlay);

    // A capa agora vai dentro de um wrapper (mesmas medidas, 185px) pra que
  // os botões de favoritar/adicionar possam ficar ancorados nela.
  const capaWrapper = document.createElement('div');
  capaWrapper.className = 'msc-capa-wrapper';
  capaWrapper.appendChild(capa);

  const acoes = document.createElement('div');
  acoes.className = 'msc-acoes-capa';

  const btnFavoritar = criarBotaoIcone('btn-favoritar-destaque', '♡', 'Favoritar');
  btnFavoritar.dataset.musicaId = musica.id;
  pintarCoracao(btnFavoritar, idsFavoritos.has(Number(musica.id)));
  btnFavoritar.addEventListener('click', () => alternarFavorito(musica));

  const btnAddPlaylist = criarBotaoIcone('', '＋', 'Adicionar à playlist');
  btnAddPlaylist.addEventListener('click', () => abrirModalAddPlaylist(musica));

  acoes.appendChild(btnFavoritar);
  acoes.appendChild(btnAddPlaylist);
  capaWrapper.appendChild(acoes);

  div.appendChild(capaWrapper);   // <- substitui o antigo div.appendChild(capa);

  div.appendChild(info);

  return div;
}

// Monta uma mini-capa clicável (já vistas à esquerda / próximas à
// direita). Clicar nela só troca o foco do carrossel — não toca a música.
function criarMiniCapa(musica, indiceReal, classeExtra) {
  const img = document.createElement('img');
  img.className = classeExtra;
  img.src = musica.url_capa || '';
  img.alt = `Capa de ${musica.titulo || ''}`.trim();
  img.addEventListener('click', () => focarMusica(indiceReal));
  return img;
}

// Quantas "próximas" mostrar, dependendo de quão longe o usuário já
// avançou. Perto do início (destaque ainda à esquerda) há mais espaço
// sobrando, então mostramos mais; depois de 3 posições, quando o destaque
// já estabilizou, mantemos só 3 (o mínimo ideal do plano).
function quantidadeProximasAlvo(indice) {
  if (indice === 0) return 6;
  if (indice <= 2) return 5;
  return 4;
}

// Renderiza o destaque + as mini-capas dentro de #lista-musicas, com base
// em indiceMscAtual.
function renderCarrosselMusicas(lista) {
  if (!listaMusicas || !Array.isArray(lista) || lista.length === 0) return;

  if (indiceMscAtual < 0) indiceMscAtual = 0;
  if (indiceMscAtual > lista.length - 1) indiceMscAtual = lista.length - 1;

  listaMusicas.innerHTML = '';

  const anteriores = document.createElement('div');
  anteriores.className = 'msc-anteriores';

  const inicioAnteriores = Math.max(0, indiceMscAtual - 3);

  lista.slice(inicioAnteriores, indiceMscAtual).forEach((musica, i) => {
    const indiceReal = inicioAnteriores + i;
    anteriores.appendChild(criarMiniCapa(musica, indiceReal, 'msc-mini'));
  });

  listaMusicas.appendChild(anteriores);

  listaMusicas.appendChild(criarDestaqueMusica(lista[indiceMscAtual]));

  const proximas = document.createElement('div');
  proximas.className = 'msc-carrossel';

  const alvoProximas = quantidadeProximasAlvo(indiceMscAtual);
  const disponiveis = lista.length - indiceMscAtual - 1;
  const qtdProximas = Math.min(alvoProximas, disponiveis);

  for (let i = 0; i < qtdProximas; i++) {
    const indiceReal = indiceMscAtual + 1 + i;
    proximas.appendChild(criarMiniCapa(lista[indiceReal], indiceReal, 'msc-carrossel-item'));
  }

  listaMusicas.appendChild(proximas);
}

// Troca a música em foco do carrossel. Primeiro dispara a animação de
// saída (capa encolhe, vinil fecha, texto some) nos elementos atuais,
// espera ela terminar, e só então troca o conteúdo — que entra com a
// animação normal (capa cresce, vinil abre, texto some com fade-in).
let carrosselAnimando = false;

function focarMusica(novoIndice) {
  if (!listaMusicas) {
    indiceMscAtual = novoIndice;
    renderCarrosselMusicas(musicasAtuais);
    return;
  }

  if (carrosselAnimando) {
    // Troca já em andamento: aplica direto, sem empilhar animações.
    indiceMscAtual = novoIndice;
    renderCarrosselMusicas(musicasAtuais);
    return;
  }

  carrosselAnimando = true;
  listaMusicas.classList.add('saindo');

  setTimeout(() => {
    indiceMscAtual = novoIndice;
    renderCarrosselMusicas(musicasAtuais);
    listaMusicas.classList.remove('saindo');
    carrosselAnimando = false;
  }, 160);
}

// Setas de navegação: avançam/voltam uma música por vez, dando a volta
// (loop infinito) ao chegar numa ponta da lista.
const btnMscSetaEsq = document.getElementById('msc-seta-esq');
const btnMscSetaDir = document.getElementById('msc-seta-dir');

if (btnMscSetaEsq) {
  btnMscSetaEsq.addEventListener('click', () => {
    if (!musicasAtuais.length) return;
    const novoIndice = indiceMscAtual > 0 ? indiceMscAtual - 1 : musicasAtuais.length - 1;
    focarMusica(novoIndice);
  });
}

if (btnMscSetaDir) {
  btnMscSetaDir.addEventListener('click', () => {
    if (!musicasAtuais.length) return;
    const novoIndice = indiceMscAtual < musicasAtuais.length - 1 ? indiceMscAtual + 1 : 0;
    focarMusica(novoIndice);
  });
}

async function carregarMusicas() {
  if (!listaMusicas) return;

  if (tituloSecaoMusicas) tituloSecaoMusicas.textContent = 'Todas as músicas';

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

    if (!dados.musicas || dados.musicas.length === 0) {
      listaMusicas.innerHTML = '';
      const mensagem = document.createElement('p');
      mensagem.className = 'mensagem-lista';
      mensagem.textContent = 'Nenhuma música enviada ainda. Seja o primeiro a fazer upload!';
      listaMusicas.appendChild(mensagem);
      return;
    }

    musicasAtuais = dados.musicas;
    indiceMscAtual = 0;
    renderCarrosselMusicas(musicasAtuais);

  } catch (erro) {
    console.error('Erro ao carregar músicas:', erro);
    listaMusicas.innerHTML = '';
    const mensagem = document.createElement('p');
    mensagem.className = 'mensagem-lista';
    mensagem.textContent = 'Erro de conexão ao carregar as músicas.';
    listaMusicas.appendChild(mensagem);
  }
}

// Ranking geral (não é mensal: não existe histórico de data por play).
// Se o endpoint falhar OU vier vazio, mostra o catálogo geral — nunca
// deixa a seção principal da home quebrada por causa do ranking.
async function carregarMusicasMaisTocadas() {
  if (!listaMusicas) return;

  if (tituloSecaoMusicas) tituloSecaoMusicas.textContent = 'Músicas mais tocadas';

  try {
    const resposta = await fetch('http://localhost:3000/api/musicas/mais-tocadas');
    const dados = await resposta.json();

    if (!resposta.ok || !dados.musicas || dados.musicas.length === 0) {
      await carregarMusicas();
      return;
    }

    musicasAtuais = dados.musicas;
    indiceMscAtual = 0;
    renderCarrosselMusicas(musicasAtuais);

  } catch (erro) {
    console.error('Erro ao carregar as músicas mais tocadas:', erro);
    await carregarMusicas();
  }
}

// Carga inicial da home: as duas requisições de ranking, uma vez só.
carregarMusicasMaisTocadas();
carregarArtistasMaisOuvidos();
carregarFavoritos();   

// ============================================================
// BUSCA INLINE (mesma página — não navega, pra não matar o áudio tocando)
// ============================================================

if (formBusca) {
  formBusca.addEventListener('submit', async (event) => {
    event.preventDefault(); // intercepta — sem isso ele navegaria pro action do form
    const termo = campoBusca ? campoBusca.value.trim() : '';
    if (termo) executarBusca(termo);
  });
}

async function executarBusca(termo) {
  if (!listaMusicas) return;

  if (tituloSecaoMusicas) tituloSecaoMusicas.textContent = `Resultados para "${termo}"`;
  listaMusicas.innerHTML = '';
  const carregando = document.createElement('p');
  carregando.className = 'mensagem-lista';
  carregando.textContent = 'Buscando...';
  listaMusicas.appendChild(carregando);

  try {
    const resposta = await fetch(`http://localhost:3000/api/musicas/buscar?q=${encodeURIComponent(termo)}`);
    const dados = await resposta.json();

    if (!resposta.ok) {
      listaMusicas.innerHTML = '';
      const mensagem = document.createElement('p');
      mensagem.className = 'mensagem-lista';
      mensagem.textContent = dados.mensagem || 'Não foi possível buscar as músicas.';
      listaMusicas.appendChild(mensagem);
      return;
    }

    if (!dados.musicas || dados.musicas.length === 0) {
      listaMusicas.innerHTML = '';
      const mensagem = document.createElement('p');
      mensagem.className = 'mensagem-lista';
      mensagem.textContent = `Nenhuma música encontrada para "${termo}".`;
      listaMusicas.appendChild(mensagem);
      return;
    }

    // Reaproveita o mesmo carrossel do catálogo principal — só troca os
    // dados; a forma de renderizar (destaque + setas) continua igual.
    musicasAtuais = dados.musicas;
    indiceMscAtual = 0;
    renderCarrosselMusicas(musicasAtuais);

  } catch (erro) {
    console.error('Erro ao buscar músicas:', erro);
    listaMusicas.innerHTML = '';
    const mensagem = document.createElement('p');
    mensagem.className = 'mensagem-lista';
    mensagem.textContent = 'Erro de conexão ao buscar músicas.';
    listaMusicas.appendChild(mensagem);
  }
}

// ============================================================
// RANKING DE ARTISTAS MAIS OUVIDOS
// ============================================================

// Iniciais pro quadradinho do artista. Evita depender de foto/asset
// externo: o projeto ainda não tem imagem de artista cadastrada, e puxar
// uma capa aleatória da música enganaria (o ranking é por conta, não por
// música).
function iniciaisArtista(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function criarItemArtista(artista, posicao) {
  const item = document.createElement('div');
  item.className = 'artista-item';

  const numero = document.createElement('span');
  numero.className = 'artista-posicao';
  numero.textContent = `${posicao}`;

  const avatar = document.createElement('span');
  avatar.className = 'artista-avatar';
  avatar.textContent = iniciaisArtista(artista.artista);

  const info = document.createElement('div');
  info.className = 'artista-info';

  const nome = document.createElement('p');
  nome.className = 'artista-nome';
  nome.textContent = artista.artista || 'Artista sem nome';

  const reproducoes = document.createElement('p');
  reproducoes.className = 'artista-reproducoes';
  reproducoes.textContent = formatarReproducoes(artista.reproducoes);

  info.appendChild(nome);
  info.appendChild(reproducoes);

  item.appendChild(numero);
  item.appendChild(avatar);
  item.appendChild(info);

  return item;
}

function mostrarMensagemArtistas(mensagem) {
  if (!listaArtistas) return;
  listaArtistas.innerHTML = '';
  const paragrafo = document.createElement('p');
  paragrafo.className = 'mensagem-lista';
  paragrafo.textContent = mensagem;
  listaArtistas.appendChild(paragrafo);
}

async function carregarArtistasMaisOuvidos() {
  if (!listaArtistas) return;

  try {
    const resposta = await fetch('http://localhost:3000/api/artistas/mais-ouvidos');
    const dados = await resposta.json();

    if (!resposta.ok) {
      mostrarMensagemArtistas(dados.mensagem || 'Não foi possível carregar os artistas.');
      return;
    }

    if (!dados.artistas || dados.artistas.length === 0) {
      mostrarMensagemArtistas('Comece a ouvir músicas para gerar o ranking.');
      return;
    }

    listaArtistas.innerHTML = '';
    dados.artistas.forEach((artista, indice) => {
      listaArtistas.appendChild(criarItemArtista(artista, indice + 1));
    });

  } catch (erro) {
    console.error('Erro ao carregar os artistas mais ouvidos:', erro);
    mostrarMensagemArtistas('Erro de conexão ao carregar os artistas.');
  }
}

// "inicio" limpa a busca e volta pro estado inicial da home, que agora é o
// ranking de mais tocadas (com queda pro catálogo geral se ainda não houver
// reproduções — o mesmo fallback de quando a home abre).
const btnInicio = document.getElementById('btn-inicio');
if (btnInicio) {
  btnInicio.addEventListener('click', () => {
    if (campoBusca) campoBusca.value = '';
    // Só o carrossel: o ranking de artistas não depende da busca e não
    // precisa ser recarregado aqui.
    carregarMusicasMaisTocadas();
  });
}

// ============================================================
// UPLOAD DE MÚSICA
// ============================================================

// Nome de artista da conta logada, guardado aqui depois de consultado —
// usado só pra exibir no modal de upload, o valor de verdade quem decide
// é sempre o servidor (na hora de gravar a música).
let nomeArtistaAtual = '';

if (btnUpload) {
  btnUpload.addEventListener('click', async () => {
    if (!estaLogado()) {
      alert('Faça login para enviar músicas.');
      if (modalLogin) modalLogin.classList.remove('hidden');
      return;
    }
    await abrirFluxoUpload();
  });
}

// Confere se a conta já tem nome de artista definido. Se não tiver, pede
// primeiro (só na primeira vez); se já tiver, vai direto pro upload.
async function abrirFluxoUpload() {
  try {
    const resposta = await fetchComAutenticacao('http://localhost:3000/api/usuarios/eu');
    const dados = await resposta.json();

    if (!resposta.ok) {
      alert(dados.mensagem || 'Não foi possível verificar sua conta.');
      return;
    }

    if (!dados.usuario.eh_artista) {
      if (modalArtista) modalArtista.classList.remove('hidden');
    } else {
      abrirModalUpload(dados.usuario.nome_artista);
    }
  } catch (erro) {
    console.error('Erro ao verificar conta:', erro);
    alert('Erro de conexão com o servidor.');
  }
}

function abrirModalUpload(nomeArtista) {
  nomeArtistaAtual = nomeArtista;

  const spanArtistaNome = document.getElementById('upload-artista-nome');
  if (spanArtistaNome) spanArtistaNome.textContent = nomeArtista;
  if (previewArtista) previewArtista.textContent = nomeArtista;

  if (modalUpload) modalUpload.classList.remove('hidden');
}

if (btnFecharArtista && modalArtista) {
  btnFecharArtista.addEventListener('click', () => {
    modalArtista.classList.add('hidden');
    if (formArtista) formArtista.reset();
  });
}

if (formArtista) {
  formArtista.addEventListener('submit', async (event) => {
    event.preventDefault();

    const campoNomeArtista = document.getElementById('artista-nome');
    const nomeArtista = campoNomeArtista ? campoNomeArtista.value.trim() : '';

    if (!nomeArtista) {
      alert('Digite um nome de artista.');
      return;
    }

    const btnSubmitArtista = formArtista.querySelector('button[type="submit"]');
    if (btnSubmitArtista) {
      btnSubmitArtista.disabled = true;
      btnSubmitArtista.textContent = 'Salvando...';
    }

    try {
      const resposta = await fetchComAutenticacao('http://localhost:3000/api/usuarios/artista', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nomeArtista })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        if (modalArtista) modalArtista.classList.add('hidden');
        formArtista.reset();
        // Segue direto pro upload — é o motivo de ter aberto esse popup.
        abrirModalUpload(dados.usuario.nome_artista);
      } else {
        alert(dados.mensagem || 'Não foi possível salvar o nome de artista.');
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
    } finally {
      if (btnSubmitArtista) {
        btnSubmitArtista.disabled = false;
        btnSubmitArtista.textContent = 'Confirmar';
      }
    }
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
const campoAudio = document.getElementById('upload-audio');
const campoCapa = document.getElementById('upload-capa');

const previewCapa = document.getElementById('preview-upload-capa');
const previewCapaVazio = document.getElementById('preview-upload-capa-vazio');
const previewTitulo = document.getElementById('preview-upload-titulo');
const previewArtista = document.getElementById('preview-upload-artista');
const previewAudio = document.getElementById('preview-upload-audio');

let urlObjetoCapaAtual = null;

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
  // Artista NÃO volta pro genérico — é fixo da conta, continua mostrando
  // o nome já carregado por abrirModalUpload().
  if (previewArtista && nomeArtistaAtual) previewArtista.textContent = nomeArtistaAtual;
  if (previewAudio) previewAudio.textContent = 'Nenhum áudio selecionado';
}

if (campoTitulo && previewTitulo) {
  campoTitulo.addEventListener('input', () => {
    previewTitulo.textContent = campoTitulo.value.trim() || 'Título da música';
  });
}


if (campoAudio && previewAudio) {
  campoAudio.addEventListener('change', () => {
    const arquivo = campoAudio.files[0];
    previewAudio.textContent = arquivo ? `🎵 ${arquivo.name}` : 'Nenhum áudio selecionado';
  });
}

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
    const arquivoAudio = campoAudio && campoAudio.files[0] ? campoAudio.files[0] : null;
    const arquivoCapa = campoCapa && campoCapa.files[0] ? campoCapa.files[0] : null;

    if (!titulo || !arquivoAudio) {
      alert('Preencha o título e selecione o arquivo de áudio.');
      return;
    }

    const dadosFormulario = new FormData();
    dadosFormulario.append('titulo', titulo);
    dadosFormulario.append('audio', arquivoAudio);
    if (arquivoCapa) dadosFormulario.append('capa', arquivoCapa);

    const btnSubmitUpload = formUpload.querySelector('button[type="submit"]');
    if (btnSubmitUpload) {
      btnSubmitUpload.disabled = true;
      btnSubmitUpload.textContent = 'Enviando...';
    }

    try {
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
        carregarMusicas();
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