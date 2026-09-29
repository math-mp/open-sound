// ================================================================
// profile.js — conectado às rotas reais de backend/perfil.routes.js.
// Curtidas foi removido do front (a rota PUT /api/perfil/curtidas
// continua existindo no back-end, só não é mais chamada daqui).
// A edição de foto/bio agora vive na janela "Configurações";
// a janela "Perfil" só exibe.
// ================================================================

const API_BASE = 'http://localhost:3000';
const CHAVE_SESSAO = 'tokenSessao';
const BIO_MAX = 220; // mesmo limite de backend/perfil.routes.js (LIMITES.BIO_MAX)

// ================================================================
// AUTENTICAÇÃO
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
        mostrarBloqueado();
    }
    return resposta;
}

// ================================================================
// CACHE curto de GET /api/perfil e GET /api/musicas
// ================================================================

function montarChaveCache(tipo) {
    return `opensound_cache_${tipo}_${(obterTokenSessao() || 'sem-sessao').slice(-12)}`;
}

function obterDoCache(chave, ttlMs) {
    const bruto = localStorage.getItem(chave);
    if (!bruto) return null;
    try {
        const { dados, salvoEm } = JSON.parse(bruto);
        if (Date.now() - salvoEm > ttlMs) { localStorage.removeItem(chave); return null; }
        return dados;
    } catch { localStorage.removeItem(chave); return null; }
}

function salvarNoCache(chave, dados) {
    localStorage.setItem(chave, JSON.stringify({ dados, salvoEm: Date.now() }));
}

function invalidarCachePerfil() {
    localStorage.removeItem(montarChaveCache('perfil'));
}

// ================================================================
// ELEMENTOS DO DOM
// ================================================================

const elBloqueado = document.getElementById('perfil-bloqueado');
const elConteudo = document.getElementById('perfil-conteudo');

// Janela 1 — Perfil (só exibição)
const elNome = document.getElementById('perfil-nome');
const elNomeArtista = document.getElementById('perfil-nome-artista');
const elBioExibicao = document.getElementById('perfil-bio');
const elEstatisticas = document.getElementById('perfil-estatisticas');
const elAvatar = document.getElementById('perfil-avatar');
const elBannerImg = document.getElementById('perfil-banner-img');

// Janela 2 — Configurações
const elConfigAvatarPreview = document.getElementById('config-avatar-preview');
const elConfigAvatarInput = document.getElementById('config-avatar-input');
const elConfigAvatarEnviar = document.getElementById('config-avatar-enviar');
const elConfigAvatarRemover = document.getElementById('config-avatar-remover');
const elConfigAvatarStatus = document.getElementById('config-avatar-status');

const elConfigBannerInput = document.getElementById('config-banner-input');
const elConfigBannerEnviar = document.getElementById('config-banner-enviar');
const elConfigBannerRemover = document.getElementById('config-banner-remover');
const elConfigBannerStatus = document.getElementById('config-banner-status');
const elConfigBannerPreview = document.getElementById('config-banner-preview');
const elConfigBannerVazio = document.getElementById('config-banner-vazio');

const elConfigBioForm = document.getElementById('config-bio-form');
const elConfigBioTextarea = document.getElementById('config-bio-textarea');
const elConfigBioContador = document.getElementById('config-bio-contador');
const elConfigBioStatus = document.getElementById('config-bio-status');

// Janela 3 — Biblioteca
const elFavoritaFiltro = document.getElementById('perfil-favorita-filtro');
const elFavoritaResultados = document.getElementById('perfil-favorita-resultados');
const elFavoritaSelecionada = document.getElementById('perfil-favorita-selecionada');

const elPlaylistForm = document.getElementById('perfil-playlist-form');
const elPlaylistNome = document.getElementById('perfil-playlist-nome');
const elPlaylistsLista = document.getElementById('perfil-playlists-lista');

// ================================================================
// ESTADO EM MEMÓRIA
// ================================================================

let catalogoMusicas = [];
let favoritaAtual = null;

function mostrarBloqueado() {
    elBloqueado.classList.remove('hidden');
    elConteudo.classList.add('hidden');
}

function mostrarConteudo() {
    elBloqueado.classList.add('hidden');
    elConteudo.classList.remove('hidden');
}

