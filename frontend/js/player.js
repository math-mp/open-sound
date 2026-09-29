// ================================================================
// PLAYER UNIVERSAL + FILA — toca em todas as páginas, retoma após navegar
// ================================================================
// Este arquivo precisa ser carregado ANTES do script de cada página
// (home.js, biblioteca.js, playlist.js, minhas-musicas.js, config.js) —
// ele define elementoAudio, tocarMusica() e os elementos da barra, que as
// páginas usam. As páginas continuam definindo CHAVE_SESSAO,
// fetchComAutenticacao() e estaLogado() cada uma a sua vez (igual já
// faziam) — este arquivo só CHAMA essas funções dentro de listeners que só
// disparam bem depois do carregamento, então elas já existem nesse ponto.
//
// A BARRA fica em todas as páginas. A LISTA da fila só é desenhada na home
// (o painel #player-fila existe lá, e só lá). Mesmo escondida, a fila continua
// sendo executa: ela vive no estado do player, não no DOM.
const CHAVE_PLAYER = 'playerOpenSound';
const CHAVE_FILA = 'playerFilaOpenSound';
const API_PLAYER = 'http://localhost:3000/api/player';

const playerBarra = document.getElementById('player-barra');
const playerCapa = document.getElementById('player-capa');
const playerTitulo = document.getElementById('player-titulo');
const playerArtista = document.getElementById('player-artista');
const playerPlayPause = document.getElementById('player-play-pause');
const playerProxima = document.getElementById('player-proxima');
const playerTempoAtual = document.getElementById('player-tempo-atual');
const playerTempoTotal = document.getElementById('player-tempo-total');
const playerSeek = document.getElementById('player-seek');
const playerVolumeBtn = document.getElementById('player-volume-btn');
const playerVolume = document.getElementById('player-volume');
const playerFilaBtn = document.getElementById('player-fila-btn');

// Painel da fila: SÓ existe na home. Nas outras páginas fica null e a fila
// simplesmente continua tocando sem ser desenhada.
const playerFilaPainel = document.getElementById('player-fila-painel');
const playerFilaLista = document.getElementById('player-fila-lista');
const playerFilaVazia = document.getElementById('player-fila-vazia');
const playerFilaContagem = document.getElementById('player-fila-contagem');
const playerFilaLimpar = document.getElementById('player-fila-limpar');
const playerFilaFechar = document.getElementById('player-fila-fechar');

const elementoAudio = new Audio();
let botaoAudioAtual = null;
let arrastandoSeek = false;
let volumeAntesMuto = 1;
let musicaNoPlayer = null;
let reproducaoJaContada = false;

// Fila de reprodução: array de músicas (objetos inteiros, na ordem em que
// vão tocar). Fica em memória e espelhada no localStorage + backend.
let fila = [];
let sincronizandoFila = false;

function formatarTempo(segundosTotais) {
  if (!isFinite(segundosTotais) || segundosTotais < 0) return '0:00';
  const minutos = Math.floor(segundosTotais / 60);
  const segundos = Math.floor(segundosTotais % 60).toString().padStart(2, '0');
  return `${minutos}:${segundos}`;
}

// === PERSISTÊNCIA LOCAL (render instantâneo, sem esperar a API) ===
function salvarEstadoPlayer() {
  if (!musicaNoPlayer) {
    localStorage.removeItem(CHAVE_PLAYER);
    return;
  }
  localStorage.setItem(CHAVE_PLAYER, JSON.stringify({
    musica: musicaNoPlayer,
    tempo: elementoAudio.currentTime,
    tocando: !elementoAudio.paused,
    volume: elementoAudio.volume,
    muted: elementoAudio.muted
  }));
}

function salvarFilaLocal() {
  try {
    localStorage.setItem(CHAVE_FILA, JSON.stringify(fila));
  } catch (erro) {
    // Cota estourada não pode derrubar o player: a fila segue em memória.
    console.warn('Não foi possível salvar a fila no localStorage:', erro);
  }
}

function lerFilaLocal() {
  try {
    const bruto = localStorage.getItem(CHAVE_FILA);
    if (!bruto) return [];
    const dados = JSON.parse(bruto);
    return Array.isArray(dados) ? dados.filter((m) => m && m.id && m.url_audio) : [];
  } catch {
    localStorage.removeItem(CHAVE_FILA);
    return [];
  }
}

