const CHAVE_SESSAO = 'tokenSessao';
function obterTokenSessao() { return localStorage.getItem(CHAVE_SESSAO); }
function estaLogado() { return !!obterTokenSessao(); }

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

if (!estaLogado()) {
  window.location.href = 'home.html';
}

const parametros = new URLSearchParams(window.location.search);
const idPlaylist = parametros.get('id');

const tituloNavbarPlaylist = document.getElementById('titulo-playlist');
const tituloSecaoPlaylist = document.getElementById('titulo-secao-playlist');
const gradeMusicasPlaylist = document.getElementById('grade-musicas-playlist');
const btnExcluirPlaylist = document.getElementById('btn-excluir-playlist');
const btnTocarPlaylist = document.getElementById('btn-tocar-playlist');

const formBuscaPlaylist = document.getElementById('form-busca-playlist');
const campoBuscaPlaylist = document.getElementById('campo-busca-playlist');
const btnBuscaPlaylist = document.getElementById('btn-busca-playlist');
const resultadosBuscaPlaylist = document.getElementById('resultados-busca-playlist');

let playlistAtual = null;

// Músicas já carregadas desta playlist. O botão de tocar usa essa cópia em
// memória — não precisa pedir o mesmo endpoint de novo a cada clique.
let musicasDaPlaylist = [];
// Ids já presentes na playlist, pra marcar "Já está aqui" nos resultados da
// busca sem consultar o servidor de novo.
let idsDaPlaylist = new Set();

// Último resultado desenhado. Guardado pra poder recolocar o botão "Já está
// aqui" sem refazer a consulta quando a lista da playlist muda.
let resultadosDaBusca = [];
let buscaEmCurso = false;
let temporizadorBusca = null;

// ============================================================
// ÍCONES (SVG inline)
// ============================================================
// Os mesmos SVGs de minhas-musicas.js, copiados em vez de compartilhados: as
// páginas são scripts soltos, sem módulos, e cada uma carrega o seu player.
// Repetir duas constantes é mais barato que um arquivo a mais na pasta js/
// só por causa disso.
//
// O botão de fila NÃO entra aqui: ele nasce de criarBotaoIcone() (favoritos.js)
// com o glifo "⇥", exatamente como o "Tocar depois" da home.

const ICONE_PLAY = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 4l14 8-14 8z"></path>
  </svg>`;

const ICONE_PAUSE = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M7 4h4v16H7z"></path>
    <path d="M13 4h4v16h-4z"></path>
  </svg>`;

// O botão dono da música carregada ganha o ícone de pausa e a classe
// .tocando; os outros voltam a mostrar o play. Roda depois dos listeners
// do player.js porque o script é carregado antes.
function pintarBotoesTocarPlaylist() {
  if (!gradeMusicasPlaylist) return;

  const tocando = botaoAudioAtual && !elementoAudio.paused;
  const idNoPlayer = musicaNoPlayer ? Number(musicaNoPlayer.id) : null;

  gradeMusicasPlaylist.querySelectorAll('.btn-tocar').forEach((botao) => {
    // Duas formas de ser o botão ativo: ser o botaoAudioAtual (o clique veio
    // daqui) OU carregar a música que está tocando. A segunda cobre o "Tocar
    // playlist", que chama tocarListaDeMusicas com botão null — sem ela, o
    // card da primeira música ficaria mostrando play durante a reprodução.
    const ativo = tocando && (botao === botaoAudioAtual
      || (idNoPlayer !== null && Number(botao.dataset.musicaId) === idNoPlayer));

    botao.classList.toggle('tocando', ativo);

    const icone = botao.querySelector('.btn-acao-icone');
    if (icone) icone.innerHTML = ativo ? ICONE_PAUSE : ICONE_PLAY;

    const rotulo = botao.querySelector('.btn-acao-rotulo');
    if (rotulo) rotulo.textContent = ativo ? 'Pausar' : 'Tocar';
  });
}

elementoAudio.addEventListener('play', pintarBotoesTocarPlaylist);
elementoAudio.addEventListener('pause', pintarBotoesTocarPlaylist);
elementoAudio.addEventListener('ended', pintarBotoesTocarPlaylist);