function exibirMensagemLista(elemento, mensagem) {
    elemento.innerHTML = '';
    const item = document.createElement('li');
    item.className = 'perfil-estado-mensagem';
    item.textContent = mensagem;
    elemento.appendChild(item);
}

// ================================================================
// GET /api/perfil — identidade, favorita, playlists e estatísticas.
// A mesma resposta alimenta a janela Perfil (exibição) e a janela
// Configurações (valores iniciais dos campos editáveis).
// ================================================================

function renderizarPerfil(perfil) {
    const { usuario, favorita, playlists, estatisticas } = perfil;

    // nome_usuario é sempre a identidade principal; nome_artista, quando
    // existe e a conta é de artista, aparece como linha extra — nunca
    // inventamos um no lugar do outro.
    elNome.textContent = usuario.nome_usuario || 'Sem nome de usuário definido';
    if (usuario.eh_artista && usuario.nome_artista) {
        elNomeArtista.textContent = `🎤 ${usuario.nome_artista}`;
        elNomeArtista.classList.remove('hidden');
    } else {
        elNomeArtista.classList.add('hidden');
    }
    elBioExibicao.textContent = usuario.bio || '';

    const urlAvatar = usuario.avatar_url || '../assets/avatar-padrao.png';
    elAvatar.src = urlAvatar;
    elConfigAvatarPreview.src = urlAvatar;
    elConfigAvatarRemover.classList.toggle('hidden', !usuario.avatar_url);

    // Banner não tem asset padrão do projeto (diferente do avatar) — sem
    // banner, a <img> fica escondida e o fundo estrutural do .perfil-banner
    // aparece sozinho como estado vazio legítimo.
    if (usuario.url_banner) {
        elBannerImg.src = usuario.url_banner;
        elBannerImg.classList.remove('hidden');
        elConfigBannerPreview.src = usuario.url_banner;
        elConfigBannerPreview.classList.remove('hidden');
        elConfigBannerVazio.classList.add('hidden');
        elConfigBannerRemover.classList.remove('hidden');
    } else {
        elBannerImg.removeAttribute('src');
        elBannerImg.classList.add('hidden');
        elConfigBannerPreview.removeAttribute('src');
        elConfigBannerPreview.classList.add('hidden');
        elConfigBannerVazio.classList.remove('hidden');
        elConfigBannerRemover.classList.add('hidden');
    }

    elEstatisticas.textContent = usuario.eh_artista
        ? `${estatisticas.musicas_enviadas} música(s) enviada(s) · ${estatisticas.reproducoes} reprodução(ões)`
        : '';

    // Só substitui o texto do campo se o usuário não estiver com o
    // foco nele agora (evita apagar o que a pessoa está digitando se
    // o cache/refresh disparar no meio da edição).
    if (document.activeElement !== elConfigBioTextarea) {
        elConfigBioTextarea.value = usuario.bio || '';
        atualizarContadorBio();
    }

    favoritaAtual = favorita;
    elFavoritaSelecionada.textContent = favorita ? `Favorita: ${favorita.titulo}` : 'Nenhuma escolhida ainda.';

    renderizarPlaylists(playlists);
}

async function carregarPerfil({ usarCache = true } = {}) {
    const chave = montarChaveCache('perfil');
    if (usarCache) {
        const emCache = obterDoCache(chave, 20 * 1000);
        if (emCache !== null) { renderizarPerfil(emCache); return; }
    }

    try {
        const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil`);
        if (resposta.status === 401) return;
        if (!resposta.ok) throw new Error('Falha ao carregar perfil.');
        const { perfil } = await resposta.json();
        renderizarPerfil(perfil);
        salvarNoCache(chave, perfil);
    } catch (erro) {
        elNome.textContent = 'Não foi possível carregar o perfil';
        console.error('Erro ao carregar perfil:', erro);
    }
}

// ================================================================
// CONFIGURAÇÕES — BIOGRAFIA
// ================================================================

function atualizarContadorBio() {
    elConfigBioContador.textContent = `${elConfigBioTextarea.value.length}/${BIO_MAX}`;
}

elConfigBioTextarea.addEventListener('input', atualizarContadorBio);

elConfigBioForm.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const texto = elConfigBioTextarea.value.trim();

    elConfigBioStatus.textContent = 'Salvando...';
    try {
        const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil/bio`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bio: texto })
        });
        const dados = await resposta.json().catch(() => null);

        if (!resposta.ok) {
            elConfigBioStatus.textContent = dados?.mensagem || 'Não foi possível salvar a bio.';
            return;
        }

        elConfigBioStatus.textContent = 'Biografia salva ✓';
        elBioExibicao.textContent = dados.bio || '';
        invalidarCachePerfil();
    } catch (erro) {
        elConfigBioStatus.textContent = 'Erro de conexão ao salvar a bio.';
        console.error(erro);
    }
});