// pagehide/beforeunload cobrem a saída "normal" da página; salvar de novo
// a cada timeupdate (dispara várias vezes por segundo) é rede de segurança
// pros casos em que nenhum dos dois eventos dispara a tempo (comum em
// navegadores mobile, por causa do bfcache).
window.addEventListener('pagehide', salvarEstadoPlayer);
window.addEventListener('beforeunload', salvarEstadoPlayer);

// === SINCRONIZAÇÃO COM O BACKEND ===
// Só faz sentido logado: usuário anônimo tem a fila só no navegador.
function temSessaoNoBackend() {
  return typeof estaLogado === 'function' && estaLogado();
}

async function chamarBackend(caminho, opcoes = {}) {
  if (typeof fetchComAutenticacao !== 'function') return null;
  try {
    const resposta = await fetchComAutenticacao(`${API_PLAYER}${caminho}`, opcoes);
    if (resposta.status === 204) return null;
    if (!resposta.ok) return null;
    return await resposta.json();
  } catch (erro) {
    console.warn('Falha ao sincronizar o player com o backend:', erro);
    return null;
  }
}

// Sobe o estado de reprodução (música + tempo + play/pause). Fila NÃO vai
// aqui: ela tem endpoint próprio, porque muda por operação do usuário.
let ultimoEstadoEnviado = null;
function sincronizarEstado() {
  if (!temSessaoNoBackend() || !musicaNoPlayer) return;

  const estado = {
    current_track_id: musicaNoPlayer.id,
    progress_ms: Math.round(elementoAudio.currentTime * 1000),
    is_playing: !elementoAudio.paused
  };

  // timeupdate dispara várias vezes por segundo; só grava quando muda de
  // verdade, senão vira uma enxurrada de PUT.
  const chave = JSON.stringify(estado);
  if (chave === ultimoEstadoEnviado) return;
  ultimoEstadoEnviado = chave;

  chamarBackend('/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(estado)
  });
}

// Grava a fila inteira no backend (PATCH de reordenação). Chamar depois de
// qualquer operação local: adicionar, remover, reordenar ou limpar.
function sincronizarFila() {
  if (!temSessaoNoBackend()) return;
  sincronizandoFila = true;
  chamarBackend('/queue/reorder', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queue: fila.map((m) => m.id) })
  }).then((dados) => {
    // O banco pode ter menos músicas (alguma foi apagada): adota a versão dele.
    if (dados && Array.isArray(dados.faixas)) {
      fila = dados.faixas;
      salvarFilaLocal();
      desenharFila();
    }
  }).finally(() => { sincronizandoFila = false; });
}

// Avisa quem quiser reagir à fila (o painel da home escuta isso).
function avisarFilaMudou() {
  document.dispatchEvent(new CustomEvent('player:fila-mudou', { detail: { fila } }));
}

// Envia o play pro backend (contagem de reproduções). Só chamada pelo
// evento 'play' de verdade — nunca no clique, nunca se o play falhar.
async function registrarReproducao(musica) {
  if (!musica || !musica.id) return;
  if (!temSessaoNoBackend()) return;

  try {
    const resposta = await fetchComAutenticacao(`http://localhost:3000/api/musicas/${musica.id}/reproduzir`, {
      method: 'POST'
    });
    if (!resposta.ok) {
      console.error('Falha ao registrar reprodução, status:', resposta.status);
    }
  } catch (erro) {
    console.error('Erro ao registrar reprodução:', erro);
  }
}

// === BARRA ===
function mostrarBarra() {
  if (playerBarra) playerBarra.classList.remove('hidden');
}

// Regra de encerramento: sem música tocando e sem fila, a barra some da tela.
function esconderBarraSeParada() {
  if (musicaNoPlayer || fila.length > 0) return;
  if (playerBarra) playerBarra.classList.add('hidden');
}

