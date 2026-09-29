// ============================================================
// PLAYER UNIVERSAL — toca em todas as páginas, retoma após navegar
// ============================================================
// Este arquivo precisa ser carregado ANTES do script de cada página
// (home.js, biblioteca.js, playlist.js, minhas-musicas.js, config.js) —
// ele define elementoAudio, tocarMusica() e os elementos da barra, que as
// páginas usam. As páginas continuam definindo CHAVE_SESSAO,
// fetchComAutenticacao() e estaLogado() cada uma a sua vez (igual já
// faziam) — este arquivo só CHAMA essas funções dentro de listeners que só
// disparam bem depois do carregamento, então elas já existem nesse ponto.

const CHAVE_PLAYER = 'playerOpenSound';

const playerBarra = document.getElementById('player-barra');
const playerCapa = document.getElementById('player-capa');
const playerTitulo = document.getElementById('player-titulo');
const playerArtista = document.getElementById('player-artista');
const playerPlayPause = document.getElementById('player-play-pause');
const playerTempoAtual = document.getElementById('player-tempo-atual');
const playerTempoTotal = document.getElementById('player-tempo-total');
const playerSeek = document.getElementById('player-seek');
const playerVolumeBtn = document.getElementById('player-volume-btn');
const playerVolume = document.getElementById('player-volume');

const elementoAudio = new Audio();
let botaoAudioAtual = null;
let arrastandoSeek = false;
let volumeAntesMudo = 1;
let musicaNoPlayer = null;
let reproducaoJaContada = false;

function formatarTempo(segundosTotais) {
  if (!isFinite(segundosTotais) || segundosTotais < 0) return '0:00';
  const minutos = Math.floor(segundosTotais / 60);
  const segundos = Math.floor(segundosTotais % 60).toString().padStart(2, '0');
  return `${minutos}:${segundos}`;
}

// === PERSISTÊNCIA: salva o que está tocando pra retomar na próxima página ===
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

// pagehide/beforeunload cobrem a saída "normal" da página; salvar de novo
// a cada timeupdate (dispara várias vezes por segundo) é rede de segurança
// pros casos em que nenhum dos dois eventos dispara a tempo (comum em
// navegadores mobile, por causa do bfcache).
window.addEventListener('pagehide', salvarEstadoPlayer);
window.addEventListener('beforeunload', salvarEstadoPlayer);

// Envia o play pro backend (contagem de reproduções). Só chamada pelo
// evento 'play' de verdade — nunca no clique, nunca se o play falhar.
async function registrarReproducao(musica) {
  if (!musica || !musica.id) return;
  if (typeof estaLogado !== 'function' || !estaLogado()) return;

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

function atualizarBarraComMusicaAtual() {
  if (!musicaNoPlayer) return;
  if (playerCapa) playerCapa.src = musicaNoPlayer.url_capa || '';
  if (playerTitulo) playerTitulo.textContent = musicaNoPlayer.titulo;
  if (playerArtista) playerArtista.textContent = musicaNoPlayer.artista;
  if (playerBarra) playerBarra.classList.remove('hidden');
  // Só existe no home.js (pinta o coração dos cards) — nas outras páginas
  // esse guard evita um ReferenceError.
  if (typeof atualizarTodosCoracoes === 'function') atualizarTodosCoracoes();
}

function tocarMusica(musica, botaoClicado) {
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

  if (musicaNoPlayer && !reproducaoJaContada) {
    reproducaoJaContada = true;
    registrarReproducao(musicaNoPlayer);
  }
});

elementoAudio.addEventListener('pause', () => {
  if (botaoAudioAtual) botaoAudioAtual.textContent = '▶ Tocar';
  if (playerPlayPause) playerPlayPause.textContent = '▶';
  salvarEstadoPlayer();
});

elementoAudio.addEventListener('ended', () => {
  if (botaoAudioAtual) botaoAudioAtual.textContent = '▶ Tocar';
  botaoAudioAtual = null;
  reproducaoJaContada = false;
  localStorage.removeItem(CHAVE_PLAYER);
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
      elementoAudio.volume = volumeAntesMudo > 0 ? volumeAntesMudo : 1;
      playerVolume.value = elementoAudio.volume;
    } else {
      // Mutar - salvar volume atual e zerar
      volumeAntesMudo = elementoAudio.volume;
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

// === RETOMAR AO CARREGAR QUALQUER PÁGINA ===
(function retomarPlayerSalvo() {
  const bruto = localStorage.getItem(CHAVE_PLAYER);
  if (!bruto) return;

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
})();