// ================================================================
// CONFIGURAÇÕES — FOTO DE PERFIL
// ================================================================

elConfigAvatarEnviar.addEventListener('click', () => elConfigAvatarInput.click());

elConfigAvatarInput.addEventListener('change', async () => {
    const arquivo = elConfigAvatarInput.files[0];
    if (!arquivo) return;

    const formulario = new FormData();
    formulario.append('avatar', arquivo);

    elConfigAvatarStatus.textContent = 'Enviando...';
    try {
        // Não definir Content-Type manualmente com FormData: o navegador
        // monta o boundary do multipart sozinho.
        const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil/avatar`, {
            method: 'POST',
            body: formulario
        });
        const dados = await resposta.json().catch(() => null);

        if (!resposta.ok) {
            elConfigAvatarStatus.textContent = dados?.mensagem || 'Não foi possível enviar a foto.';
            return;
        }

        elConfigAvatarPreview.src = dados.avatar_url;
        elAvatar.src = dados.avatar_url;
        elConfigAvatarRemover.classList.remove('hidden');
        elConfigAvatarStatus.textContent = 'Foto atualizada ✓';
        invalidarCachePerfil();
    } catch (erro) {
        elConfigAvatarStatus.textContent = 'Erro de conexão ao enviar a foto.';
        console.error(erro);
    } finally {
        elConfigAvatarInput.value = '';
    }
});

elConfigAvatarRemover.addEventListener('click', async () => {
    elConfigAvatarStatus.textContent = 'Removendo...';
    try {
        const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil/avatar`, { method: 'DELETE' });
        if (!resposta.ok) { elConfigAvatarStatus.textContent = 'Não foi possível remover a foto.'; return; }

        elConfigAvatarPreview.src = '../assets/avatar-padrao.png';
        elAvatar.src = '../assets/avatar-padrao.png';
        elConfigAvatarRemover.classList.add('hidden');
        elConfigAvatarStatus.textContent = 'Foto removida.';
        invalidarCachePerfil();
    } catch (erro) {
        elConfigAvatarStatus.textContent = 'Erro de conexão ao remover a foto.';
        console.error(erro);
    }
});

// ================================================================
// TEMA CLARO/ESCURO
// A mesma chave que o botão #btn-tema do home.js deveria usar quando
// alguém acrescentar o listener que falta lá (ver observação em
// conversas anteriores: hoje esse botão não faz nada no home.js).
// ================================================================

const CHAVE_TEMA = 'opensound_tema';
const elTemaBtn = document.getElementById('config-tema-btn');

