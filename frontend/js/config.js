// === AUTENTICAÇÃO ===
// Duplicado de home.js de propósito: esta é uma página HTML separada
// (sem sistema de módulos), então cada página carrega seu próprio script.
// Mantenha esse bloco em sincronia se mudar a lógica de sessão em home.js.
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
    alert('Sua sessão expirou. Faça login novamente.');
    window.location.href = 'home.html';
  }

  return resposta;
}

// GATE: a página inteira exige login. Sem token, nem carrega o resto —
// redireciona na hora, antes de qualquer dado sensível ser buscado.
if (!estaLogado()) {
  window.location.href = 'home.html';
}

// === ELEMENTOS DO DOM ===
const formSenhaEtapa1 = document.getElementById('form-senha-etapa1');
const etapaSenha1 = document.getElementById('etapa-senha-1');
const etapaSenha2 = document.getElementById('etapa-senha-2');
const campoNovaSenha = document.getElementById('nova-senha');
const btnSolicitarCodigo = document.getElementById('btn-solicitar-codigo');
const mensagemCooldown = document.getElementById('mensagem-cooldown');

const campoCodigoRedefinicao = document.getElementById('codigo-redefinicao');
const btnConfirmarRedefinicao = document.getElementById('btn-confirmar-redefinicao');

const textoFraseEsperada = document.getElementById('texto-frase-esperada');
const campoFraseConfirmacao = document.getElementById('frase-confirmacao');
const btnDeletarConta = document.getElementById('btn-deletar-conta');

const regexSenha = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@()!%*?&#])[A-Za-z\d@()!%*?&#]{8,}$/;

let idRedefinicaoAtual = '';
let identificadorContaAtual = ''; // nome de usuário, ou e-mail se não tiver

// === FORMATA "Xh Ym" A PARTIR DE MILISSEGUNDOS ===
function formatarTempoRestante(ms) {
  const totalMinutos = Math.ceil(ms / 60000);
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;
  return `${horas}h ${minutos}min`;
}

// === CARREGA OS DADOS DA CONTA (cooldown + identificador pra frase) ===
async function carregarDadosConta() {
  try {
    const resposta = await fetchComAutenticacao('http://localhost:3000/api/usuarios/eu');
    const dados = await resposta.json();

    if (!resposta.ok) {
      alert(dados.mensagem || 'Não foi possível carregar sua conta.');
      return;
    }

    const usuario = dados.usuario;
    identificadorContaAtual = usuario.nome_usuario || usuario.email;

    if (textoFraseEsperada) {
      textoFraseEsperada.textContent = `eu desejo deletar ${identificadorContaAtual}`;
    }

    aplicarEstadoCooldown(usuario.senha_redefinida_em);

  } catch (erro) {
    console.error('Erro ao carregar dados da conta:', erro);
    alert('Erro de conexão com o servidor.');
  }
}

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Desabilita o botão de redefinir senha e mostra a mensagem de espera.
// Aceita OU o timestamp do último reset (calcula o restante), OU o valor
// de milissegundos restantes já pronto (quando o servidor já mandou isso).
function aplicarEstadoCooldown(senhaRedefinidaEm, restanteMsForcado) {
  let restante;

  if (typeof restanteMsForcado === 'number') {
    restante = restanteMsForcado;
  } else {
    if (!senhaRedefinidaEm) return; // nunca resetou — sem cooldown
    const tempoDesdeReset = Date.now() - new Date(senhaRedefinidaEm).getTime();
    restante = COOLDOWN_MS - tempoDesdeReset;
  }

  if (restante <= 0) return; // cooldown já passou

  if (btnSolicitarCodigo) {
    btnSolicitarCodigo.disabled = true;
    btnSolicitarCodigo.classList.add('botao-desabilitado');
  }
  if (mensagemCooldown) {
    mensagemCooldown.textContent = `Espere ${formatarTempoRestante(restante)} pra resetar sua senha novamente.`;
    mensagemCooldown.classList.remove('hidden');
  }
}

carregarDadosConta();