function criarIcone(svg) {
  const span = document.createElement('span');
  span.className = 'btn-acao-icone';
  span.innerHTML = svg;
  return span;
}

// O rótulo vai num span próprio porque o texto muda: o de remover vira
// "Removendo..." durante a requisição, e o de tocar vira "Pausar". Escrever
// no textContent do botão apagaria o ícone que está junto.
function criarRotulo(texto) {
  const span = document.createElement('span');
  span.className = 'btn-acao-rotulo';
  span.textContent = texto;
  return span;
}

// Tocar pelo detalhe da playlist e tocar pelo card da biblioteca são a mesma
// coisa: a fila é substituída pela lista e a primeira começa a tocar.
function tocarPlaylistAtual() {
  if (!musicasDaPlaylist.length) {
    alert('Esta playlist ainda não tem músicas para tocar.');
    return;
  }
  tocarListaDeMusicas(musicasDaPlaylist);
  pintarBotoesTocarPlaylist();
}

function criarCardMusicaPlaylist(musica) {
  const card = document.createElement('div');
  card.className = 'card-musica';

  const capa = document.createElement('img');
  capa.className = 'capa-musica';
  capa.src = musica.url_capa || '';
  capa.alt = `Capa de ${musica.titulo}`;

  // A capa vai dentro de um wrapper só para servir de âncora do botão de
  // fila: é a mesma ideia do .msc-capa-wrapper da home, com a mesma
  // pegada de <img> quebrando a razão de aspecto se sair do fluxo.
  const capaWrapper = document.createElement('div');
  capaWrapper.className = 'card-capa';
  capaWrapper.appendChild(capa);

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

  // ---------- tocar e remover, na fileira de baixo ----------
  // Os dois dividem a largura. O de fila não mora aqui: ele fica sobre a
  // capa, no canto superior direito, e é um botão de ícone translúcido — o
  // mesmo formato dos botões que a home ancora sobre a capa dela.
  const acoes = document.createElement('div');
  acoes.className = 'card-acoes';

  const btnTocar = document.createElement('button');
  btnTocar.type = 'button';
  btnTocar.className = 'btn-acao btn-tocar';
  // O id vai no atributo (e não emclosure no handler) porque a repintagem
  // precisa achar de novo, a cada play/pause, qual botão pertence à música
  // que está tocando — inclusive quando o clique veio do "Tocar playlist".
  btnTocar.dataset.musicaId = String(musica.id);
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

    // Caso especial: este botão já é o dono da música tocando, mas o player
    // guardou outro botão (o "Tocar playlist" passa null). Se delegássemos ao
    // tocarMusica, ele veria "mesma música, botão diferente" e recomeçaria do
    // zero em vez de pausar — então o pause é chamado direto.
    if (btnTocar.classList.contains('tocando') && botaoAudioAtual !== btnTocar) {
      elementoAudio.pause();
      return;
    }

    tocarMusica(musica, btnTocar);
    pintarBotoesTocarPlaylist();
  });

  // Botão de ícone ancorado na capa. Nasce de criarBotaoIcone(), o mesmo
  // helper que a home usa para o "Tocar depois" (vive no favoritos.js, que
  // esta página também carrega), então o formato — círculo de 34px, com
  // title — é literalmente o mesmo das duas pontas. A classe extra só
  // ancora o botão no canto da capa; o fundo translúcido vem do CSS daqui,
  // com os mesmos valores de .msc-acoes-capa .btn-icone.
  const btnFila = criarBotaoIcone('card-fila-btn', '⇥', 'Adicionar à fila');
  // O aria-label do helper é genérico; aqui ele nomeia a música, como os
  // outros dois botões do card.
  btnFila.setAttribute('aria-label', `Adicionar ${musica.titulo} à fila`);

  btnFila.addEventListener('click', () => {
    if (!estaLogado()) {
      alert('Faça login para usar a fila.');
      window.location.href = 'home.html';
      return;
    }
    // irParaFila fica false de propósito: somar à fila não pode roubar a
    // música que está tocando. A confirmação é o próprio botão, que fica
    // marcado por um instante — nada de alert bloqueando a navegação.
    adicionarAFila(musica);
    btnFila.classList.add('na-fila');
    btnFila.disabled = true;
    setTimeout(() => {
      btnFila.classList.remove('na-fila');
      btnFila.disabled = false;
    }, 1200);
  });

  capaWrapper.appendChild(btnFila);

  // Sem .btn-excluir-musica de propósito: aquela classe traz uma margin
  // própria da página "Minhas Músicas", e aqui quem controla o espaço é o
  // padding do .card-acoes. A cor de erro vem do .btn-excluir.
  const btnRemover = document.createElement('button');
  btnRemover.type = 'button';
  btnRemover.className = 'btn-acao btn-excluir';
  btnRemover.setAttribute('aria-label', `Remover ${musica.titulo} da playlist`);
  btnRemover.title = 'Remover da playlist';
  // O texto do botão mora no span do rótulo, então é ele que muda durante a
  // requisição — escrever no textContent do botão apagaria o span.
  const rotuloRemover = criarRotulo('Remover');
  btnRemover.appendChild(rotuloRemover);

  btnRemover.addEventListener('click', async () => {
    const confirmou = confirm(`Remover "${musica.titulo}" desta playlist?`);
    if (!confirmou) return;

    btnRemover.disabled = true;
    rotuloRemover.textContent = 'Removendo...';

    try {
      const resposta = await fetchComAutenticacao(
        `https://open-sound.onrender.com/api/playlists/${idPlaylist}/musicas/${musica.id}`,
        { method: 'DELETE' }
      );
      const dados = await resposta.json();

      if (resposta.ok) {
        card.remove();
        musicasDaPlaylist = musicasDaPlaylist.filter((m) => m.id !== musica.id);
        idsDaPlaylist.delete(Number(musica.id));

        // Tocar a playlist sem a música removida.
        if (btnTocarPlaylist) {
          btnTocarPlaylist.classList.toggle('hidden', musicasDaPlaylist.length === 0);
        }
        marcarResultadosDaBusca();

        if (gradeMusicasPlaylist && !gradeMusicasPlaylist.querySelector('.card-musica')) {
          carregarPlaylist();
        }
      } else {
        alert(dados.mensagem || 'Não foi possível remover a música.');
        btnRemover.disabled = false;
        rotuloRemover.textContent = 'Remover';
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
      btnRemover.disabled = false;
      rotuloRemover.textContent = 'Remover';
    }
  });

  acoes.appendChild(btnTocar);
  acoes.appendChild(btnRemover);

  card.appendChild(capaWrapper);
  card.appendChild(info);
  card.appendChild(acoes);

  return card;
}

