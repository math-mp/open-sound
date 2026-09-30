// ============================================================
// MINHAS MÚSICAS — biblioteca do usuário
//
// Mantém a mesma estrutura de dados, autenticação e exclusão que já
// existiam. A diferença é visual: em vez de uma grade solta, as músicas
// viram um carrossel horizontal dentro de um painel "aba/pasta" pastel,
// com 6 cards visíveis e navegação por setas.
// ============================================================

// === AUTENTICAÇÃO ===
// Duplicado de home.js/config.js de propósito — cada página HTML carrega
// seu próprio script, sem sistema de módulos.
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
    if (window.OS) OS.limparCache();
    alert('Sua sessão expirou. Faça login novamente.');
    window.location.href = 'home.html';
  }

  return resposta;
}

// GATE: exige login, igual à página de config.
if (!estaLogado()) {
  window.location.href = 'home.html';
}

// === ELEMENTOS DO DOM ===
const listaMinhasMusicas = document.getElementById('lista-minhas-musicas');
const setaEsquerda = document.getElementById('bib-seta-esq');
const setaDireita = document.getElementById('bib-seta-dir');
const caixaIndicadores = document.getElementById('bib-indicadores');

const COOLDOWN_EXCLUSAO_MS = 24 * 60 * 60 * 1000;

// Quantos cards cabem na tela antes de precisar da seta.
const MUSICAS_POR_PAGINA = 6;

// Gap + largura do card. Precisa bater com o CSS (.card-musica), porque é
// o passo de rolagem de "uma música por vez" pedido no carrossel.
const LARGURA_CARD = 170;
const GAP_CARD = 16;

// ============================================================
// ÍCONES (SVG inline)
// ============================================================

const ICONE_LIXEIRA = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3 6h18"></path>
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
    <path d="M10 11v6"></path>
    <path d="M14 11v6"></path>
  </svg>`;

const ICONE_PLAY = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 4l14 8-14 8z"></path>
  </svg>`;