function temaAtual() {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function atualizarTextoBotaoTema() {
    elTemaBtn.textContent = temaAtual() === 'light' ? '☀️ Claro' : '🌙 Escuro';
}

elTemaBtn.addEventListener('click', () => {
    const novoTema = temaAtual() === 'light' ? 'dark' : 'light';
    if (novoTema === 'light') {
        document.documentElement.dataset.theme = 'light';
    } else {
        delete document.documentElement.dataset.theme; // ausência = escuro (padrão do theme.css)
    }
    localStorage.setItem(CHAVE_TEMA, novoTema);
    atualizarTextoBotaoTema();
});

// ================================================================
// CONFIGURAÇÕES — BANNER (mesma arquitetura do avatar, rota própria)
// ================================================================

elConfigBannerEnviar.addEventListener('click', () => elConfigBannerInput.click());

elConfigBannerInput.addEventListener('change', async () => {
    const arquivo = elConfigBannerInput.files[0];
    if (!arquivo) return;

    const formulario = new FormData();
    formulario.append('banner', arquivo);

    elConfigBannerStatus.textContent = 'Enviando...';
    try {
        const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil/banner`, {
            method: 'POST',
            body: formulario
        });
        const dados = await resposta.json().catch(() => null);

        if (!resposta.ok) {
            elConfigBannerStatus.textContent = dados?.mensagem || 'Não foi possível enviar o banner.';
            return;
        }

        elBannerImg.src = dados.url_banner;
        elBannerImg.classList.remove('hidden');
        elConfigBannerPreview.src = dados.url_banner;
        elConfigBannerPreview.classList.remove('hidden');
        elConfigBannerVazio.classList.add('hidden');
        elConfigBannerRemover.classList.remove('hidden');
        elConfigBannerStatus.textContent = 'Banner atualizado ✓';
        invalidarCachePerfil();
    } catch (erro) {
        elConfigBannerStatus.textContent = 'Erro de conexão ao enviar o banner.';
        console.error(erro);
    } finally {
        elConfigBannerInput.value = '';
    }
});

elConfigBannerRemover.addEventListener('click', async () => {
    elConfigBannerStatus.textContent = 'Removendo...';
    try {
        const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil/banner`, { method: 'DELETE' });
        if (!resposta.ok) { elConfigBannerStatus.textContent = 'Não foi possível remover o banner.'; return; }

        elBannerImg.removeAttribute('src');
        elBannerImg.classList.add('hidden');
        elConfigBannerPreview.removeAttribute('src');
        elConfigBannerPreview.classList.add('hidden');
        elConfigBannerVazio.classList.remove('hidden');
        elConfigBannerRemover.classList.add('hidden');
        elConfigBannerStatus.textContent = 'Banner removido.';
        invalidarCachePerfil();
    } catch (erro) {
        elConfigBannerStatus.textContent = 'Erro de conexão ao remover o banner.';
        console.error(erro);
    }
});

// ================================================================
// CATÁLOGO (GET /api/musicas — público) — só alimenta a Favorita
// agora que Curtidas saiu.
// ================================================================

async function carregarCatalogo() {
    const chave = montarChaveCache('catalogo-musicas');
    const emCache = obterDoCache(chave, 2 * 60 * 1000);
    if (emCache !== null) { catalogoMusicas = emCache; aplicarCatalogoCarregado(); return; }

    try {
        const resposta = await fetch(`${API_BASE}/api/musicas`);
        if (!resposta.ok) throw new Error('Falha ao carregar catálogo.');
        const { musicas } = await resposta.json();
        catalogoMusicas = musicas;
        salvarNoCache(chave, musicas);
        aplicarCatalogoCarregado();
    } catch (erro) {
        exibirMensagemLista(elFavoritaResultados, 'Não foi possível carregar o catálogo.');
        console.error('Erro ao carregar catálogo:', erro);
    }
}

function aplicarCatalogoCarregado() {
    elFavoritaFiltro.disabled = false;
    renderizarResultadosFavorita(catalogoMusicas);
}

elFavoritaFiltro.addEventListener('input', () => {
    const termo = elFavoritaFiltro.value.trim().toLowerCase();
    const filtradas = termo
        ? catalogoMusicas.filter((m) => m.titulo.toLowerCase().includes(termo) || m.artista.toLowerCase().includes(termo))
        : catalogoMusicas;
    renderizarResultadosFavorita(filtradas);
});

function renderizarResultadosFavorita(musicas) {
    elFavoritaResultados.innerHTML = '';
    if (musicas.length === 0) { exibirMensagemLista(elFavoritaResultados, 'Nenhuma música encontrada.'); return; }

    musicas.forEach((musica) => {
        const item = document.createElement('li');
        item.className = 'perfil-resultado-item';
        if (favoritaAtual?.id === musica.id) item.classList.add('selecionado');

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
        texto.append(titulo, artista);
        item.append(capa, texto);

        item.addEventListener('click', () => definirFavorita(musica));
        elFavoritaResultados.appendChild(item);
    });
}

// ================================================================
// FAVORITA — salva ao clicar; clicar na já-selecionada remove
// ================================================================

