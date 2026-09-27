// ================================================================
// profile.js
// Script exclusivo da página perfil.html. Não reutiliza nem altera
// o home.js. Duplica aqui a mesma chave/contrato de sessão que o
// home.js usa: CHAVE_SESSAO = 'tokenSessao' (verificado no código
// real do home.js).
// ================================================================

const API_BASE = 'http://localhost:3000';
const CHAVE_SESSAO = 'tokenSessao';
const LIMITE_CURTIDAS = 4; // regra de negócio definida por Carol, não dado da API
const TAMANHO_MAX_AVATAR_BYTES = 300 * 1024; // 300KB, pra não estourar o limite do localStorage

// ================================================================
// AUTENTICAÇÃO (mesmo padrão do home.js, duplicado por necessidade)
// ================================================================

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
        elNome.textContent = 'Sessão expirada';
        elBio.textContent = 'Faça login novamente na página inicial.';
    }

    return resposta;
}

// ================================================================
// CACHE de dados vindos da API (cache-first, TTL curto)
// ================================================================

function montarChaveCache(tipo) {
    const token = obterTokenSessao() || 'sem-sessao';
    return `opensound_cache_${tipo}_${token.slice(-12)}`;
}

function obterDoCache(chave, ttlMs) {
    const bruto = localStorage.getItem(chave);
    if (!bruto) return null;
    try {
        const { dados, salvoEm } = JSON.parse(bruto);
        if (Date.now() - salvoEm > ttlMs) {
            localStorage.removeItem(chave);
            return null;
        }
        return dados;
    } catch (erro) {
        localStorage.removeItem(chave);
        return null;
    }
}

function salvarNoCache(chave, dados) {
    localStorage.setItem(chave, JSON.stringify({ dados, salvoEm: Date.now() }));
}

// ================================================================
// PERSONALIZAÇÃO LOCAL (bio, avatar, favorita, curtidas, playlists)
// Isso é diferente do cache acima: aqui é o próprio usuário editando
// algo, não um dado buscado da API. Fica salvo indefinidamente (sem
// TTL) até o back-end ter onde guardar isso de verdade.
// ================================================================

function montarChaveLocal(tipo) {
    const token = obterTokenSessao() || 'sem-sessao';
    return `opensound_local_${tipo}_${token.slice(-12)}`;
}

function lerLocal(tipo, valorPadrao) {
    const bruto = localStorage.getItem(montarChaveLocal(tipo));
    if (!bruto) return valorPadrao;
    try {
        return JSON.parse(bruto);
    } catch (erro) {
        return valorPadrao;
    }
}

function salvarLocal(tipo, valor) {
    localStorage.setItem(montarChaveLocal(tipo), JSON.stringify(valor));
}

// ================================================================
// ELEMENTOS DO DOM
// ================================================================

const elNome = document.getElementById('perfil-nome');
const elBio = document.getElementById('perfil-bio');
const elAvatar = document.getElementById('perfil-avatar');
const elAvatarWrapper = document.querySelector('.perfil-avatar-wrapper');
const elAvatarInput = document.getElementById('perfil-avatar-input');

const elFavoritaFiltro = document.getElementById('perfil-favorita-filtro');
const elFavoritaResultados = document.getElementById('perfil-favorita-resultados');
const elFavoritaSelecionada = document.getElementById('perfil-favorita-selecionada');
const elFavoritaSalvar = document.getElementById('perfil-favorita-salvar');

const elCurtidasFiltro = document.getElementById('perfil-curtidas-filtro');
const elCurtidasResultados = document.getElementById('perfil-curtidas-resultados');
const elCurtidasSelecionadas = document.getElementById('perfil-curtidas-selecionadas');
const elCurtidasSalvar = document.getElementById('perfil-curtidas-salvar');

const elPlaylistNome = document.getElementById('perfil-playlist-nome');
const elPlaylistCriarBtn = document.getElementById('perfil-playlist-criar-btn');
const elPlaylistsLista = document.getElementById('perfil-playlists-lista');

// ================================================================
// ESTADO EM MEMÓRIA
// ================================================================

let catalogoMusicas = [];      // até 50 músicas mais recentes, de GET /api/musicas
let favoritaEscolhida = null;  // objeto {id, titulo, artista, url_capa} ou null
const curtidasEscolhidas = new Map(); // id -> objeto música

// ================================================================
// BIO (contenteditable, salva em localStorage ao perder o foco)
// ================================================================

elBio.addEventListener('blur', () => {
    const texto = elBio.textContent.trim();
    salvarLocal('bio', texto);
});

function carregarBioLocal() {
    const bioSalva = lerLocal('bio', null);
    if (bioSalva) elBio.textContent = bioSalva;
}

// ================================================================
// AVATAR (clique abre seletor de arquivo; salva como data URL)
// ================================================================

elAvatarWrapper.addEventListener('click', () => elAvatarInput.click());

