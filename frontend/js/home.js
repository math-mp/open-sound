// ============================================================
// TEMA CLARO / ESCURO (salvo no localStorage e sincronizado com backend)
// ============================================================
const btnTema = document.getElementById('btn-tema');
const API_BASE = 'https://open-sound.onrender.com';
const CHAVE_SESSAO = 'tokenSessao';

// O sessao.js entra sem `defer` no <head> e define window.OS. Se ele
// não vier (404, cache velho, aberto direto do disco), esta versão sem
// cache evita que o arquivo inteiro abafe aqui e leve junto os modais,
// o upload, os favoritos e a criação de playlist.
if (!window.OS) {
  window.OS = {
    IDADE_MAXIMA_CACHE: 0,
    perfilCacheado: () => null,
    revalidar: () => Promise.resolve(null),
    aoEntrar: () => Promise.resolve(null),
    aoTrocarAvatar: () => {},
    invalidar: () => {},
    limparCache: () => {},
    pintarTodos: () => {},
    aplicarTema: (tema) => {
      if (tema === 'light') document.documentElement.dataset.theme = 'light';
      else delete document.documentElement.dataset.theme;
    }
  };
}

function obterTokenSessao() {
  return localStorage.getItem(CHAVE_SESSAO);
}

function estaLogado() {
  return !!obterTokenSessao();
}

// Token rejeitado, logout em outra aba ou revalidação que tomou 401:
// em todos esses casos a navbar precisa voltar ao estado de visitante
// no mesmo instante. Passar por aqui (e não só pela classe `hidden`)
// é o que mantém o atributo data-sessao do <html> em sincronia.
function encerrarSessaoLocal() {
  localStorage.removeItem(CHAVE_SESSAO);
  if (window.OS) OS.limparCache();
  atualizarUIAutenticacao();
}

document.addEventListener('opensound:sessao-invalida', encerrarSessaoLocal);

async function fetchComAutenticacao(url, opcoes = {}) {
  const token = obterTokenSessao();
  const headers = { ...(opcoes.headers || {}), Authorization: `Bearer ${token}` };

  const resposta = await fetch(url, { ...opcoes, headers });

  if (resposta.status === 401) {
    encerrarSessaoLocal();
    alert('Sua sessão expirou. Faça login novamente.');
  }

  return resposta;
}

function aplicarTema(tema) {
  // Quem decide as cores é o theme.css; o atributo no <html> e o
  // localStorage são centralizados no sessao.js (que já aplicou o
  // tema salvo antes do primeiro paint, no <head>).
  OS.aplicarTema(tema);
  if (btnTema) btnTema.textContent = tema === 'light' ? '🌙' : '☀️';
}

// O botão da navbar acompanha o tema de qualquer origem (clique aqui,
// troca em outra aba ou revalidação do perfil) sem duplicar regra.
document.addEventListener('opensound:tema', (evento) => {
  if (btnTema && evento.detail) btnTema.textContent = evento.detail.tema === 'light' ? '🌙' : '☀️';
});

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
    const novoTema = temaAtual() === 'light' ? 'dark' : 'light';
    aplicarTema(novoTema);
    await salvarTemaNoBackend(novoTema);
  });
}

function temaAtual() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
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
const linkSairDropdown = document.getElementById('link-sair-dropdown');

