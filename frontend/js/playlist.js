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

// Tocar pelo detalhe da playlist e tocar pelo card da biblioteca são a mesma
// coisa: a fila é substituída pela lista e a primeira começa a tocar.
function tocarPlaylistAtual() {
  if (!musicasDaPlaylist.length) {
    alert('Esta playlist ainda não tem músicas para tocar.');
    return;
  }
  tocarListaDeMusicas(musicasDaPlaylist);
}

function criarCardMusicaPlaylist(musica) {
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

  const btnRemover = document.createElement('button');
  btnRemover.className = 'btn-excluir-musica';
  btnRemover.textContent = 'Remover';

  btnRemover.addEventListener('click', async () => {
    const confirmou = confirm(`Remover "${musica.titulo}" desta playlist?`);
    if (!confirmou) return;

    btnRemover.disabled = true;
    btnRemover.textContent = 'Removendo...';

    try {
      const resposta = await fetchComAutenticacao(
        `${API_URL}/api/playlists/${idPlaylist}/musicas/${musica.id}`,
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
        btnRemover.textContent = 'Remover';
      }
    } catch (erro) {
      console.error('Erro de conexão:', erro);
      alert('Erro de conexão com o servidor.');
      btnRemover.disabled = false;
      btnRemover.textContent = 'Remover';
    }
  });

  card.appendChild(capa);
  card.appendChild(info);
  card.appendChild(btnRemover);

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
    const resposta = await fetchComAutenticacao(`${API_URL}/api/playlists/${idPlaylist}`);
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
      const resposta = await fetchComAutenticacao(`${API_URL}/api/playlists/${idPlaylist}`, {
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
      const resposta = await fetchComAutenticacao(`${API_URL}/api/playlists/${idPlaylist}/musicas`, {
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
    const resposta = await fetch(`${API_URL}/api/musicas/buscar?q=${encodeURIComponent(termo)}`);
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