async function carregarPlaylist() {
  if (!idPlaylist) {
    if (gradeMusicasPlaylist) {
      gradeMusicasPlaylist.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'mensagem-lista';
      p.textContent = 'Playlist não especificada.';
      gradeMusicasPlaylist.appendChild(p);
    }
    return;
  }

  try {
    const resposta = await fetchComAutenticacao(`https://open-sound.onrender.com/api/playlists/${idPlaylist}`);
    const dados = await resposta.json();

    if (!resposta.ok) {
      if (gradeMusicasPlaylist) {
        gradeMusicasPlaylist.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'mensagem-lista';
        p.textContent = dados.mensagem || 'Não foi possível carregar a playlist.';
        gradeMusicasPlaylist.appendChild(p);
      }
      return;
    }

    playlistAtual = dados.playlist;
    musicasDaPlaylist = Array.isArray(dados.musicas) ? dados.musicas : [];
    idsDaPlaylist = new Set(musicasDaPlaylist.map((m) => Number(m.id)));

    if (tituloNavbarPlaylist) tituloNavbarPlaylist.textContent = playlistAtual.nome;
    if (tituloSecaoPlaylist) tituloSecaoPlaylist.textContent = playlistAtual.nome;

    // Favoritos não pode ser excluída — o servidor já bloqueia, mas o
    // botão nem aparece pra essa playlist específica.
    if (btnExcluirPlaylist) {
      btnExcluirPlaylist.classList.toggle('hidden', !!playlistAtual.eh_favoritos);
    }

    // Tocar só faz sentido com pelo menos uma música dentro.
    if (btnTocarPlaylist) {
      btnTocarPlaylist.classList.toggle('hidden', musicasDaPlaylist.length === 0);
    }

    // Uma música removida deixa de estar na playlist: o resultado da busca
    // que dependia desse estado precisa ser redesenhado.
    marcarResultadosDaBusca();

    if (!gradeMusicasPlaylist) return;
    gradeMusicasPlaylist.innerHTML = '';

    if (musicasDaPlaylist.length === 0) {
      const p = document.createElement('p');
      p.className = 'mensagem-lista';
      p.textContent = 'Nenhuma música nesta playlist ainda.';
      gradeMusicasPlaylist.appendChild(p);
      return;
    }

    musicasDaPlaylist.forEach((musica) => {
      gradeMusicasPlaylist.appendChild(criarCardMusicaPlaylist(musica));
    });

  } catch (erro) {
    console.error('Erro ao carregar playlist:', erro);
    if (gradeMusicasPlaylist) {
      gradeMusicasPlaylist.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'mensagem-lista';
      p.textContent = 'Erro de conexão ao carregar a playlist.';
      gradeMusicasPlaylist.appendChild(p);
    }
  }
}