async function definirFavorita(musica) {
    const removendo = favoritaAtual?.id === musica.id;
    elFavoritaSelecionada.textContent = removendo ? 'Removendo...' : 'Salvando...';

    try {
        const resposta = removendo
            ? await fetchComAutenticacao(`${API_BASE}/api/perfil/favorita`, { method: 'DELETE' })
            : await fetchComAutenticacao(`${API_BASE}/api/perfil/favorita`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ musicaId: musica.id })
            });

        const dados = await resposta.json().catch(() => null);
        if (!resposta.ok) {
            alert(dados?.mensagem || 'Não foi possível salvar a favorita.');
            elFavoritaSelecionada.textContent = favoritaAtual ? `Favorita: ${favoritaAtual.titulo}` : 'Nenhuma escolhida ainda.';
            return;
        }

        favoritaAtual = dados.favorita;
        elFavoritaSelecionada.textContent = favoritaAtual ? `Favorita: ${favoritaAtual.titulo}` : 'Nenhuma escolhida ainda.';
        invalidarCachePerfil();
        renderizarResultadosFavorita(catalogoMusicas.filter((m) =>
            !elFavoritaFiltro.value.trim() ||
            m.titulo.toLowerCase().includes(elFavoritaFiltro.value.trim().toLowerCase()) ||
            m.artista.toLowerCase().includes(elFavoritaFiltro.value.trim().toLowerCase())
        ));
    } catch (erro) {
        alert('Erro de conexão ao salvar a favorita.');
        console.error(erro);
    }
}

// ================================================================
// PLAYLISTS
// ================================================================

function renderizarPlaylists(playlists) {
    elPlaylistsLista.innerHTML = '';
    if (playlists.length === 0) { exibirMensagemLista(elPlaylistsLista, 'Você ainda não tem playlists públicas.'); return; }

    playlists.forEach((playlist) => {
        const item = document.createElement('li');
        item.className = 'perfil-resultado-item';

        const texto = document.createElement('div');
        texto.className = 'perfil-resultado-texto';
        const titulo = document.createElement('span');
        titulo.className = 'perfil-resultado-titulo';
        titulo.textContent = playlist.nome;
        const faixas = document.createElement('span');
        faixas.className = 'perfil-playlist-faixas';
        faixas.textContent = playlist.total_faixas === 1 ? '1 faixa' : `${playlist.total_faixas} faixas`;
        texto.append(titulo, faixas);

        const remover = document.createElement('button');
        remover.type = 'button';
        remover.className = 'perfil-resultado-remover';
        remover.textContent = '✕';
        remover.title = 'Excluir playlist';
        remover.addEventListener('click', () => excluirPlaylist(playlist.id));

        item.append(texto, remover);
        elPlaylistsLista.appendChild(item);
    });
}

elPlaylistForm.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const nome = elPlaylistNome.value.trim();
    if (!nome) return;

    try {
        const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil/playlists`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome })
        });
        const dados = await resposta.json().catch(() => null);
        if (!resposta.ok) { alert(dados?.mensagem || 'Não foi possível criar a playlist.'); return; }

        elPlaylistNome.value = '';
        invalidarCachePerfil();
        await carregarPerfil({ usarCache: false });
    } catch (erro) {
        alert('Erro de conexão ao criar a playlist.');
        console.error(erro);
    }
});

async function excluirPlaylist(id) {
    try {
        const resposta = await fetchComAutenticacao(`${API_BASE}/api/perfil/playlists/${id}`, { method: 'DELETE' });
        if (!resposta.ok) { alert('Não foi possível excluir a playlist.'); return; }
        invalidarCachePerfil();
        await carregarPerfil({ usarCache: false });
    } catch (erro) {
        alert('Erro de conexão ao excluir a playlist.');
        console.error(erro);
    }
}

// ================================================================
// INICIALIZAÇÃO
// ================================================================

document.addEventListener('DOMContentLoaded', () => {
    if (!estaLogado()) { mostrarBloqueado(); return; }
    mostrarConteudo();
    atualizarTextoBotaoTema();
    atualizarContadorBio();
    carregarPerfil();
    carregarCatalogo();
});