function atualizarBarraComMusicaAtual() {
  if (!musicaNoPlayer) return;
  if (playerCapa) playerCapa.src = musicaNoPlayer.url_capa || '';
  if (playerTitulo) playerTitulo.textContent = musicaNoPlayer.titulo;
  if (playerArtista) playerArtista.textContent = musicaNoPlayer.artista;
  mostrarBarra();
  atualizarContadorFila();
  // Só existe no home.js (pinta o coração dos cards) — nas outras páginas
  // esse guard evita um ReferenceError.
  if (typeof atualizarTodosCoracoes === 'function') atualizarTodosCoracoes();
}

function atualizarContadorFila() {
  if (playerFilaContagem) {
    playerFilaContagem.textContent = fila.length > 0 ? `${fila.length} na fila` : 'Fila vazia';
  }
  if (playerFilaBtn) {
    playerFilaBtn.classList.toggle('hidden', !playerFilaPainel || fila.length === 0);
  }
}

// === FILA — desenha o painel (só existe na home) ===
function desenharFila() {
  atualizarContadorFila();
  avisarFilaMudou();
  if (!playerFilaLista) return;

  playerFilaLista.innerHTML = '';

  if (fila.length === 0) {
    if (playerFilaVazia) playerFilaVazia.classList.remove('hidden');
    return;
  }

  if (playerFilaVazia) playerFilaVazia.classList.add('hidden');

  fila.forEach((musica, indice) => {
    const item = document.createElement('li');
    item.className = 'player-fila-item';
    item.draggable = true;
    item.dataset.indice = String(indice);

    const posicao = document.createElement('span');
    posicao.className = 'player-fila-posicao';
    posicao.textContent = String(indice + 1);

    const capa = document.createElement('img');
    capa.className = 'player-fila-capa';
    capa.src = musica.url_capa || '';
    capa.alt = '';

    const texto = document.createElement('div');
    texto.className = 'player-fila-texto';
    const titulo = document.createElement('span');
    titulo.className = 'player-fila-titulo';
    titulo.textContent = musica.titulo;
    const artista = document.createElement('span');
    artista.className = 'player-fila-artista';
    artista.textContent = musica.artista;
    texto.append(titulo, artista);

    const remover = document.createElement('button');
    remover.type = 'button';
    remover.className = 'player-fila-remover';
    remover.textContent = '✕';
    remover.title = 'Remover da fila';
    remover.setAttribute('aria-label', `Remover ${musica.titulo} da fila`);
    remover.addEventListener('click', () => removerDaFila(musica.id));

    item.append(posicao, capa, texto, remover);
    playerFilaLista.appendChild(item);
  });
}

function abrirPainelFila() {
  if (!playerFilaPainel) return;
  playerFilaPainel.classList.remove('hidden');
  desenharFila();
}

function fecharPainelFila() {
  if (playerFilaPainel) playerFilaPainel.classList.add('hidden');
}

// === FILA — operações ===
// Adiciona ao final da fila. `irParaFila = true` já começa a tocar a música.
function adicionarAFila(musica, { irParaFila = false } = {}) {
  if (!musica || !musica.id || !musica.url_audio) return;

  // A música que já está tocando não entra na fila: ela É a atual.
  if (musicaNoPlayer && musicaNoPlayer.id === musica.id) {
    if (irParaFila) tocarMusica(musica, botaoAudioAtual);
    return;
  }

  const repetida = fila.some((m) => m.id === musica.id);
  if (!repetida) fila.push(musica);

  salvarFilaLocal();
  desenharFila();
  sincronizarFila();

  if (irParaFila) tocarMusica(musica, botaoAudioAtual);
  else mostrarBarra();
}

function removerDaFila(musicaId) {
  const antes = fila.length;
  fila = fila.filter((m) => m.id !== musicaId);
  if (fila.length === antes) return;

  salvarFilaLocal();
  desenharFila();
  sincronizarFila();
  esconderBarraSeParada();
}

function limparFila() {
  if (fila.length === 0) return;
  fila = [];
  salvarFilaLocal();
  desenharFila();
  sincronizarFila();
  fecharPainelFila();
  esconderBarraSeParada();
}

// Puxa a faixa `de` para a frente, trocando de lugar com `para`.
function moverNaFila(de, para) {
  if (de === para) return;
  if (de < 0 || de >= fila.length) return;
  if (para < 0 || para >= fila.length) return;

  const [item] = fila.splice(de, 1);
  fila.splice(para, 0, item);

  salvarFilaLocal();
  desenharFila();
  sincronizarFila();
}