// Elementos do Modal de Upload e do Container Universal de Músicas
const modalUpload = document.getElementById('modal-upload');
const btnFecharUpload = document.getElementById('btn-fechar-upload');
const formUpload = document.getElementById('form-upload');
const btnUpload = document.getElementById('btn-upload');
const listaMusicas = document.getElementById('lista-musicas');
const listaArtistas = document.getElementById('lista-artistas');
// Declarado aqui, e não junto das funções da seção: carregarDescobrirMusicas()
// roda na carga inicial (mais abaixo) e um const declarado depois ficaria
// inacessível — "Cannot access before initialization".
const listaDescobrir = document.getElementById('lista-descobrir');

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
      const resposta = await fetch('https://open-sound.onrender.com/api/registro', {
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
      const resposta = await fetch('https://open-sound.onrender.com/api/validar-2fa', {
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
      const resposta = await fetch('https://open-sound.onrender.com/api/reenviar-2fa', {
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
      const resposta = await fetch('https://open-sound.onrender.com/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, lembrarDeMim })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        localStorage.setItem(CHAVE_SESSAO, dados.tokenSessao);
        atualizarUIAutenticacao();

        carregarFavoritos();
        // Traz tema/avatar/nome do banco em UM request só. O que já
        // estava em cache (pintado antes do paint) aparece na hora.
        OS.aoEntrar();

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
    OS.limparCache();
    atualizarUIAutenticacao();
    limparFavoritosLocais();
    alert('Você foi deslogado.');
  });
}

if (linkSairDropdown) {
  linkSairDropdown.addEventListener('click', (e) => {
    e.preventDefault();
    const confirmou = confirm('Você realmente deseja deslogar da sua conta?');
    if (!confirmou) return;

    localStorage.removeItem(CHAVE_SESSAO);
    OS.limparCache();
    atualizarUIAutenticacao();
    limparFavoritosLocais();
    alert('Você foi deslogado.');
  });
}

if (btnPerfilAvatar) {
  btnPerfilAvatar.addEventListener('click', () => {
    window.location.href = 'perfil.html';
  });
}

// Estado inicial da navbar ao carregar a página. Avatar, nome e tema
// já foram pintados pelo sessao.js antes do paint; aqui só validamos
// com o servidor (um único GET /api/perfil, compartilhado).
atualizarUIAutenticacao();
if (estaLogado()) OS.revalidar();

// ============================================================
// AVATAR / NOME / TEMA DA NAVBAR
// ============================================================
// Não busca mais nada aqui: quem resolve é o sessao.js, que pinta o
// avatar e o nome a partir do cache local (antes do paint) e revalida
// em segundo plano. O que sobrou da implementação antiga
// (carregarAvatarPerfil / carregarTemaDoBackend) foram removidos
// porque disparavam um GET /api/perfil duplicado a cada carregamento.

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
      const resposta = await fetch('https://open-sound.onrender.com/api/auth/esqueci-senha', {
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
      const resposta = await fetch('https://open-sound.onrender.com/api/auth/reenviar-esqueci', {
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
      const resposta = await fetch('https://open-sound.onrender.com/api/auth/validar-esqueci', {
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
      const resposta = await fetch('https://open-sound.onrender.com/api/auth/confirmar-esqueci', {
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
// Moraram aqui até os botões da barra do player (o coração e o "＋")
// existirem só na home. Agora ficam no favoritos.js, que todas as
// páginas carregam: pintarCoracao(), atualizarTodosCoracoes(),
// alternarFavorito(), abrirModalAddPlaylist(), criarBotaoIcone(),
// carregarFavoritos() e limparFavoritosLocais() vêm de lá.

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

// Peças do dropdown da busca. Ele é a única superfície da busca agora:
// os resultados não existem em nenhum outro lugar da Home.
const wrapperBusca = campoBusca ? campoBusca.closest('.busca-wrapper') : null;
const dropdownBusca = document.getElementById('dropdown-busca');
const buscaHeader = document.getElementById('busca-header');
const buscaLista = document.getElementById('busca-lista');
const btnLimparRecentes = document.getElementById('btn-limpar-recentes');

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

  // Botão de favoritar: agora fica ao lado do "Tocar" (mesmo estilo/cor),
  // não mais sobre a capa. A lógica (coração cheio/vazio, fetch de
  // favoritar/desfavoritar) continua a mesma de sempre.
  const btnFavoritar = criarBotaoIcone('btn-favoritar-destaque', '♡', 'Favoritar');
  btnFavoritar.dataset.musicaId = musica.id;
  // O atributo é o que o atualizarTodosCoracoes usa para repintar, e ele
  // precisa estar nos dois botões de favoritar da página (o do carrossel e
  // o da lista de descobertas).
  btnFavoritar.dataset.favoritavel = 'sim';
  pintarCoracao(btnFavoritar, idsFavoritos.has(Number(musica.id)));
  btnFavoritar.addEventListener('click', () => alternarFavorito(musica));

  const botoesInfo = document.createElement('div');
  botoesInfo.className = 'msc-info-botoes';
  botoesInfo.appendChild(btnPlay);
  botoesInfo.appendChild(btnFavoritar);

  info.appendChild(nome);
  info.appendChild(artista);
  info.appendChild(botoesInfo);

    // A capa agora vai dentro de um wrapper (mesmas medidas, 185px) pra que
  // o botão de adicionar à playlist possa ficar ancorado nela.
  const capaWrapper = document.createElement('div');
  capaWrapper.className = 'msc-capa-wrapper';
  capaWrapper.appendChild(capa);

  const acoes = document.createElement('div');
  acoes.className = 'msc-acoes-capa';

  const btnAddPlaylist = criarBotaoIcone('', '＋', 'Adicionar à playlist');
  btnAddPlaylist.addEventListener('click', () => abrirModalAddPlaylist(musica));

  // "Tocar depois": joga no fim da fila sem tirar o que está tocando.
  const btnFila = criarBotaoIcone('btn-enfileirar-destaque', '⇥', 'Tocar depois');
  btnFila.dataset.musicaId = musica.id;
  btnFila.addEventListener('click', () => {
    if (!estaLogado()) {
      alert('Faça login para usar a fila.');
      if (modalLogin) modalLogin.classList.remove('hidden');
      return;
    }
    adicionarAFila(musica);
  });

  acoes.appendChild(btnFavoritar);
  acoes.appendChild(btnAddPlaylist);
  acoes.appendChild(btnFila);
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
    const resposta = await fetch('https://open-sound.onrender.com/api/musicas');
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
    const resposta = await fetch('https://open-sound.onrender.com/api/musicas/mais-tocadas');
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
// Os favoritos NÃO entram aqui: quem carrega é o favoritos.js, que roda
// em todas as páginas — o carrossel só pinta o coração com o que ele
// já trouxer.
carregarMusicasMaisTocadas();
carregarArtistasMaisOuvidos();
carregarDescobrirMusicas();

// ============================================================
// BUSCA DA HOME — DROPDOWN
//
// A busca é uma camada SOBRE a Home, nunca no lugar dela: tudo que ela
// pinta acontece dentro do dropdown colado no campo de pesquisa. O
// carrossel de "Músicas mais tocadas", o ranking de "Artistas mais
// ouvidos" e o player não são tocados em momento nenhum — nem quando a
// busca acha 50 músicas, nem quando não acha nenhuma.
//
// São dois estados, e nunca ao mesmo tempo:
//
//   campo vazio        → "Buscas recentes" (localStorage)
//   campo com texto    → "Resultados"      (GET /api/musicas/buscar
//                                          + GET /api/perfil/buscar)
//
// O submit continua interceptado com preventDefault(): sem isso o <form>
// navegaria para o action e o áudio em andamento seria cortado.
// ============================================================

// ------------------------------------------------------------
// PESQUISAS RECENTES (localStorage)
// ------------------------------------------------------------
//
// Nada de servidor, nada de tabela, nenhuma mudança no backend. Além do
// termo, guardamos o pedaço do resultado que ele encontrou (título,
// artista, url da capa e tipo) para o item abrir já com capa e rótulo,
// sem chamar a API de novo a cada vez que o dropdown abre.
//
// Guarda só dado público de catálogo. Nunca token, senha, código de 2FA
// ou dado privado de conta.
//
// O localStorage pode não existir (modo privativo, permissão negada,
// quota cheia), então toda leitura e escrita é encapsulada: a busca
// continua funcionando mesmo sem histórico.

const CHAVE_PESQUISAS_RECENTES = 'opensound_pesquisas_recentes';
const LIMITE_PESQUISAS_RECENTES = 6;
const DEBOUNCE_BUSCA_MS = 300;

// Só http(s) do storage e data:image (prévia local) valem. Uma url
// guardada que não passe por aqui viraria javascript: no src de uma <img>.
function urlDeCapaSegura(valor) {
  if (typeof valor !== 'string') return '';
  const url = valor.trim();
  if (!url) return '';
  return /^(https?:\/\/|data:image\/)/i.test(url) ? url : '';
}

// Aceita tanto o formato novo (objeto) quanto o antigo (a lista era só de
// strings). Qualquer histórico vira item com capa ou não — nunca quebra.
function normalizarRecente(bruto) {
  if (typeof bruto === 'string') {
    const termo = bruto.trim();
    return termo ? { termo, titulo: termo, artista: '', urlCapa: '', tipo: 'texto' } : null;
  }

  if (!bruto || typeof bruto !== 'object') return null;

  const termo = typeof bruto.termo === 'string' ? bruto.termo.trim() : '';
  if (!termo) return null;

  return {
    termo,
    titulo: typeof bruto.titulo === 'string' && bruto.titulo.trim() ? bruto.titulo.trim() : termo,
    artista: typeof bruto.artista === 'string' ? bruto.artista.trim() : '',
    urlCapa: urlDeCapaSegura(bruto.urlCapa),
    tipo: ['musica', 'artista', 'pessoa', 'texto'].includes(bruto.tipo) ? bruto.tipo : 'texto',
  };
}

function carregarPesquisasRecentes() {
  try {
    const bruto = localStorage.getItem(CHAVE_PESQUISAS_RECENTES);
    if (!bruto) return [];
    const dados = JSON.parse(bruto);
    if (!Array.isArray(dados)) return [];
    return dados
      .map(normalizarRecente)
      .filter(Boolean)
      .slice(0, LIMITE_PESQUISAS_RECENTES);
  } catch (erro) {
    console.warn('Não foi possível ler as buscas recentes:', erro);
    return [];
  }
}

function gravarPesquisasRecentes(lista) {
  try {
    localStorage.setItem(CHAVE_PESQUISAS_RECENTES, JSON.stringify(lista));
  } catch (erro) {
    console.warn('Não foi possível salvar as buscas recentes:', erro);
  }
}

// Substitui o registro do mesmo termo. A comparação ignora maiúsculas
// ("bk" e "BK" são a mesma busca), mas o registro novo — com a capa e o
// tipo mais atuais — é o que fica.
function registrarBuscaRecente(termo, parcial) {
  const alvo = String(termo || '').trim();
  if (!alvo) return;

  const chave = alvo.toLowerCase();
  const restantes = carregarPesquisasRecentes().filter((item) => item.termo.toLowerCase() !== chave);

  const novo = normalizarRecente({ termo: alvo, ...(parcial || {}) });
  if (!novo) return;

  // O slice descarta a mais antiga quando passa de 6.
  gravarPesquisasRecentes([novo, ...restantes].slice(0, LIMITE_PESQUISAS_RECENTES));
}

function removerPesquisaRecente(termo) {
  const alvo = String(termo || '').trim().toLowerCase();
  const restantes = carregarPesquisasRecentes().filter((item) => item.termo.toLowerCase() !== alvo);

  gravarPesquisasRecentes(restantes);
  mostrarEstadoAtual(); // a lista encolhe na hora, sem fechar o dropdown
}

function limparPesquisasRecentes() {
  try {
    localStorage.removeItem(CHAVE_PESQUISAS_RECENTES);
  } catch (erro) {
    console.warn('Não foi possível limpar as buscas recentes:', erro);
    gravarPesquisasRecentes([]);
  }

  mostrarEstadoAtual();
}

// ------------------------------------------------------------
// DROPDOWN — dois estados
// ------------------------------------------------------------

function definirCabecalho(texto) {
  if (buscaHeader) buscaHeader.textContent = texto;
}

function mostrarBotaoLimpar(visivel) {
  if (btnLimparRecentes) btnLimparRecentes.classList.toggle('hidden', !visivel);
}

function abrirDropdown() {
  if (dropdownBusca) dropdownBusca.classList.remove('hidden');
}

function fecharDropdown() {
  if (dropdownBusca) dropdownBusca.classList.add('hidden');
}

function dropdownAberto() {
  return Boolean(dropdownBusca) && !dropdownBusca.classList.contains('hidden');
}

function mostrarAvisoDropdown(texto, modificador) {
  if (!buscaLista) return;

  buscaLista.innerHTML = '';
  const aviso = document.createElement('li');
  aviso.className = modificador ? `busca-aviso ${modificador}` : 'busca-aviso';
  aviso.textContent = texto; // textContent: o texto nunca vira HTML.
  buscaLista.appendChild(aviso);
}

// Parte visual compartilhada por recentes, músicas e pessoas: capa (ou o
// quadradinho com 🎵) e as duas linhas de texto. O elemento clicável é
// montado por fora, porque o de música é <button> e o de pessoa é <a>.
function pintarCapaETexto(item, dados) {
  if (dados.capaUrl) {
    const capa = document.createElement('img');
    capa.className = 'busca-item-capa';
    capa.src = dados.capaUrl;
    capa.alt = '';
    capa.loading = 'lazy';
    item.appendChild(capa);
  } else {
    const capaVazia = document.createElement('span');
    capaVazia.className = 'busca-item-capa busca-item-capa-vazia';
    capaVazia.setAttribute('aria-hidden', 'true');
    capaVazia.textContent = '🎵';
    item.appendChild(capaVazia);
  }

  const info = document.createElement('span');
  info.className = 'busca-item-info';

  const titulo = document.createElement('span');
  titulo.className = 'busca-item-titulo';
  titulo.textContent = dados.titulo;
  titulo.title = dados.titulo;
  info.appendChild(titulo);

  if (dados.subtitulo) {
    const subtitulo = document.createElement('span');
    subtitulo.className = 'busca-item-subtitulo';
    subtitulo.textContent = dados.subtitulo;
    info.appendChild(subtitulo);
  }

  item.appendChild(info);
}

// Rótulo da linha de baixo. Vem do que a API devolveu: o endpoint de
// músicas não tem coluna de tipo, então "Música" é etiqueta nossa; artista
// e pessoa usam o campo eh_artista que o endpoint de pessoas devolve.
function rotuloDe(tipo, artista) {
  if (tipo === 'musica') return artista ? `Música • ${artista}` : 'Música';
  if (tipo === 'artista') return 'Artista';
  if (tipo === 'pessoa') return 'Pessoa';
  return '';
}

// --- Estado 1: buscas recentes ---------------------------------

function criarItemRecente(recente) {
  const item = document.createElement('li');
  item.className = 'busca-item';

  const botao = document.createElement('button');
  botao.type = 'button'; // sem isso, submeteria o form da navbar
  botao.className = 'busca-item-acao';
  botao.title = `Buscar por "${recente.termo}"`;

  pintarCapaETexto(botao, {
    capaUrl: recente.urlCapa,
    titulo: recente.titulo,
    subtitulo: rotuloDe(recente.tipo, recente.artista),
  });

  // Clicou num recente: preenche o campo e refaz a busca. O dropdown fica
  // aberto mostrando os resultados — é para isso que o usuário clicou.
  botao.addEventListener('click', () => {
    if (campoBusca) campoBusca.value = recente.termo;
    clearTimeout(timerBusca);
    buscarNoDropdown(recente.termo);
  });

  item.appendChild(botao);

  // O "×" é irmão do botão, não filho: precisa parar o evento sozinho,
  // senão o clique também executaria a busca daquele termo.
  const remover = document.createElement('button');
  remover.type = 'button';
  remover.className = 'busca-item-remover';
  remover.setAttribute('aria-label', `Remover a busca "${recente.termo}"`);
  remover.textContent = '×';
  remover.addEventListener('click', (event) => {
    event.stopPropagation();
    event.preventDefault();
    removerPesquisaRecente(recente.termo);
  });

  item.appendChild(remover);
  return item;
}

function renderizarRecentes() {
  definirCabecalho('Buscas recentes');
  if (!buscaLista) return;

  const recentes = carregarPesquisasRecentes();
  buscaLista.innerHTML = '';

  if (!recentes.length) {
    mostrarAvisoDropdown('Nenhuma busca salva ainda.');
    mostrarBotaoLimpar(false);
    return;
  }

  recentes.forEach((recente) => buscaLista.appendChild(criarItemRecente(recente)));
  mostrarBotaoLimpar(true);
}

// --- Estado 2: resultados da API -------------------------------

function criarItemMusica(musica) {
  const item = document.createElement('li');
  item.className = 'busca-item';

  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'busca-item-acao';

  const titulo = musica.titulo || 'Música sem título';
  pintarCapaETexto(botao, {
    capaUrl: musica.url_capa,
    titulo,
    subtitulo: rotuloDe('musica', musica.artista),
  });

  // Selecionar uma música toca no player de verdade: mesma função e mesma
  // guarda de login que o carrossel e a lista "Descubra" já usam. Não há
  // segundo estado de áudio no projeto — o botão que muda é o da barra.
  botao.addEventListener('click', () => {
    const termo = campoBusca ? campoBusca.value.trim() : '';
    // O histórico guarda capa e tipo a partir de agora.
    registrarBuscaRecente(termo, {
      titulo,
      artista: musica.artista || '',
      urlCapa: musica.url_capa || '',
      tipo: 'musica',
    });

    fecharDropdown();

    if (!estaLogado()) {
      alert('Faça login para tocar as músicas.');
      if (modalLogin) modalLogin.classList.remove('hidden');
      return;
    }
    tocarMusica(musica);
  });

  item.appendChild(botao);
  return item;
}

// Artista/pessoa é <a> para o perfil, como já era antes desta busca: o
// endpoint de pessoas não devolve músicas, então não há o que tocar ali —
// abrir a página de quem a pessoa procurou é a ação da linha.
function criarItemPessoa(pessoa) {
  const item = document.createElement('li');
  item.className = 'busca-item';

  const link = document.createElement('a');
  link.className = 'busca-item-acao';
  link.href = 'perfil.html?u=' + encodeURIComponent(pessoa.nome_usuario);
  link.title = `Ver o perfil de @${pessoa.nome_usuario}`;

  const nome = pessoa.nome || pessoa.nome_usuario;
  const ehArtista = Boolean(pessoa.eh_artista);

  pintarCapaETexto(link, {
    capaUrl: pessoa.avatar_url,
    titulo: nome,
    subtitulo: rotuloDe(ehArtista ? 'artista' : 'pessoa'),
  });

  // Só conta como busca realizada quando a pessoa escolhe o resultado, e
  // não a cada tecla digitada.
  link.addEventListener('click', () => {
    const termo = campoBusca ? campoBusca.value.trim() : '';
    registrarBuscaRecente(termo, {
      titulo: nome,
      artista: '',
      urlCapa: pessoa.avatar_url || '',
      tipo: ehArtista ? 'artista' : 'pessoa',
    });
  });

  item.appendChild(link);
  return item;
}

function renderizarResultados(musicas, pessoas) {
  definirCabecalho('Resultados');
  if (!buscaLista) return;

  buscaLista.innerHTML = '';

  if (!musicas.length && !pessoas.length) {
    mostrarAvisoDropdown('Nenhum resultado encontrado', 'busca-vazio');
    mostrarBotaoLimpar(false);
    return;
  }

  // Músicas primeiro (é o endpoint principal), depois artistas/pessoas,
  // para um nome como "Teto" já aparecer na primeira linha.
  musicas.forEach((musica) => buscaLista.appendChild(criarItemMusica(musica)));
  pessoas.forEach((pessoa) => buscaLista.appendChild(criarItemPessoa(pessoa)));
  mostrarBotaoLimpar(false);
}

// ------------------------------------------------------------
// BUSCA COM DEBOUNCE
// ------------------------------------------------------------

let ultimaBusca = { termo: '', musicas: [], pessoas: [] };
let timerBusca = null;
// Só a resposta mais recente pode pintar. Sem isso, digitar rápido
// deixaria uma resposta lenta antiga sobrescrever o resultado novo.
let buscaEmCurso = 0;

async function buscarNoDropdown(termo) {
  const alvo = String(termo || '').trim();

  if (!alvo) {
    buscaEmCurso++; // invalida uma resposta que ainda esteja voando
    ultimaBusca = { termo: '', musicas: [], pessoas: [] };
    renderizarRecentes();
    abrirDropdown();
    return;
  }

  const seq = ++buscaEmCurso;
  definirCabecalho('Resultados');
  mostrarAvisoDropdown('Buscando...', 'busca-carregando');
  mostrarBotaoLimpar(false);
  abrirDropdown();

  // O endpoint de pessoas recusa menos de 2 letras (400) e tem limite por
  // IP: com uma letra só não há o que pedir.
  const pedirPessoas = alvo.length >= 2;

  // As duas requisições são independentes: uma falhar não esconde a outra.
  // API_BASE, e não a URL literal: o resto do arquivo fala com o servidor
  // de produção e o dropdown não pode ficar apontando para o localhost.
  const [respostaMusicas, respostaPessoas] = await Promise.all([
    fetch(`${API_BASE}/api/musicas/buscar?q=${encodeURIComponent(alvo)}`).catch(() => null),
    pedirPessoas
      ? fetch(`${API_BASE}/api/perfil/buscar?q=${encodeURIComponent(alvo)}`).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Enquanto isso o usuário continuou digitando: esta resposta é velha.
  if (seq !== buscaEmCurso) return;

  let musicas = [];
  if (respostaMusicas && respostaMusicas.ok) {
    try {
      const dados = await respostaMusicas.json();
      musicas = Array.isArray(dados.musicas) ? dados.musicas : [];
    } catch (erro) {
      musicas = [];
    }
  }

  let pessoas = [];
  if (respostaPessoas && respostaPessoas.ok) {
    try {
      const dados = await respostaPessoas.json();
      pessoas = Array.isArray(dados.pessoas) ? dados.pessoas : [];
    } catch (erro) {
      pessoas = [];
    }
  }

  if (seq !== buscaEmCurso) return;

  ultimaBusca = { termo: alvo, musicas, pessoas };
  renderizarResultados(musicas, pessoas);
}

// O que o dropdown mostra, olhando só o campo: vazio → recentes; com texto
// → os resultados daquele termo, refazendo a requisição se ainda não existem.
function mostrarEstadoAtual() {
  const termo = campoBusca ? campoBusca.value.trim() : '';

  if (!termo) {
    renderizarRecentes();
    abrirDropdown();
    return;
  }

  if (ultimaBusca.termo === termo) {
    renderizarResultados(ultimaBusca.musicas, ultimaBusca.pessoas);
    abrirDropdown();
    return;
  }

  buscarNoDropdown(termo);
}

// 300ms sem digitar. É o que segura a quantidade de requisições: sem isso
// seria uma por tecla, e o endpoint de pessoas ainda tem limite por IP.
function agendarBusca() {
  clearTimeout(timerBusca);

  const termo = campoBusca ? campoBusca.value.trim() : '';
  if (!termo) {
    // Apagou tudo: volta para as buscas recentes na hora, sem esperar o timer.
    buscaEmCurso++;
    renderizarRecentes();
    abrirDropdown();
    return;
  }

  timerBusca = setTimeout(() => buscarNoDropdown(termo), DEBOUNCE_BUSCA_MS);
}

// ------------------------------------------------------------
// EVENTOS
// ------------------------------------------------------------

if (formBusca) {
  formBusca.addEventListener('submit', (event) => {
    event.preventDefault(); // sem isso ele navegaria pro action do form e cortaria o áudio
    const termo = campoBusca ? campoBusca.value.trim() : '';
    if (!termo) return;

    clearTimeout(timerBusca);
    // Enter é uma busca realizada, então o termo entra no histórico. A capa
    // e o tipo são preenchidos depois, quando um resultado for escolhido.
    registrarBuscaRecente(termo);
    buscarNoDropdown(termo);
  });
}

if (campoBusca) {
  campoBusca.addEventListener('focus', mostrarEstadoAtual);
  campoBusca.addEventListener('click', mostrarEstadoAtual);
  campoBusca.addEventListener('input', agendarBusca);
}

if (btnLimparRecentes) {
  btnLimparRecentes.addEventListener('click', (event) => {
    event.preventDefault(); // "Limpar" não é uma busca
    limparPesquisasRecentes();
  });
}

document.addEventListener('click', (event) => {
  if (!dropdownAberto()) return;
  // Clicar dentro da barra ou do próprio dropdown não fecha — senão não
  // daria para escolher um item.
  if (wrapperBusca && wrapperBusca.contains(event.target)) return;
  fecharDropdown();
});

document.addEventListener('keydown', (event) => {
  if (!dropdownAberto()) return;

  // Esc fecha e devolve o foco ao campo, para continuar digitando.
  if (event.key === 'Escape') {
    fecharDropdown();
    if (campoBusca) campoBusca.focus();
    return;
  }

  // Setas sobem e descem entre os itens; o Enter é o do próprio botão.
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

  const acoes = dropdownBusca.querySelectorAll('.busca-item-acao');
  if (!acoes.length) return;

  const atual = Array.prototype.indexOf.call(acoes, document.activeElement);
  const passo = event.key === 'ArrowDown' ? 1 : -1;
  const proximo = atual === -1
    ? (passo === 1 ? 0 : acoes.length - 1)
    : (atual + passo + acoes.length) % acoes.length;

  event.preventDefault();
  acoes[proximo].focus();
});


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

// Formata só o número (600.959), sem o texto "reproduções". O rótulo fica
// em um <span> separado pra o CSS poder mostrar ou esconder por estado.
function formatarNumeroBR(quantidade) {
  const numero = Number(quantidade);
  if (!Number.isFinite(numero)) return '0';
  return numero.toLocaleString('pt-BR');
}

function criarItemArtista(artista, posicao) {
  const item = document.createElement('div');
  // Do 4º em diante o card fica compacto (definido no CSS).
  item.className = posicao > 3 ? 'artista-item artista-item--compacto' : 'artista-item';

  const numero = document.createElement('span');
  numero.className = 'artista-posicao';
  numero.textContent = `${posicao}º`;

  // Card que agrupa avatar + informações (o número fica fora, à esquerda).
  const card = document.createElement('div');
  card.className = 'artista-card';

  // Foto real quando o artista tem avatar enviado (o endpoint devolve
  // avatar_url). Sem foto, continua o fallback de iniciais que já existia
  // aqui — nenhum caminho inventa imagem.
  let avatar;
  if (artista.avatar_url) {
    avatar = document.createElement('img');
    avatar.className = 'artista-avatar';
    avatar.src = artista.avatar_url;
    avatar.alt = `Foto de ${artista.artista || 'artista'}`;
    avatar.loading = 'lazy';
  } else {
    avatar = document.createElement('span');
    avatar.className = 'artista-avatar';
    avatar.textContent = iniciaisArtista(artista.artista);
  }

  const info = document.createElement('div');
  info.className = 'artista-info';

  // O nome do artista abre o perfil público dele. A rota aceita @ ou id;
  // aqui o endpoint já devolve o @, que é o identificador "de verdade".
  const nome = document.createElement('p');
  nome.className = 'artista-nome';
  if (artista.nome_usuario && window.OS && typeof OS.linkPerfil === 'function') {
    nome.appendChild(OS.linkPerfil({
      identificador: artista.nome_usuario,
      texto: artista.artista || 'Artista sem nome',
      descricao: `Ver o perfil de ${artista.artista}`
    }));
  } else {
    nome.textContent = artista.artista || 'Artista sem nome';
  }
  nome.title = nome.textContent;

  info.appendChild(nome);

  // Informação secundária real: quantidade de músicas do artista.
  const totalMusicas = Number(artista.musicas);
  if (Number.isFinite(totalMusicas)) {
    const detalhe = document.createElement('p');
    detalhe.className = 'artista-detalhe';
    detalhe.textContent = `${totalMusicas} ${totalMusicas === 1 ? 'música' : 'músicas'}`;
    info.appendChild(detalhe);
  }

  const reproducoes = document.createElement('p');
  reproducoes.className = 'artista-reproducoes';

  const valor = document.createElement('span');
  valor.className = 'artista-reproducoes-valor';
  valor.textContent = formatarNumeroBR(artista.reproducoes);

  const rotulo = document.createElement('span');
  rotulo.className = 'artista-reproducoes-rotulo';
  rotulo.textContent = Number(artista.reproducoes) === 1 ? 'Reprodução' : 'Reproduções';

  reproducoes.appendChild(valor);
  reproducoes.appendChild(rotulo);
  info.appendChild(reproducoes);

  card.appendChild(avatar);
  card.appendChild(info);

  item.appendChild(numero);
  item.appendChild(card);

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
    const resposta = await fetch('https://open-sound.onrender.com/api/artistas/mais-ouvidos');
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

// ============================================================
// "DESCUBRA NOVAS MÚSICAS"
// ============================================================
// Lista as músicas mais recém-enviadas. Os dados vêm do catálogo geral
// (GET /api/musicas), que já vem ordenado por criado_em DESC.
// O #lista-descobrir é lido lá em cima, junto dos outros elementos do DOM.

function mostrarMensagemDescobrir(mensagem, estado) {
  if (!listaDescobrir) return;
  listaDescobrir.innerHTML = '';
  listaDescobrir.dataset.estado = estado;
  const item = document.createElement('li');
  item.className = 'mensagem-lista';
  item.textContent = mensagem;
  listaDescobrir.appendChild(item);
}

// mm:ss. Sem valor (null/NaN) vira '--:--' — nunca um tempo chutado.
function formatarDuracao(segundos) {
  if (segundos === null || Number.isNaN(Number(segundos))) return '--:--';
  const min = Math.floor(segundos / 60);
  const seg = Math.floor(segundos % 60).toString().padStart(2, '0');
  return `${min}:${seg}`;
}

// Duração real, lida do metadata do próprio arquivo pelo navegador. Não
// existe coluna de duração no banco, e não é preciso criar uma: o
// HTMLAudioElement sabe quanto tempo o áudio dura sem baixar ele inteiro.
// Arquivo indisponível/CORS bloqueado resolve null e a célula fica '--:--'.
function obterDuracaoReal(urlAudio) {
  return new Promise((resolve) => {
    if (!urlAudio) return resolve(null);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => resolve(audio.duration));
    audio.addEventListener('error', () => resolve(null));
    audio.src = urlAudio;
  });
}

function criarItemDescobrir(musica) {
  const item = document.createElement('li');
  item.className = 'descobrir-item';

  // Capa real quando existe. Sem capa, o mesmo quadradinho com 🎵 que o
  // resto do projeto já usa (minhas-musicas.js / biblioteca.js) — não há
  // imagem de placeholder genérica no repositório para apontar.
  if (musica.url_capa) {
    const capa = document.createElement('img');
    capa.className = 'descobrir-capa';
    capa.src = musica.url_capa;
    capa.alt = `Capa de ${musica.titulo || ''}`.trim();
    capa.loading = 'lazy';
    item.appendChild(capa);
  } else {
    const capaVazia = document.createElement('span');
    capaVazia.className = 'descobrir-capa descobrir-capa-vazia';
    capaVazia.textContent = '🎵';
    item.appendChild(capaVazia);
  }

  const info = document.createElement('div');
  info.className = 'descobrir-info';

  const titulo = document.createElement('span');
  titulo.className = 'descobrir-titulo';
  titulo.textContent = musica.titulo || 'Música sem título';

  const artista = document.createElement('span');
  artista.className = 'descobrir-artista';
  artista.textContent = musica.artista || 'Artista desconhecido';

  info.append(titulo, artista);

  const duracao = document.createElement('span');
  duracao.className = 'descobrir-duracao';
  duracao.textContent = '--:--';
  // Preenche depois, sem travar a lista inteira esperando cada áudio.
  obterDuracaoReal(musica.url_audio).then((segundos) => {
    duracao.textContent = formatarDuracao(segundos);
  });

  // Os mesmos três botões que o carrossel tem: favoritar, adicionar à
  // playlist e tocar depois.
  //
  // stopPropagation em TODOS os três é obrigatório, e não um detalhe: o
  // item inteiro é clicável e chama tocarMusica. Sem isso, favoritar uma
  // música também tocaria ela.
  const botoes = document.createElement('div');
  botoes.className = 'descobrir-botoes';

  const btnFavoritar = criarBotaoIcone('btn-favoritar-descobrir', '♡', 'Favoritar');
  btnFavoritar.dataset.musicaId = musica.id;
  btnFavoritar.dataset.favoritavel = 'sim';
  pintarCoracao(btnFavoritar, idsFavoritos.has(Number(musica.id)));
  btnFavoritar.addEventListener('click', (evento) => {
    evento.stopPropagation();
    alternarFavorito(musica);
  });

  const btnAddPlaylist = criarBotaoIcone('btn-playlist-descobrir', '＋', 'Adicionar à playlist');
  btnAddPlaylist.addEventListener('click', (evento) => {
    evento.stopPropagation();
    abrirModalAddPlaylist(musica);
  });

  const btnFila = criarBotaoIcone('btn-fila-descobrir', '⇥', 'Tocar depois');
  btnFila.addEventListener('click', (evento) => {
    evento.stopPropagation();
    if (!estaLogado()) {
      alert('Faça login para usar a fila.');
      if (modalLogin) modalLogin.classList.remove('hidden');
      return;
    }
    adicionarAFila(musica);
  });

  botoes.append(btnFavoritar, btnAddPlaylist, btnFila);

  // A ordem desta linha é a ordem das colunas do grid: capa, texto,
  // botões, duração. Os botões vêm antes da duração porque é essa a
  // ordem em que as coisas fazem sentido — primeiro o que se faz com a
  // música, depois quanto tempo ela dura.
  item.append(info, botoes, duracao);

  // Tocar pelo player global: mesma função e mesma guarda de login que o
  // carrossel usa. O botão que receive o rótulo é o da barra do player,
  // então aqui não há segundo estado de áudio.
  item.addEventListener('click', () => {
    if (!estaLogado()) {
      alert('Faça login para tocar as músicas.');
      if (modalLogin) modalLogin.classList.remove('hidden');
      return;
    }
    tocarMusica(musica);
  });

  return item;
}

async function carregarDescobrirMusicas() {
  if (!listaDescobrir) return;

  try {
    const resposta = await fetch('https://open-sound.onrender.com/api/musicas');
    if (!resposta.ok) throw new Error('Falha ao buscar músicas.');
    const { musicas } = await resposta.json();

    if (!musicas || musicas.length === 0) {
      mostrarMensagemDescobrir('Não há músicas disponíveis no momento.', 'vazio');
      return;
    }

    listaDescobrir.innerHTML = '';
    listaDescobrir.dataset.estado = 'pronto';
    musicas.forEach((musica) => {
      listaDescobrir.appendChild(criarItemDescobrir(musica));
    });

  } catch (erro) {
    console.error('Erro ao carregar as músicas:', erro);
    mostrarMensagemDescobrir('Não foi possível carregar as músicas.', 'erro');
  }
}

// "inicio" limpa a busca e volta pro estado inicial da home, que agora é o
// ranking de mais tocadas (com queda pro catálogo geral se ainda não houver
// reproduções — o mesmo fallback de quando a home abre).
const btnInicio = document.getElementById('btn-inicio');
if (btnInicio) {
  btnInicio.addEventListener('click', () => {
    if (campoBusca) campoBusca.value = '';

    // O dropdown some e a busca volta ao estado inicial: só "Buscas
    // recentes". O histórico do localStorage continua de pé — ele pertence
    // ao navegador, não à tela.
    clearTimeout(timerBusca);
    fecharDropdown();

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
    const resposta = await fetchComAutenticacao('https://open-sound.onrender.com/api/usuarios/eu');
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
      const resposta = await fetchComAutenticacao('https://open-sound.onrender.com/api/usuarios/artista', {
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

// Nome do arquivo escolhido escrito dentro do cartão do botão, pra quem
// está vendo o modal saber o que já escolheu sem precisar olhar o
// preview da esquerda.
const nomeArquivoAudio = document.getElementById('upload-audio-nome');
const nomeArquivoCapa = document.getElementById('upload-capa-nome');

const ROTULO_AUDIO_PADRAO = 'MP3, WAV ou OGG';
const ROTULO_CAPA_PADRAO = 'Opcional · JPG, PNG ou WEBP';

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
  if (nomeArquivoAudio) nomeArquivoAudio.textContent = ROTULO_AUDIO_PADRAO;
  if (nomeArquivoCapa) nomeArquivoCapa.textContent = ROTULO_CAPA_PADRAO;
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
    if (nomeArquivoAudio) nomeArquivoAudio.textContent = arquivo ? arquivo.name : ROTULO_AUDIO_PADRAO;
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
      if (nomeArquivoCapa) nomeArquivoCapa.textContent = arquivo.name;
    } else {
      previewCapa.src = '';
      previewCapa.classList.add('hidden');
      previewCapaVazio.classList.remove('hidden');
      if (nomeArquivoCapa) nomeArquivoCapa.textContent = ROTULO_CAPA_PADRAO;
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
      const resposta = await fetchComAutenticacao('https://open-sound.onrender.com/api/musicas', {
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