const ICONE_PAUSE = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M7 4h4v16H7z"></path>
    <path d="M13 4h4v16h-4z"></path>
  </svg>`;

// ============================================================
// PLAYER
// O áudio, a barra fixa, o volume e a fila vivem no player universal
// (player.js, carregado antes deste arquivo) — esta página não cria
// nenhum elemento de áudio nem redeclara nada que ele já defina.
//
// O que fica aqui é só a repintagem dos botões "Tocar" dos cards: o
// player universal escreve texto puro (▶ Tocar) no botão ativo, e aqui o
// botão é ícone SVG + rótulo, então a repintagem é refeita logo depois.
// ============================================================

// O botão dono da música carregada ganha o ícone de pausa e a classe
// .tocando; os outros voltam a mostrar o play. Roda depois dos
// listeners do player.js porque o script é carregado antes.
function pintarBotoesTocar() {
  if (!listaMinhasMusicas) return;

  const tocando = botaoAudioAtual && !elementoAudio.paused;

  listaMinhasMusicas.querySelectorAll('.btn-tocar').forEach((botao) => {
    const ativo = botao === botaoAudioAtual && tocando;

    botao.classList.toggle('tocando', ativo);

    const icone = botao.querySelector('.btn-acao-icone');
    if (icone) icone.innerHTML = ativo ? ICONE_PAUSE : ICONE_PLAY;

    const rotulo = botao.querySelector('.btn-acao-rotulo');
    if (rotulo) rotulo.textContent = ativo ? 'Pausar' : 'Tocar';
  });
}

elementoAudio.addEventListener('play', pintarBotoesTocar);
elementoAudio.addEventListener('pause', pintarBotoesTocar);
elementoAudio.addEventListener('ended', pintarBotoesTocar);

// ============================================================
// CARROSSEL
// ============================================================

let musicasCarrossel = [];

// O passo de rolagem (card + gap) muda quando a tela cruza um breakpoint,
// então é medido uma vez e reaproveitado — inclusive durante o scroll, que
// dispara muitas vezes por segundo.
let passoCache = 0;

// Distância de rolagem de "uma música por vez" — o tamanho do card mais o
// gap entre ele e o próximo.
function passoDeRolagem() {
  const card = listaMinhasMusicas
    ? listaMinhasMusicas.querySelector('.card-musica')
    : null;

  if (!card) return passoCache || (LARGURA_CARD + GAP_CARD);

  // Nos breakpoints o CSS muda a largura do card, então medimos em vez de
  // confiar na constante.
  const largura = card.getBoundingClientRect().width;
  const gap = parseFloat(getComputedStyle(listaMinhasMusicas).columnGap) || GAP_CARD;

  passoCache = largura + gap;
  return passoCache;
}

function podeRolarParaEsquerda() {
  if (!listaMinhasMusicas) return false;
  return listaMinhasMusicas.scrollLeft > 1;
}

function podeRolarParaDireita() {
  if (!listaMinhasMusicas) return false;
  const faltam = listaMinhasMusicas.scrollWidth - listaMinhasMusicas.clientWidth - listaMinhasMusicas.scrollLeft;
  return faltam > 1;
}

function indiceDoCardVisivel() {
  if (!listaMinhasMusicas) return 0;
  const passo = passoDeRolagem();
  if (passo <= 0) return 0;
  return Math.round(listaMinhasMusicas.scrollLeft / passo);
}

function irParaCard(indice) {
  if (!listaMinhasMusicas) return;
  const passo = passoDeRolagem();
  const ultimo = musicasCarrossel.length - 1;
  const alvo = Math.min(Math.max(indice, 0), Math.max(ultimo, 0));

  listaMinhasMusicas.scrollTo({
    left: alvo * passo,
    behavior: 'smooth'
  });
}

// Desenha os números [1] [2] [3]... e marca a página visível.
// Só aparece quando existe mais de uma página (ou seja, mais de 6 músicas).
//
// Essa função roda a cada scroll, então os botões só são recriados quando a
// quantidade de páginas muda (carga inicial, exclusão). No resto do tempo
// apenas a classe .ativo é movida — recriar os botões a cada pixel rolado
// piscaria e derrubaria o hover.
let paginasMontadas = 0;

function renderIndicadores() {
  if (!caixaIndicadores) return;

  const total = musicasCarrossel.length;
  const paginas = Math.ceil(total / MUSICAS_POR_PAGINA);

  if (paginas < 2) {
    caixaIndicadores.innerHTML = '';
    caixaIndicadores.hidden = true;
    paginasMontadas = 0;
    return;
  }

  if (paginas !== paginasMontadas) {
    caixaIndicadores.innerHTML = '';

    for (let i = 0; i < paginas; i++) {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'carrossel-indicador';
      botao.textContent = String(i + 1);
      botao.setAttribute('aria-label', `Ir para as músicas ${i * MUSICAS_POR_PAGINA + 1}–${Math.min((i + 1) * MUSICAS_POR_PAGINA, total)}`);
      botao.addEventListener('click', () => irParaCard(i * MUSICAS_POR_PAGINA));
      caixaIndicadores.appendChild(botao);
    }

    caixaIndicadores.hidden = false;
    paginasMontadas = paginas;
  }

  const paginaAtual = Math.floor(indiceDoCardVisivel() / MUSICAS_POR_PAGINA);

  caixaIndicadores.querySelectorAll('.carrossel-indicador').forEach((botao, i) => {
    botao.classList.toggle('ativo', i === paginaAtual);
  });
}

function atualizarControleCarrossel() {
  if (setaEsquerda) setaEsquerda.disabled = !podeRolarParaEsquerda();
  if (setaDireita) setaDireita.disabled = !podeRolarParaDireita();
}

// O clique avança uma música por vez, mantendo o resto do carrossel à vista
// (diferente de trocar a página inteira de cards).
if (setaEsquerda) {
  setaEsquerda.addEventListener('click', () => {
    if (!podeRolarParaEsquerda()) return;
    irParaCard(indiceDoCardVisivel() - 1);
  });
}

if (setaDireita) {
  setaDireita.addEventListener('click', () => {
    if (!podeRolarParaDireita()) return;
    irParaCard(indiceDoCardVisivel() + 1);
  });
}

if (listaMinhasMusicas) {
  listaMinhasMusicas.addEventListener('scroll', () => {
    atualizarControleCarrossel();
    renderIndicadores();
  });

  // A contagem de cards por página depende da largura da janela.
  window.addEventListener('resize', atualizarControleCarrossel);
}

// ============================================================
// CARDS
// ============================================================

// Mesmo formato "Xh Ym" usado no config.js pro cooldown de senha.
function formatarTempoRestante(ms) {
  const totalMinutos = Math.ceil(ms / 60000);
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;
  return `${horas}h ${minutos}min`;
}

function criarIcone(svg) {
  const span = document.createElement('span');
  span.className = 'btn-acao-icone';
  span.innerHTML = svg;
  return span;
}

// O rótulo ("Tocar" / "Excluir") vai num span próprio pra poder ser
// escondido durante a requisição sem mexer na estrutura do botão.
function criarRotulo(texto) {
  const span = document.createElement('span');
  span.className = 'btn-acao-rotulo';
  span.textContent = texto;
  return span;
}

// Card da biblioteca: capa, título, artista e os dois botões (excluir/tocar).
function criarCardMinhaMusica(musica) {
  const card = document.createElement('div');
  card.className = 'card-musica';

  if (musica.url_capa) {
    const capa = document.createElement('img');
    capa.className = 'capa-musica';
    capa.src = musica.url_capa;
    capa.alt = `Capa de ${musica.titulo}`;
    card.appendChild(capa);
  } else {
    const capaVazia = document.createElement('div');
    capaVazia.className = 'capa-musica capa-vazia';
    capaVazia.textContent = '🎵';
    card.appendChild(capaVazia);
  }

  const info = document.createElement('div');
  info.className = 'info-musica';

  const titulo = document.createElement('p');
  titulo.className = 'titulo-musica';
  titulo.textContent = musica.titulo;
  titulo.title = musica.titulo;

  const artista = document.createElement('p');
  artista.className = 'artista-musica';
  artista.textContent = musica.artista;

  info.appendChild(titulo);
  info.appendChild(artista);
  card.appendChild(info);

  const acoes = document.createElement('div');
  acoes.className = 'card-acoes';

  const btnTocar = document.createElement('button');
  btnTocar.type = 'button';
  btnTocar.className = 'btn-acao btn-tocar';
  btnTocar.setAttribute('aria-label', `Tocar ${musica.titulo}`);
  btnTocar.title = 'Tocar';
  btnTocar.appendChild(criarIcone(ICONE_PLAY));
  btnTocar.appendChild(criarRotulo('Tocar'));

  btnTocar.addEventListener('click', () => {
    if (!estaLogado()) {
      alert('Faça login para tocar as músicas.');
      window.location.href = 'home.html';
      return;
    }
    tocarMusica(musica, btnTocar);
    pintarBotoesTocar();
  });

  const btnExcluir = document.createElement('button');
  btnExcluir.type = 'button';
  btnExcluir.className = 'btn-acao btn-excluir-musica btn-excluir';
  btnExcluir.setAttribute('aria-label', `Excluir ${musica.titulo}`);
  btnExcluir.title = 'Excluir';
  btnExcluir.appendChild(criarIcone(ICONE_LIXEIRA));
  btnExcluir.appendChild(criarRotulo('Excluir'));

  const mensagemCooldown = document.createElement('p');
  mensagemCooldown.className = 'mensagem-cooldown hidden';

  // Cooldown calculado a partir de criado_em (hora da postagem) — mesma
  // ideia do cooldown de senha, só que por música em vez de por conta.
  const tempoDesdePostagem = Date.now() - new Date(musica.criado_em).getTime();
  const restante = COOLDOWN_EXCLUSAO_MS - tempoDesdePostagem;

  if (restante > 0) {
    btnExcluir.disabled = true;
    mensagemCooldown.textContent = `Espere ${formatarTempoRestante(restante)} pra poder deletar a música.`;
    mensagemCooldown.classList.remove('hidden');
  }

  btnExcluir.addEventListener('click', async () => {
    const confirmou = confirm(`Excluir "${musica.titulo}" permanentemente?`);
    if (!confirmou) return;

    btnExcluir.disabled = true;
    btnExcluir.classList.add('excluindo');

    try {
      const resposta = await fetchComAutenticacao(`${API_URL}/api/musicas/${musica.id}`, {
        method: 'DELETE'
      });

      const dados = await resposta.json();

      if (resposta.ok) {
        musicasCarrossel = musicasCarrossel.filter((item) => item.id !== musica.id);
        card.remove();

        if (musicasCarrossel.length === 0) {
          // Sobrou nenhuma: re-renderiza a mensagem de "nenhuma música".
          carregarMinhasMusicas();
          return;
        }

        atualizarControleCarrossel();
        renderIndicadores();
      } else if (dados.codigo === 'COOLDOWN_EXCLUSAO_ATIVO') {
        mensagemCooldown.textContent = `Espere ${formatarTempoRestante(dados.restanteMs)} pra poder deletar a música.`;
        mensagemCooldown.classList.remove('hidden');
        alert(dados.mensagem);
      } else {
        alert(dados.mensagem || 'Não foi possível excluir a música.');
        btnExcluir.disabled = false;
        btnExcluir.classList.remove('excluindo');
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
      btnExcluir.disabled = false;
      btnExcluir.classList.remove('excluindo');
    }
  });

  acoes.appendChild(btnTocar);
  acoes.appendChild(btnExcluir);
  card.appendChild(acoes);
  card.appendChild(mensagemCooldown);

  return card;
}

function mostrarMensagemLista(texto) {
  if (!listaMinhasMusicas) return;

  listaMinhasMusicas.innerHTML = '';
  musicasCarrossel = [];

  const mensagem = document.createElement('p');
  mensagem.className = 'mensagem-lista';
  mensagem.textContent = texto;
  listaMinhasMusicas.appendChild(mensagem);

  if (caixaIndicadores) caixaIndicadores.hidden = true;
  atualizarControleCarrossel();
}

async function carregarMinhasMusicas() {
  if (!listaMinhasMusicas) return;

  try {
    const resposta = await fetchComAutenticacao(API_URL + '/api/musicas/minhas');
    const dados = await resposta.json();

    if (!resposta.ok) {
      mostrarMensagemLista(dados.mensagem || 'Não foi possível carregar suas músicas.');
      return;
    }

    if (!dados.musicas || dados.musicas.length === 0) {
      mostrarMensagemLista('Você ainda não enviou nenhuma música.');
      return;
    }

    musicasCarrossel = dados.musicas;
    listaMinhasMusicas.innerHTML = '';

    musicasCarrossel.forEach((musica) => {
      listaMinhasMusicas.appendChild(criarCardMinhaMusica(musica));
    });

    // Volta pro começo toda vez que a lista é (re)carregada.
    listaMinhasMusicas.scrollLeft = 0;
    atualizarControleCarrossel();
    renderIndicadores();

  } catch (erro) {
    console.error('Erro ao carregar minhas músicas:', erro);
    mostrarMensagemLista('Erro de conexão ao carregar suas músicas.');
  }
}

carregarMinhasMusicas();