// Avança para a próxima da fila. Devolve false quando não há nada sobrando —
// o Chamador usa isso para esconder o player.
function tocarProxima() {
  if (fila.length === 0) return false;
  const [proxima, ...resto] = fila;
  fila = resto;

  salvarFilaLocal();
  desenharFila();
  sincronizarFila();

  tocarMusica(proxima, botaoAudioAtual);
  return true;
}

// Puxa o estado salvo no backend (a página acabou de carregar). Só quando a
// fila local está vazia, pra não sobrescrever o que o usuário acabou de fazer.
async function sincronizarFilaDoBackend() {
  if (!temSessaoNoBackend()) return;

  const dados = await chamarBackend('/state');
  if (!dados || !dados.state) return;

  const estado = dados.state;
  const faixas = Array.isArray(estado.faixas) ? estado.faixas : [];

  if (fila.length === 0 && faixas.length > 0) {
    fila = faixas;
    salvarFilaLocal();
    desenharFila();
  }

  // Se a música que já está tocando é a mesma do servidor, sincroniza o
  // progresso pra não voltar pro começo depois do F5.
  if (musicaNoPlayer && estado.current_track && estado.current_track.id === musicaNoPlayer.id) {
    const segundos = (estado.progress_ms || 0) / 1000;
    const duracao = elementoAudio.duration;
    if (duracao && segundos > 0 && Math.abs(elementoAudio.currentTime - segundos) > 2) {
      elementoAudio.currentTime = Math.min(segundos, duracao - 1);
    }
  }
}

// === ARRASTAR PARA REORDENAR (painel da home) ===
let indiceArrastando = null;

function conectarArrastarFila() {
  if (!playerFilaLista) return;

  playerFilaLista.addEventListener('dragstart', (evento) => {
    const item = evento.target.closest('.player-fila-item');
    if (!item) return;
    indiceArrastando = Number(item.dataset.indice);
    item.classList.add('arrastando');
    evento.dataTransfer.effectAllowed = 'move';
  });

  playerFilaLista.addEventListener('dragover', (evento) => {
    if (indiceArrastando === null) return;
    evento.preventDefault();
    evento.dataTransfer.dropEffect = 'move';
  });

  playerFilaLista.addEventListener('drop', (evento) => {
    if (indiceArrastando === null) return;
    evento.preventDefault();

    const item = evento.target.closest('.player-fila-item');
    if (item) moverNaFila(indiceArrastando, Number(item.dataset.indice));
    indiceArrastando = null;
  });

  playerFilaLista.addEventListener('dragend', () => {
    indiceArrastando = null;
    playerFilaLista.querySelectorAll('.arrastando').forEach((el) => el.classList.remove('arrastando'));
  });
}

// === TOCAR ===
function tocarMusica(musica, botaoClicado) {
  if (!musica || !musica.url_audio) return;

  const mesmaMusica = musicaNoPlayer && musicaNoPlayer.id === musica.id && elementoAudio.src;
  const clicouNoMesmoBotao = botaoAudioAtual === botaoClicado;

  if (mesmaMusica && clicouNoMesmoBotao) {
    if (elementoAudio.paused) {
      elementoAudio.play();
    } else {
      elementoAudio.pause();
    }
    return;
  }

  if (botaoAudioAtual) botaoAudioAtual.textContent = '▶ Tocar';
  botaoAudioAtual = botaoClicado || null;

  musicaNoPlayer = musica;
  reproducaoJaContada = false;
  ultimoEstadoEnviado = null;

  elementoAudio.src = musica.url_audio;
  elementoAudio.play().catch((erro) => {
    console.error('Erro ao tocar áudio:', erro);
    alert('Não foi possível tocar esta música.');
  });

  atualizarBarraComMusicaAtual();
}

elementoAudio.addEventListener('play', () => {
  if (botaoAudioAtual) botaoAudioAtual.textContent = '⏸ Pausar';
  if (playerPlayPause) playerPlayPause.textContent = '⏸';
  salvarEstadoPlayer();
  sincronizarEstado();

  if (musicaNoPlayer && !reproducaoJaContada) {
    reproducaoJaContada = true;
    registrarReproducao(musicaNoPlayer);
  }
});