// === ETAPA 1: solicitar código de redefinição ===
if (formSenhaEtapa1) {
  formSenhaEtapa1.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (btnSolicitarCodigo && btnSolicitarCodigo.disabled) return;

    const novaSenha = campoNovaSenha ? campoNovaSenha.value.trim() : '';

    if (!regexSenha.test(novaSenha)) {
      alert('A senha precisa ter no mínimo 8 caracteres, com pelo menos uma letra maiúscula, uma minúscula, um número e um símbolo especial (@$!%*?&#).');
      return;
    }

    if (btnSolicitarCodigo) {
      btnSolicitarCodigo.disabled = true;
      btnSolicitarCodigo.textContent = 'Enviando...';
    }

    try {
      const resposta = await fetchComAutenticacao('http://localhost:3000/api/usuarios/redefinir-senha/solicitar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novaSenha })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        idRedefinicaoAtual = dados.idRedefinicao;
        if (etapaSenha1) etapaSenha1.classList.add('hidden');
        if (etapaSenha2) etapaSenha2.classList.remove('hidden');
      } else if (dados.codigo === 'COOLDOWN_REDEFINICAO_ATIVO') {
        aplicarEstadoCooldown(null, dados.restanteMs);
        alert(dados.mensagem);
      } else {
        alert(dados.mensagem || 'Não foi possível solicitar a redefinição.');
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
    } finally {
      if (btnSolicitarCodigo && !btnSolicitarCodigo.classList.contains('botao-desabilitado')) {
        btnSolicitarCodigo.disabled = false;
        btnSolicitarCodigo.textContent = 'Enviar código de verificação';
      }
    }
  });
}

// === ETAPA 2: confirmar código e efetivar a troca ===
if (btnConfirmarRedefinicao) {
  btnConfirmarRedefinicao.addEventListener('click', async () => {
    const codigo = campoCodigoRedefinicao ? campoCodigoRedefinicao.value.trim() : '';

    if (codigo.length !== 6) {
      alert('Digite os 6 dígitos do código.');
      return;
    }

    try {
      const resposta = await fetchComAutenticacao('http://localhost:3000/api/usuarios/redefinir-senha/confirmar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, idRedefinicao: idRedefinicaoAtual })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        alert('Senha redefinida com sucesso!');
        if (etapaSenha2) etapaSenha2.classList.add('hidden');
        if (etapaSenha1) etapaSenha1.classList.remove('hidden');
        if (campoNovaSenha) campoNovaSenha.value = '';
        if (campoCodigoRedefinicao) campoCodigoRedefinicao.value = '';
        aplicarEstadoCooldown(new Date().toISOString()); // acabou de resetar agora
      } else {
        alert(dados.mensagem || 'Código incorreto ou expirado.');
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Não foi possível conectar ao servidor.');
    }
  });
}

// === DELETAR CONTA ===
if (btnDeletarConta) {
  btnDeletarConta.addEventListener('click', async () => {
    const frase = campoFraseConfirmacao ? campoFraseConfirmacao.value.trim() : '';
    const fraseEsperada = `eu desejo deletar ${identificadorContaAtual}`;

    if (frase.toLowerCase() !== fraseEsperada.toLowerCase()) {
      alert(`Frase incorreta. Digite exatamente: "${fraseEsperada}"`);
      return;
    }

    // Segunda confirmação, além da frase — ação irreversível, sem volta.
    const confirmou = confirm('Isso vai apagar sua conta e todas as suas músicas PERMANENTEMENTE. Tem certeza?');
    if (!confirmou) return;

    btnDeletarConta.disabled = true;
    btnDeletarConta.textContent = 'Excluindo...';

    try {
      const resposta = await fetchComAutenticacao('http://localhost:3000/api/usuarios/eu', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fraseConfirmacao: frase })
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        alert('Conta excluída com sucesso.');
        localStorage.removeItem(CHAVE_SESSAO);
        window.location.href = 'home.html';
      } else {
        alert(dados.mensagem || 'Não foi possível excluir a conta.');
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
    } finally {
      btnDeletarConta.disabled = false;
      btnDeletarConta.textContent = 'Deletar conta permanentemente';
    }
  });
}