elAvatarInput.addEventListener('change', () => {
    const arquivo = elAvatarInput.files[0];
    if (!arquivo) return;

    if (arquivo.size > TAMANHO_MAX_AVATAR_BYTES) {
        alert('Essa imagem é muito grande pra salvar no navegador. Use uma menor que 300KB.');
        elAvatarInput.value = '';
        return;
    }

    const leitor = new FileReader();
    leitor.onload = () => {
        const dataUrl = leitor.result;
        elAvatar.src = dataUrl;
        try {
            salvarLocal('avatar', dataUrl);
        } catch (erro) {
            // localStorage cheio ou indisponível — a imagem ainda aparece
            // na tela nesta sessão, só não persiste entre recarregamentos
            alert('Não deu pra salvar essa imagem no navegador (armazenamento cheio). Ela some se você recarregar a página.');
            console.error('Erro ao salvar avatar no localStorage:', erro);
        }
    };
    leitor.readAsDataURL(arquivo);
});

function carregarAvatarLocal() {
    const avatarSalvo = lerLocal('avatar', null);
    if (avatarSalvo) elAvatar.src = avatarSalvo;
}

// ================================================================
// SEÇÃO: IDENTIDADE (GET /api/usuarios/eu — rota real)
// ================================================================

function renderizarIdentidade(usuario) {
    elNome.textContent = usuario.eh_artista && usuario.nome_artista
        ? usuario.nome_artista
        : usuario.email;
}

async function carregarIdentidade() {
    const chave = montarChaveCache('usuario-logado');
    const emCache = obterDoCache(chave, 5 * 60 * 1000);
    if (emCache !== null) {
        renderizarIdentidade(emCache);
        return;
    }

    try {
        const resposta = await fetchComAutenticacao(`${API_BASE}/api/usuarios/eu`);
        if (!resposta.ok) throw new Error('Falha ao carregar usuário.');
        const { usuario } = await resposta.json();
        renderizarIdentidade(usuario);
        salvarNoCache(chave, usuario);
    } catch (erro) {
        elNome.textContent = 'Não foi possível carregar o perfil';
        console.error('Erro ao carregar identidade:', erro);
    }
}

// ================================================================
// CATÁLOGO (GET /api/musicas — rota real, pública, sem busca no
// servidor). Buscado uma vez; o filtro roda no navegador.
// ================================================================

async function carregarCatalogo() {
    const chave = montarChaveCache('catalogo-musicas');
    const emCache = obterDoCache(chave, 2 * 60 * 1000);

    if (emCache !== null) {
        catalogoMusicas = emCache;
        aplicarCatalogoCarregado();
        return;
    }

    try {
        const resposta = await fetch(`${API_BASE}/api/musicas`);
        if (!resposta.ok) throw new Error('Falha ao carregar catálogo.');
        const { musicas } = await resposta.json();

        catalogoMusicas = musicas;
        salvarNoCache(chave, musicas);
        aplicarCatalogoCarregado();
    } catch (erro) {
        exibirMensagemLista(elFavoritaResultados, 'Não foi possível carregar o catálogo.');
        exibirMensagemLista(elCurtidasResultados, 'Não foi possível carregar o catálogo.');
        console.error('Erro ao carregar catálogo de músicas:', erro);
    }
}

function aplicarCatalogoCarregado() {
    elFavoritaFiltro.disabled = false;
    elCurtidasFiltro.disabled = false;
    renderizarResultados(elFavoritaResultados, catalogoMusicas, 'favorita');
    renderizarResultados(elCurtidasResultados, catalogoMusicas, 'curtidas');
}

function exibirMensagemLista(elemento, mensagem) {
    elemento.innerHTML = '';
    const item = document.createElement('li');
    item.className = 'perfil-estado-mensagem';
    item.textContent = mensagem;
    elemento.appendChild(item);
}

// ================================================================
// RENDERIZAÇÃO DOS RESULTADOS FILTRADOS
// ================================================================

function renderizarResultados(elementoLista, musicas, tipo) {
    elementoLista.innerHTML = '';

    if (musicas.length === 0) {
        exibirMensagemLista(elementoLista, 'Nenhuma música encontrada.');
        return;
    }

    musicas.forEach((musica) => {
        const item = document.createElement('li');
        item.className = 'perfil-resultado-item';

        const jaSelecionada = tipo === 'favorita'
            ? favoritaEscolhida?.id === musica.id
            : curtidasEscolhidas.has(musica.id);

        if (jaSelecionada) item.classList.add('selecionado');

        const capa = document.createElement('img');
        capa.className = 'perfil-resultado-capa';
        capa.src = musica.url_capa || '../assets/avatar-padrao.png';
        capa.alt = '';

        const texto = document.createElement('div');
        texto.className = 'perfil-resultado-texto';

        const titulo = document.createElement('span');
        titulo.className = 'perfil-resultado-titulo';
        titulo.textContent = musica.titulo;

        const artista = document.createElement('span');
        artista.className = 'perfil-resultado-artista';
        artista.textContent = musica.artista;

        texto.appendChild(titulo);
        texto.appendChild(artista);
        item.appendChild(capa);
        item.appendChild(texto);

        item.addEventListener('click', () => {
            if (tipo === 'favorita') {
                favoritaEscolhida = musica;
                elFavoritaSelecionada.textContent = `Selecionada: ${musica.titulo} (clique em "Salvar favorita").`;
            } else {
                alternarCurtida(musica);
            }
            renderizarResultados(elementoLista, musicas, tipo);
        });

        elementoLista.appendChild(item);
    });
}