elementoAudio.addEventListener('pause', () => {
  if (botaoAudioAtual) botaoAudioAtual.textContent = '▶ Tocar';
  if (playerPlayPause) playerPlayPause.textContent = '▶';
  salvarEstadoPlayer();
  sincronizarEstado();
});

// Encerramento: não sobrou música nem fila. Limpa tudo e some com a barra.
function encerrarPlayer() {
  elementoAudio.removeAttribute('src');
  elementoAudio.load();
  musicaNoPlayer = null;
  localStorage.removeItem(CHAVE_PLAYER);
  ultimoEstadoEnviado = null;

  if (playerPlayPause) playerPlayPause.textContent = '▶';
  if (playerSeek) playerSeek.value = 0;
  if (playerTempoAtual) playerTempoAtual.textContent = '0:00';
  if (playerTempoTotal) playerTempoTotal.textContent = '0:00';

  chamarBackend('/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_track_id: null, progress_ms: 0, is_playing: false })
  });

  fecharPainelFila();
  esconderBarraSeParada();
  atualizarContadorFila();
  avisarFilaMudou();
}

// Pular música: toca a próxima da fila. Sem fila, é o mesmo fim de fila —
// a barra some (regra de encerramento).
function pularMusica() {
  if (!tocarProxima()) encerrarPlayer();
}

elementoAudio.addEventListener('ended', () => {
  if (botaoAudioAtual) botaoAudioAtual.textContent = '▶ Tocar';
  botaoAudioAtual = null;
  reproducaoJaContada = false;

  if (!tocarProxima()) encerrarPlayer();
});

elementoAudio.addEventListener('loadedmetadata', () => {
  if (playerSeek) playerSeek.max = elementoAudio.duration;
  if (playerTempoTotal) playerTempoTotal.textContent = formatarTempo(elementoAudio.duration);
});

elementoAudio.addEventListener('timeupdate', () => {
  if (!arrastandoSeek) {
    if (playerSeek) playerSeek.value = elementoAudio.currentTime;
    if (playerTempoAtual) playerTempoAtual.textContent = formatarTempo(elementoAudio.currentTime);
  }
  salvarEstadoPlayer();
  sincronizarEstado();
});