carregarPlaylist();

if (btnTocarPlaylist) {
  btnTocarPlaylist.addEventListener('click', tocarPlaylistAtual);
}

if (btnExcluirPlaylist) {
  btnExcluirPlaylist.addEventListener('click', async () => {
    if (!playlistAtual) return;

    const confirmou = confirm(`Excluir a playlist "${playlistAtual.nome}" permanentemente? As músicas em si não são apagadas, só saem desta playlist.`);
    if (!confirmou) return;

    btnExcluirPlaylist.disabled = true;

    try {
      const resposta = await fetchComAutenticacao(`https://open-sound.onrender.com/api/playlists/${idPlaylist}`, {
        method: 'DELETE'
      });
      const dados = await resposta.json();

      if (resposta.ok) {
        window.location.href = 'biblioteca.html';
      } else {
        alert(dados.mensagem || 'Não foi possível excluir a playlist.');
        btnExcluirPlaylist.disabled = false;
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
      btnExcluirPlaylist.disabled = false;
    }
  });
}

// ============================================================
// BUSCA DE MÚSICAS PRA SOMAR NESTA PLAYLIST
// ============================================================

function mostrarMensagemBusca(texto) {
  if (!resultadosBuscaPlaylist) return;
  // A lista desenhada foi substituída por uma mensagem: guardar a antiga
  // faria `marcarResultadosDaBusca` resuscitar resultados obsoletos.
  resultadosDaBusca = [];
  resultadosBuscaPlaylist.classList.remove('hidden');
  resultadosBuscaPlaylist.innerHTML = '';

  const p = document.createElement('p');
  p.className = 'mensagem-lista';
  p.textContent = texto;
  resultadosBuscaPlaylist.appendChild(p);
}

function esconderResultadosBusca() {
  if (!resultadosBuscaPlaylist) return;
  resultadosDaBusca = [];
  resultadosBuscaPlaylist.innerHTML = '';
  resultadosBuscaPlaylist.classList.add('hidden');
}

// Redesenha os resultados conforme o que já está na playlist. Chamado depois
// de carregar a playlist, de remover uma música e de adicionar uma nova.
function marcarResultadosDaBusca() {
  if (!resultadosBuscaPlaylist || resultadosDaBusca.length === 0) return;

  resultadosBuscaPlaylist.innerHTML = '';
  resultadosDaBusca.forEach((musica) => {
    resultadosBuscaPlaylist.appendChild(criarItemResultadoBusca(musica));
  });
}

function criarItemResultadoBusca(musica) {
  const item = document.createElement('div');
  item.className = 'item-busca-playlist';

  let capa;
  if (musica.url_capa) {
    capa = document.createElement('img');
    capa.className = 'item-busca-capa';
    capa.src = musica.url_capa;
    capa.alt = '';
  } else {
    capa = document.createElement('div');
    capa.className = 'item-busca-capa item-busca-capa-vazia';
    capa.textContent = '🎵';
  }

  const texto = document.createElement('div');
  texto.className = 'item-busca-texto';

  const titulo = document.createElement('p');
  titulo.className = 'titulo-musica';
  titulo.textContent = musica.titulo;

  const artista = document.createElement('p');
  artista.className = 'artista-musica';
  artista.textContent = musica.artista;

  texto.appendChild(titulo);
  texto.appendChild(artista);

  const btnAdicionar = document.createElement('button');
  btnAdicionar.type = 'button';
  btnAdicionar.className = 'btn-play-card';

  const jaEstaAqui = idsDaPlaylist.has(Number(musica.id));
  btnAdicionar.textContent = jaEstaAqui ? '✔ Adicionada' : '＋ Adicionar';
  btnAdicionar.disabled = jaEstaAqui;

  btnAdicionar.addEventListener('click', async () => {
    if (btnAdicionar.disabled) return;
    btnAdicionar.disabled = true;
    btnAdicionar.textContent = 'Adicionando...';

    try {
      const resposta = await fetchComAutenticacao(`https://open-sound.onrender.com/api/playlists/${idPlaylist}/musicas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ musicaId: musica.id })
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        alert(dados.mensagem || 'Não foi possível adicionar a música à playlist.');
        btnAdicionar.textContent = '＋ Adicionar';
        btnAdicionar.disabled = false;
        return;
      }

      // Estado local primeiro: o botão e a lista precisam refletir a entrada
      // nova sem esperar mais uma ida ao servidor.
      musicasDaPlaylist.push(musica);
      idsDaPlaylist.add(Number(musica.id));
      btnAdicionar.textContent = '✔ Adicionada';
      btnAdicionar.disabled = true;

      if (btnTocarPlaylist) btnTocarPlaylist.classList.remove('hidden');

      // Recarrega só pra reordenar a grade igual ao servidor: a música entra
      // no fim, e é lá que o detalhe da playlist a mostra.
      carregarPlaylist();
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
      btnAdicionar.textContent = '＋ Adicionar';
      btnAdicionar.disabled = false;
    }
  });

  item.append(capa, texto, btnAdicionar);
  return item;
}

async function buscarMusicasParaPlaylist(termo) {
  if (!termo) {
    esconderResultadosBusca();
    return;
  }

  if (buscaEmCurso) return;
  buscaEmCurso = true;
  if (btnBuscaPlaylist) btnBuscaPlaylist.disabled = true;
  mostrarMensagemBusca('Buscando...');

  try {
    const resposta = await fetch(`https://open-sound.onrender.com/api/musicas/buscar?q=${encodeURIComponent(termo)}`);
    const dados = await resposta.json();

    if (!resposta.ok) {
      mostrarMensagemBusca(dados.mensagem || 'Não foi possível buscar músicas.');
      return;
    }

    resultadosDaBusca = Array.isArray(dados.musicas) ? dados.musicas : [];
    marcarResultadosDaBusca();

    if (resultadosDaBusca.length === 0) {
      mostrarMensagemBusca('Nenhuma música encontrada para esse termo.');
    }
  } catch (erro) {
    console.error('Erro ao buscar músicas:', erro);
    mostrarMensagemBusca('Erro de conexão com o servidor.');
  } finally {
    buscaEmCurso = false;
    if (btnBuscaPlaylist) btnBuscaPlaylist.disabled = false;
  }
}

if (formBuscaPlaylist) {
  formBuscaPlaylist.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const termo = campoBuscaPlaylist ? campoBuscaPlaylist.value.trim() : '';
    buscarMusicasParaPlaylist(termo);
  });
}

if (campoBuscaPlaylist) {
  // Busca enquanto digita, mas só depois que ele para — digitar "rock" não
  // pode disparar quatro requisições.
  campoBuscaPlaylist.addEventListener('input', () => {
    clearTimeout(temporizadorBusca);
    temporizadorBusca = setTimeout(() => {
      const termo = campoBuscaPlaylist.value.trim();
      if (termo.length < 2) {
        esconderResultadosBusca();
        return;
      }
      buscarMusicasParaPlaylist(termo);
    }, 350);
  });
}