function alternarCurtida(musica) {
    if (curtidasEscolhidas.has(musica.id)) {
        curtidasEscolhidas.delete(musica.id);
    } else if (curtidasEscolhidas.size < LIMITE_CURTIDAS) {
        curtidasEscolhidas.set(musica.id, musica);
    } else {
        elCurtidasSelecionadas.textContent = `Limite de ${LIMITE_CURTIDAS} atingido — remova uma antes de escolher outra.`;
        return;
    }
    elCurtidasSelecionadas.textContent =
        `${curtidasEscolhidas.size} de ${LIMITE_CURTIDAS} escolhidas (clique em "Salvar curtidas").`;
}

// ================================================================
// FILTRO CLIENT-SIDE
// ================================================================

function filtrarCatalogo(termo) {
    const termoLimpo = termo.trim().toLowerCase();
    if (!termoLimpo) return catalogoMusicas;
    return catalogoMusicas.filter((musica) =>
        musica.titulo.toLowerCase().includes(termoLimpo) ||
        musica.artista.toLowerCase().includes(termoLimpo)
    );
}

elFavoritaFiltro.addEventListener('input', () => {
    renderizarResultados(elFavoritaResultados, filtrarCatalogo(elFavoritaFiltro.value), 'favorita');
});

elCurtidasFiltro.addEventListener('input', () => {
    renderizarResultados(elCurtidasResultados, filtrarCatalogo(elCurtidasFiltro.value), 'curtidas');
});

// ================================================================
// SALVAR EM localStorage (favorita, curtidas, playlists)
// ================================================================

elFavoritaSalvar.addEventListener('click', () => {
    if (!favoritaEscolhida) {
        alert('Escolha uma música na lista antes de salvar.');
        return;
    }
    salvarLocal('favorita', favoritaEscolhida);
    elFavoritaSelecionada.textContent = `Salva: ${favoritaEscolhida.titulo} (só neste navegador).`;
});

elCurtidasSalvar.addEventListener('click', () => {
    const lista = Array.from(curtidasEscolhidas.values());
    salvarLocal('curtidas', lista);
    elCurtidasSelecionadas.textContent =
        `${lista.length} de ${LIMITE_CURTIDAS} salvas (só neste navegador).`;
});

function renderizarPlaylistsLocais() {
    const playlists = lerLocal('playlists', []);
    elPlaylistsLista.innerHTML = '';

    if (playlists.length === 0) {
        exibirMensagemLista(elPlaylistsLista, 'Você ainda não tem playlists públicas.');
        return;
    }

    playlists.forEach((playlist) => {
        const item = document.createElement('li');
        item.className = 'perfil-resultado-item';
        const texto = document.createElement('div');
        texto.className = 'perfil-resultado-texto';
        const titulo = document.createElement('span');
        titulo.className = 'perfil-resultado-titulo';
        titulo.textContent = playlist.nome;
        texto.appendChild(titulo);
        item.appendChild(texto);
        elPlaylistsLista.appendChild(item);
    });
}

elPlaylistCriarBtn.addEventListener('click', () => {
    const nome = elPlaylistNome.value.trim();
    if (!nome) {
        alert('Digite um nome pra playlist antes de criar.');
        return;
    }
    const playlists = lerLocal('playlists', []);
    playlists.push({ nome, criadoEm: Date.now() });
    salvarLocal('playlists', playlists);
    elPlaylistNome.value = '';
    renderizarPlaylistsLocais();
});

// ================================================================
// CARREGAMENTO INICIAL DE TUDO QUE JÁ ESTAVA SALVO LOCALMENTE
// ================================================================

function carregarPersonalizacaoLocal() {
    carregarBioLocal();
    carregarAvatarLocal();

    const favoritaSalva = lerLocal('favorita', null);
    if (favoritaSalva) {
        favoritaEscolhida = favoritaSalva;
        elFavoritaSelecionada.textContent = `Salva: ${favoritaSalva.titulo} (só neste navegador).`;
    }

    const curtidasSalvas = lerLocal('curtidas', []);
    curtidasSalvas.forEach((musica) => curtidasEscolhidas.set(musica.id, musica));
    if (curtidasSalvas.length > 0) {
        elCurtidasSelecionadas.textContent =
            `${curtidasSalvas.length} de ${LIMITE_CURTIDAS} salvas (só neste navegador).`;
    }

    renderizarPlaylistsLocais();
}

// ================================================================
// INICIALIZAÇÃO
// ================================================================

document.addEventListener('DOMContentLoaded', () => {
    carregarPersonalizacaoLocal();

    // GET /api/musicas não exige login.
    carregarCatalogo();

    // GET /api/usuarios/eu exige login.
    if (!estaLogado()) {
        elNome.textContent = 'Nenhum usuário logado';
        return;
    }
    carregarIdentidade();
});