if (playerSeek) {
  playerSeek.addEventListener('input', () => {
    arrastandoSeek = true;
    if (playerTempoAtual) playerTempoAtual.textContent = formatarTempo(playerSeek.value);
  });

  playerSeek.addEventListener('change', () => {
    elementoAudio.currentTime = playerSeek.value;
    arrastandoSeek = false;
    salvarEstadoPlayer();
    sincronizarEstado();
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

if (playerProxima) {
  playerProxima.addEventListener('click', pularMusica);
}

// --- Controle de Volume ---
function atualizarIconeVolume() {
  if (!playerVolumeBtn || !elementoAudio) return;
  const vol = elementoAudio.volume;
  const muted = elementoAudio.muted;
  
  if (muted || vol === 0) {
    playerVolumeBtn.textContent = '🔇';
    playerVolumeBtn.setAttribute('aria-label', 'Volume mutado');
  } else if (vol < 0.3) {
    playerVolumeBtn.textContent = '🔈';
    playerVolumeBtn.setAttribute('aria-label', 'Volume baixo');
  } else if (vol < 0.7) {
    playerVolumeBtn.textContent = '🔉';
    playerVolumeBtn.setAttribute('aria-label', 'Volume médio');
  } else {
    playerVolumeBtn.textContent = '🔊';
    playerVolumeBtn.setAttribute('aria-label', 'Volume alto');
  }
}

if (playerVolume) {
  // Carrega volume salvo do localStorage
  const volumeSalvo = localStorage.getItem('opensound_volume');
  if (volumeSalvo !== null) {
    const vol = parseFloat(volumeSalvo);
    if (!isNaN(vol)) {
      elementoAudio.volume = vol;
      playerVolume.value = vol;
    }
  }
  atualizarIconeVolume();

  playerVolume.addEventListener('input', () => {
    elementoAudio.volume = playerVolume.value;
    elementoAudio.muted = false;
    localStorage.setItem('opensound_volume', elementoAudio.volume);
    atualizarIconeVolume();
  });

  playerVolume.addEventListener('change', () => {
    localStorage.setItem('opensound_volume', elementoAudio.volume);
  });
}

if (playerVolumeBtn) {
  playerVolumeBtn.addEventListener('click', () => {
    if (elementoAudio.muted) {
      // Desmutar - restaurar volume anterior
      elementoAudio.muted = false;
      elementoAudio.volume = volumeAntesMuto > 0 ? volumeAntesMuto : 1;
      playerVolume.value = elementoAudio.volume;
    } else {
      // Mutar - salvar volume atual e zerar
      volumeAntesMuto = elementoAudio.volume;
      elementoAudio.muted = true;
      playerVolume.value = 0;
    }
    localStorage.setItem('opensound_volume', elementoAudio.volume);
    atualizarIconeVolume();
  });
}

// Sincroniza o slider se o volume for alterado programaticamente
elementoAudio.addEventListener('volumechange', () => {
  if (playerVolume) playerVolume.value = elementoAudio.volume;
  atualizarIconeVolume();
});

// --- Controles do painel da fila (só existem na home) ---
if (playerFilaBtn) {
  playerFilaBtn.addEventListener('click', () => {
    if (playerFilaPainel.classList.contains('hidden')) abrirPainelFila();
    else fecharPainelFila();
  });
}

if (playerFilaFechar) {
  playerFilaFechar.addEventListener('click', fecharPainelFila);
}

if (playerFilaLimpar) {
  playerFilaLimpar.addEventListener('click', limparFila);
}

// === SINCRONIZAÇÃO ENTRE ABAS ===
// Outra aba do mesmo navegador mexeu na fila: adota o novo estado.
window.addEventListener('storage', (evento) => {
  if (evento.key !== CHAVE_FILA || sincronizandoFila) return;

  fila = lerFilaLocal();
  desenharFila();
  esconderBarraSeParada();
});

// === INICIALIZAÇÃO ===
fila = lerFilaLocal();

// === RETOMAR AO CARREGAR QUALQUER PÁGINA ===
(function retomarPlayerSalvo() {
  const bruto = localStorage.getItem(CHAVE_PLAYER);
  if (!bruto) {
    // Sem música salva, mas com fila guardada: mostra a barra pra dar pra
    // tocar a fila mesmo sem música atual.
    if (fila.length > 0) mostrarBarra();
    desenharFila();
    return;
  }

  let estado;
  try {
    estado = JSON.parse(bruto);
  } catch (erro) {
    localStorage.removeItem(CHAVE_PLAYER);
    return;
  }

  if (!estado || !estado.musica || !estado.musica.url_audio) {
    localStorage.removeItem(CHAVE_PLAYER);
    return;
  }

  musicaNoPlayer = estado.musica;
  reproducaoJaContada = true; // já foi contada na página anterior — não conta de novo aqui
  elementoAudio.src = estado.musica.url_audio;

  // currentTime só "gruda" depois que os metadados carregam — setar antes
  // disso é ignorado pelo navegador.
  elementoAudio.addEventListener('loadedmetadata', () => {
    elementoAudio.currentTime = estado.tempo || 0;

    // Restaurar volume e muted
    if (typeof estado.volume === 'number') {
      elementoAudio.volume = estado.volume;
      if (playerVolume) playerVolume.value = estado.volume;
    }
    if (estado.muted) {
      elementoAudio.muted = true;
      if (playerVolume) playerVolume.value = 0;
    }

    atualizarIconeVolume();

    if (estado.tocando) {
      elementoAudio.play().catch(() => {
        // Autoplay sem gesto do usuário pode ser bloqueado pelo navegador.
        // Nesse caso a barra fica pausada, mas já no segundo certo — o
        // usuário só precisa clicar em play uma vez.
      });
    }
  }, { once: true });

  atualizarBarraComMusicaAtual();
  desenharFila();
})();

// Conecta a página: painel da fila (só na home) e a volta do backend.
document.addEventListener('DOMContentLoaded', () => {
  conectarArrastarFila();
  desenharFila();
  sincronizarFilaDoBackend();
});
