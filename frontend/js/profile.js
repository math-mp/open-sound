/* ============================================================
   OPENSOUND — PROFILE.JS

   Responsabilidades deste arquivo:
   1. Ler o token de sessão existente.
   2. Buscar o perfil real na API.
   3. Renderizar dados reais sem HTML vindo do usuário.
   4. Salvar bio, avatar, tema, banner, favorita, curtidas e playlists.
   5. Reaproveitar as rotas já existentes no server.js.

   Importante:
   - localStorage NÃO é fonte de verdade para dados de perfil.
   - O único dado mantido pelo front aqui é o token de sessão já usado pelo projeto.
   - Banner depende da pequena migração/rota de backend entregue junto.
   ============================================================ */

(() => {
    'use strict';

    const API_BASE = (() => {
        // Desenvolvimento local: front costuma rodar em outra porta.
        // Em produção, quando front e API estiverem no mesmo host, usa origem relativa.
        return window.location.origin === 'null' || window.location.port !== '3000'
            ? 'http://localhost:3000'
            : '';
    })();

    const TOKEN_KEY = 'tokenSessao';
    const BIO_MAX = 220;
    const CURTIDAS_MAX = 4;
    const AVATAR_PADRAO = '../assets/avatar-padrao.png';

    let perfilAtual = null;

    const $ = (seletor) => document.querySelector(seletor);

    const dom = {
        bloqueado: $('#perfil-bloqueado'),
        conteudo: $('#perfil-conteudo'),

        banner: $('#perfil-banner'),
        bannerImg: $('#perfil-banner-img'),
        bannerVazio: $('#perfil-banner-vazio'),
        avatar: $('#perfil-avatar'),
        nome: $('#perfil-nome'),
        nomeArtista: $('#perfil-nome-artista'),
        bio: $('#perfil-bio'),
        estatisticas: $('#perfil-estatisticas'),

        avatarInput: $('#config-avatar-input'),
        avatarPreview: $('#config-avatar-preview'),
        avatarEnviar: $('#config-avatar-enviar'),
        avatarRemover: $('#config-avatar-remover'),
        avatarStatus: $('#config-avatar-status'),

        bannerInput: $('#config-banner-input'),
        bannerPreview: $('#config-banner-preview-img'),
        bannerPreviewVazio: $('#config-banner-preview-vazio'),
        bannerEnviar: $('#config-banner-enviar'),
        bannerRemover: $('#config-banner-remover'),
        bannerStatus: $('#config-banner-status'),

        bioForm: $('#config-bio-form'),
        bioTextarea: $('#config-bio-textarea'),
        bioContador: $('#config-bio-contador'),
        bioStatus: $('#config-bio-status'),

        temaBtn: $('#config-tema-btn'),
        temaStatus: $('#config-tema-status'),

        favoritaFiltro: $('#perfil-favorita-filtro'),
        favoritaResultados: $('#perfil-favorita-resultados'),
        favoritaAtual: $('#perfil-favorita-atual'),
        favoritaRemover: $('#perfil-favorita-remover'),

        curtidasFiltro: $('#perfil-curtidas-filtro'),
        curtidasResultados: $('#perfil-curtidas-resultados'),
        curtidasLista: $('#perfil-curtidas-lista'),
        curtidasContador: $('#perfil-curtidas-contador'),

        playlistForm: $('#perfil-playlist-form'),
        playlistNome: $('#perfil-playlist-nome'),
        playlistsLista: $('#perfil-playlists-lista')
    };

    class ApiErro extends Error {
        constructor(mensagem, status, dados = null) {
            super(mensagem);
            this.name = 'ApiErro';
            this.status = status;
            this.dados = dados;
        }
    }

    function getToken() {
        return localStorage.getItem(TOKEN_KEY);
    }

    function limparSessao() {
        localStorage.removeItem(TOKEN_KEY);
    }

    function mostrarBloqueado() {
        dom.bloqueado?.classList.remove('hidden');
        dom.conteudo?.classList.add('hidden');
    }

    function mostrarConteudo() {
        dom.bloqueado?.classList.add('hidden');
        dom.conteudo?.classList.remove('hidden');
    }

    function extrairMensagem(dados, fallback) {
        return dados?.mensagem || fallback;
    }

    async function apiRequest(caminho, opcoes = {}) {
        const token = getToken();
        const headers = new Headers(opcoes.headers || {});

        if (token) {
            headers.set('Authorization', `Bearer ${token}`);
        }

        const corpoEhFormData = opcoes.body instanceof FormData;

        if (opcoes.body && !corpoEhFormData && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }

        let resposta;
        try {
            resposta = await fetch(`${API_BASE}${caminho}`, {
                ...opcoes,
                headers
            });
        } catch (erro) {
            throw new Error('Não foi possível conectar ao servidor.');
        }

        let dados = null;
        const contentType = resposta.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
            try {
                dados = await resposta.json();
            } catch {
                dados = null;
            }
        }

        if (resposta.status === 401) {
            limparSessao();
            mostrarBloqueado();
            throw new ApiErro('Sua sessão expirou. Faça login novamente.', 401, dados);
        }

        if (!resposta.ok) {
            throw new ApiErro(
                extrairMensagem(dados, 'A operação não pôde ser concluída.'),
                resposta.status,
                dados
            );
        }

        return dados || {};
    }

    function setStatus(elemento, mensagem, erro = false) {
        if (!elemento) return;
        elemento.textContent = mensagem || '';
        elemento.dataset.estado = erro ? 'erro' : 'ok';
    }

    function formatarImagem(url, fallback = AVATAR_PADRAO) {
        return url || fallback;
    }

    function atualizarTema(tema) {
        const temaValido = tema === 'light' ? 'light' : 'dark';
        document.documentElement.dataset.theme = temaValido;

        if (dom.temaStatus) {
            dom.temaStatus.textContent =
                `Tema atual: ${temaValido === 'light' ? 'claro' : 'escuro'}.`;
        }
    }

    function renderizarBanner(url) {
        const possuiBanner = Boolean(url);

        dom.banner?.classList.toggle('tem-imagem', possuiBanner);
        dom.bannerImg?.classList.toggle('hidden', !possuiBanner);
        dom.bannerVazio?.classList.toggle('hidden', possuiBanner);

        if (dom.bannerImg) {
            dom.bannerImg.src = possuiBanner ? url : '';
        }

        dom.bannerPreview?.classList.toggle('hidden', !possuiBanner);
        dom.bannerPreviewVazio?.classList.toggle('hidden', possuiBanner);

        if (dom.bannerPreview && possuiBanner) {
            dom.bannerPreview.src = url;
        } else if (dom.bannerPreview) {
            dom.bannerPreview.src = '';
        }
    }

    function renderizarPerfil(perfil) {
        perfilAtual = perfil;

        const usuario = perfil?.usuario || {};
        const estatisticas = perfil?.estatisticas || {};
        const favorita = perfil?.favorita || null;
        const curtidas = Array.isArray(perfil?.curtidas)
            ? perfil.curtidas
            : [];
        const playlists = Array.isArray(perfil?.playlists)
            ? perfil.playlists
            : [];

        dom.nome.textContent = usuario.nome_usuario || 'Usuário';

        if (usuario.eh_artista && usuario.nome_artista) {
            dom.nomeArtista.textContent = usuario.nome_artista;
            dom.nomeArtista.classList.remove('hidden');
        } else {
            dom.nomeArtista.textContent = '';
            dom.nomeArtista.classList.add('hidden');
        }

        dom.bio.textContent = usuario.bio || '';
        dom.avatar.src = formatarImagem(usuario.avatar_url);
        dom.avatar.alt = `Avatar de ${usuario.nome_usuario || 'usuário'}`;
        dom.avatarPreview.src = formatarImagem(usuario.avatar_url);

        if (usuario.eh_artista) {
            const musicas = Number(estatisticas.musicas_enviadas) || 0;
            const reproducoes = Number(estatisticas.reproducoes) || 0;

            dom.estatisticas.textContent =
                `${musicas} ${
                    musicas === 1 ? 'música enviada' : 'músicas enviadas'
                } • ${reproducoes} ${
                    reproducoes === 1 ? 'reprodução' : 'reproduções'
                }`;

            dom.estatisticas.classList.remove('hidden');
        } else {
            dom.estatisticas.textContent = '';
            dom.estatisticas.classList.add('hidden');
        }

        dom.bioTextarea.value = usuario.bio || '';

        atualizarContadorBio();
        atualizarTema(usuario.tema);
        renderizarBanner(usuario.url_banner || null);
        renderizarFavorita(favorita);
        renderizarCurtidas(curtidas);
        renderizarPlaylists(playlists);

        mostrarConteudo();
    }

    function atualizarContadorBio() {
        if (!dom.bioContador) return;

        dom.bioContador.textContent =
            `${dom.bioTextarea.value.length}/${BIO_MAX}`;
    }

    function renderizarFavorita(favorita) {
        if (!dom.favoritaAtual || !dom.favoritaRemover) return;

        if (!favorita) {
            dom.favoritaAtual.textContent =
                'Nenhuma música escolhida.';

            dom.favoritaRemover.classList.add('hidden');
            return;
        }

        dom.favoritaAtual.textContent =
            `${favorita.titulo} — ${favorita.artista}`;

        dom.favoritaRemover.classList.remove('hidden');
    }

    function renderizarCurtidas(curtidas) {
        dom.curtidasLista.replaceChildren();

        dom.curtidasContador.textContent =
            `${curtidas.length}/${CURTIDAS_MAX}`;

        curtidas.forEach((musica) => {
            const item = document.createElement('div');
            item.className = 'perfil-item-atual';

            const capa = document.createElement('img');
            capa.className = 'perfil-item-atual-capa';
            capa.src = musica.url_capa || '';
            capa.alt = '';

            const texto = document.createElement('div');
            texto.className = 'perfil-item-atual-texto';

            const titulo = document.createElement('span');
            titulo.className = 'perfil-item-atual-titulo';
            titulo.textContent = musica.titulo;

            const subtitulo = document.createElement('span');
            subtitulo.className = 'perfil-item-atual-subtitulo';
            subtitulo.textContent = musica.artista;

            const remover = document.createElement('button');
            remover.type = 'button';
            remover.className = 'perfil-remover-item';
            remover.textContent = 'Remover';

            remover.addEventListener(
                'click',
                () => removerCurtida(musica.id)
            );

            texto.append(titulo, subtitulo);
            item.append(capa, texto, remover);

            dom.curtidasLista.appendChild(item);
        });
    }

    function renderizarPlaylists(playlists) {
        dom.playlistsLista.replaceChildren();

        if (playlists.length === 0) {
            const vazio = document.createElement('p');
            vazio.className = 'perfil-estado-mensagem';
            vazio.textContent =
                'Nenhuma playlist pública ainda.';

            dom.playlistsLista.appendChild(vazio);
            return;
        }

        playlists.forEach((playlist) => {
            const item = document.createElement('div');
            item.className = 'perfil-item-atual';

            const texto = document.createElement('div');
            texto.className = 'perfil-item-atual-texto';

            const titulo = document.createElement('span');
            titulo.className = 'perfil-item-atual-titulo';
            titulo.textContent = playlist.nome;

            const subtitulo = document.createElement('span');
            subtitulo.className = 'perfil-item-atual-subtitulo';

            const total = Number(playlist.total_faixas) || 0;

            subtitulo.textContent =
                `${total} ${total === 1 ? 'faixa' : 'faixas'}`;

            const remover = document.createElement('button');
            remover.type = 'button';
            remover.className = 'perfil-remover-item';
            remover.textContent = 'Excluir';

            remover.addEventListener(
                'click',
                () => removerPlaylist(playlist.id)
            );

            texto.append(titulo, subtitulo);
            item.append(texto, remover);

            dom.playlistsLista.appendChild(item);
        });
    }

    async function carregarPerfil() {
        const dados = await apiRequest('/api/perfil');
        renderizarPerfil(dados.perfil);
    }

    async function salvarBio(event) {
        event.preventDefault();

        const bio = dom.bioTextarea.value.trim();

        if (bio.length > BIO_MAX) {
            setStatus(
                dom.bioStatus,
                `A bio pode ter no máximo ${BIO_MAX} caracteres.`,
                true
            );
            return;
        }

        setStatus(dom.bioStatus, 'Salvando...');

        try {
            const dados = await apiRequest('/api/perfil/bio', {
                method: 'PUT',
                body: JSON.stringify({ bio })
            });

            dom.bio.textContent = dados.bio || '';

            perfilAtual.usuario.bio = dados.bio || null;

            setStatus(dom.bioStatus, 'Bio salva.');
        } catch (erro) {
            setStatus(dom.bioStatus, erro.message, true);
        }
    }

    async function enviarAvatar(arquivo) {
        if (!arquivo) return;

        const formData = new FormData();
        formData.append('avatar', arquivo);

        setStatus(dom.avatarStatus, 'Enviando avatar...');

        try {
            const dados = await apiRequest(
                '/api/perfil/avatar',
                {
                    method: 'POST',
                    body: formData
                }
            );

            const url = dados.avatar_url || null;

            perfilAtual.usuario.avatar_url = url;

            dom.avatar.src = formatarImagem(url);
            dom.avatarPreview.src = formatarImagem(url);

            setStatus(
                dom.avatarStatus,
                'Avatar atualizado.'
            );
        } catch (erro) {
            setStatus(
                dom.avatarStatus,
                erro.message,
                true
            );
        }
    }

    async function removerAvatar() {
        setStatus(
            dom.avatarStatus,
            'Removendo avatar...'
        );

        try {
            const dados = await apiRequest(
                '/api/perfil/avatar',
                {
                    method: 'DELETE'
                }
            );

            perfilAtual.usuario.avatar_url =
                dados.avatar_url || null;

            dom.avatar.src = AVATAR_PADRAO;
            dom.avatarPreview.src = AVATAR_PADRAO;

            setStatus(
                dom.avatarStatus,
                'Avatar removido.'
            );
        } catch (erro) {
            setStatus(
                dom.avatarStatus,
                erro.message,
                true
            );
        }
    }

    async function enviarBanner(arquivo) {
        if (!arquivo) return;

        const formData = new FormData();
        formData.append('banner', arquivo);

        setStatus(
            dom.bannerStatus,
            'Enviando banner...'
        );

        try {
            const dados = await apiRequest(
                '/api/perfil/banner',
                {
                    method: 'POST',
                    body: formData
                }
            );

            const url = dados.url_banner || null;

            perfilAtual.usuario.url_banner = url;

            renderizarBanner(url);

            setStatus(
                dom.bannerStatus,
                'Banner atualizado.'
            );
        } catch (erro) {
            setStatus(
                dom.bannerStatus,
                erro.status === 404
                    ? 'A rota de banner ainda não está instalada no backend.'
                    : erro.message,
                true
            );
        }
    }

    async function removerBanner() {
        setStatus(
            dom.bannerStatus,
            'Removendo banner...'
        );

        try {
            const dados = await apiRequest(
                '/api/perfil/banner',
                {
                    method: 'DELETE'
                }
            );

            perfilAtual.usuario.url_banner =
                dados.url_banner || null;

            renderizarBanner(null);

            setStatus(
                dom.bannerStatus,
                'Banner removido.'
            );
        } catch (erro) {
            setStatus(
                dom.bannerStatus,
                erro.status === 404
                    ? 'A rota de banner ainda não está instalada no backend.'
                    : erro.message,
                true
            );
        }
    }

    async function alternarTema() {
        const atual =
            document.documentElement.dataset.theme === 'light'
                ? 'light'
                : 'dark';

        const proximo =
            atual === 'light'
                ? 'dark'
                : 'light';

        setStatus(
            dom.temaStatus,
            'Salvando tema...'
        );

        try {
            const dados = await apiRequest(
                '/api/perfil/tema',
                {
                    method: 'PUT',
                    body: JSON.stringify({
                        tema: proximo
                    })
                }
            );

            atualizarTema(
                dados.tema || proximo
            );

            perfilAtual.usuario.tema =
                dados.tema || proximo;

            setStatus(
                dom.temaStatus,
                `Tema ${
                    dados.tema === 'light'
                        ? 'claro'
                        : 'escuro'
                } salvo.`
            );
        } catch (erro) {
            setStatus(
                dom.temaStatus,
                erro.message,
                true
            );
        }
    }

    function renderizarResultadosBusca(
        container,
        musicas,
        aoSelecionar,
        indisponiveis = new Set()
    ) {
        container.replaceChildren();

        if (!musicas.length) {
            const vazio =
                document.createElement('p');

            vazio.className =
                'perfil-estado-mensagem';

            vazio.textContent =
                'Nenhuma música encontrada.';

            container.appendChild(vazio);

            return;
        }

        musicas.slice(0, 10).forEach((musica) => {
            const botao =
                document.createElement('button');

            botao.type = 'button';
            botao.className =
                'perfil-resultado-item';

            botao.disabled =
                indisponiveis.has(musica.id);

            const capa =
                document.createElement('img');

            capa.className =
                'perfil-resultado-capa';

            capa.src =
                musica.url_capa || '';

            capa.alt = '';

            const texto =
                document.createElement('span');

            texto.className =
                'perfil-resultado-texto';

            const titulo =
                document.createElement('span');

            titulo.className =
                'perfil-resultado-titulo';

            titulo.textContent =
                musica.titulo;

            const artista =
                document.createElement('span');

            artista.className =
                'perfil-resultado-artista';

            artista.textContent =
                musica.artista;

            texto.append(
                titulo,
                artista
            );

            botao.append(
                capa,
                texto
            );

            botao.addEventListener(
                'click',
                () => aoSelecionar(musica)
            );

            container.appendChild(
                botao
            );
        });
    }

    function configurarBuscaMusicas(
        input,
        resultados,
        aoSelecionar,
        getIndisponiveis
    ) {
        let timeout = null;

        input.addEventListener(
            'input',
            () => {
                window.clearTimeout(timeout);

                const termo =
                    input.value.trim();

                if (termo.length < 2) {
                    resultados.replaceChildren();
                    return;
                }

                resultados.replaceChildren();

                const carregando =
                    document.createElement('p');

                carregando.className =
                    'perfil-estado-mensagem';

                carregando.textContent =
                    'Buscando...';

                resultados.appendChild(
                    carregando
                );

                timeout =
                    window.setTimeout(
                        async () => {
                            try {
                                const dados =
                                    await apiRequest(
                                        `/api/musicas/buscar?q=${encodeURIComponent(termo)}`,
                                        {
                                            method: 'GET'
                                        }
                                    );

                                renderizarResultadosBusca(
                                    resultados,
                                    Array.isArray(dados.musicas)
                                        ? dados.musicas
                                        : [],
                                    aoSelecionar,
                                    getIndisponiveis()
                                );
                            } catch (erro) {
                                resultados.replaceChildren();

                                const erroEl =
                                    document.createElement('p');

                                erroEl.className =
                                    'perfil-estado-mensagem';

                                erroEl.textContent =
                                    erro.message;

                                resultados.appendChild(
                                    erroEl
                                );
                            }
                        },
                        250
                    );
            }
        );
    }

    async function selecionarFavorita(musica) {
        try {
            const dados =
                await apiRequest(
                    '/api/perfil/favorita',
                    {
                        method: 'PUT',
                        body: JSON.stringify({
                            musicaId: musica.id
                        })
                    }
                );

            perfilAtual.favorita =
                dados.favorita || null;

            renderizarFavorita(
                perfilAtual.favorita
            );

            dom.favoritaFiltro.value = '';
            dom.favoritaResultados.replaceChildren();
        } catch (erro) {
            const mensagem =
                document.createElement('p');

            mensagem.className =
                'perfil-estado-mensagem';

            mensagem.textContent =
                erro.message;

            dom.favoritaResultados.replaceChildren(
                mensagem
            );
        }
    }

    async function removerFavorita() {
        try {
            const dados =
                await apiRequest(
                    '/api/perfil/favorita',
                    {
                        method: 'DELETE'
                    }
                );

            perfilAtual.favorita =
                dados.favorita || null;

            renderizarFavorita(
                perfilAtual.favorita
            );
        } catch (erro) {
            setStatus(
                dom.bioStatus,
                erro.message,
                true
            );
        }
    }

    async function salvarCurtidas(
        novasCurtidas
    ) {
        const ids =
            novasCurtidas.map(
                (musica) => musica.id
            );

        if (ids.length > CURTIDAS_MAX) {
            throw new Error(
                `Você pode destacar no máximo ${CURTIDAS_MAX} músicas.`
            );
        }

        const dados =
            await apiRequest(
                '/api/perfil/curtidas',
                {
                    method: 'PUT',
                    body: JSON.stringify({
                        musicaIds: ids
                    })
                }
            );

        perfilAtual.curtidas =
            Array.isArray(dados.curtidas)
                ? dados.curtidas
                : [];

        renderizarCurtidas(
            perfilAtual.curtidas
        );
    }

    async function adicionarCurtida(
        musica
    ) {
        const curtidas =
            Array.isArray(
                perfilAtual.curtidas
            )
                ? [...perfilAtual.curtidas]
                : [];

        if (
            curtidas.some(
                (item) =>
                    item.id === musica.id
            )
        ) {
            return;
        }

        if (
            curtidas.length >=
            CURTIDAS_MAX
        ) {
            const mensagem =
                document.createElement('p');

            mensagem.className =
                'perfil-estado-mensagem';

            mensagem.textContent =
                `O limite é ${CURTIDAS_MAX} músicas.`;

            dom.curtidasResultados.replaceChildren(
                mensagem
            );

            return;
        }

        try {
            await salvarCurtidas([
                ...curtidas,
                musica
            ]);

            dom.curtidasFiltro.value = '';
            dom.curtidasResultados.replaceChildren();
        } catch (erro) {
            const mensagem =
                document.createElement('p');

            mensagem.className =
                'perfil-estado-mensagem';

            mensagem.textContent =
                erro.message;

            dom.curtidasResultados.replaceChildren(
                mensagem
            );
        }
    }

    async function removerCurtida(id) {
        const curtidas =
            Array.isArray(
                perfilAtual.curtidas
            )
                ? perfilAtual.curtidas
                : [];

        const restantes =
            curtidas.filter(
                (musica) =>
                    musica.id !== id
            );

        try {
            await salvarCurtidas(
                restantes
            );
        } catch (erro) {
            const mensagem =
                document.createElement('p');

            mensagem.className =
                'perfil-estado-mensagem';

            mensagem.textContent =
                erro.message;

            dom.curtidasLista.appendChild(
                mensagem
            );
        }
    }

    async function criarPlaylist(event) {
        event.preventDefault();

        const nome =
            dom.playlistNome.value.trim();

        if (!nome) return;

        try {
            const dados =
                await apiRequest(
                    '/api/perfil/playlists',
                    {
                        method: 'POST',
                        body: JSON.stringify({
                            nome
                        })
                    }
                );

            perfilAtual.playlists = [
                ...(perfilAtual.playlists || []),
                dados.playlist
            ];

            renderizarPlaylists(
                perfilAtual.playlists
            );

            dom.playlistNome.value = '';
        } catch (erro) {
            const mensagem =
                document.createElement('p');

            mensagem.className =
                'perfil-estado-mensagem';

            mensagem.textContent =
                erro.message;

            dom.playlistsLista.prepend(
                mensagem
            );
        }
    }

    async function removerPlaylist(id) {
        try {
            await apiRequest(
                `/api/perfil/playlists/${encodeURIComponent(id)}`,
                {
                    method: 'DELETE'
                }
            );

            perfilAtual.playlists =
                (perfilAtual.playlists || [])
                    .filter(
                        (playlist) =>
                            playlist.id !== id
                    );

            renderizarPlaylists(
                perfilAtual.playlists
            );
        } catch (erro) {
            const mensagem =
                document.createElement('p');

            mensagem.className =
                'perfil-estado-mensagem';

            mensagem.textContent =
                erro.message;

            dom.playlistsLista.prepend(
                mensagem
            );
        }
    }

    function configurarEventos() {
        dom.bioTextarea.addEventListener(
            'input',
            atualizarContadorBio
        );

        dom.bioForm.addEventListener(
            'submit',
            salvarBio
        );

        dom.avatarEnviar.addEventListener(
            'click',
            () =>
                dom.avatarInput.click()
        );

        dom.avatarInput.addEventListener(
            'change',
            () => {
                const arquivo =
                    dom.avatarInput.files?.[0] ||
                    null;

                dom.avatarInput.value = '';

                enviarAvatar(
                    arquivo
                );
            }
        );

        dom.avatarRemover.addEventListener(
            'click',
            removerAvatar
        );

        dom.bannerEnviar.addEventListener(
            'click',
            () =>
                dom.bannerInput.click()
        );

        dom.bannerInput.addEventListener(
            'change',
            () => {
                const arquivo =
                    dom.bannerInput.files?.[0] ||
                    null;

                dom.bannerInput.value = '';

                enviarBanner(
                    arquivo
                );
            }
        );

        dom.bannerRemover.addEventListener(
            'click',
            removerBanner
        );

        dom.temaBtn.addEventListener(
            'click',
            alternarTema
        );

        dom.favoritaRemover.addEventListener(
            'click',
            removerFavorita
        );

        configurarBuscaMusicas(
            dom.favoritaFiltro,
            dom.favoritaResultados,
            selecionarFavorita,
            () => new Set()
        );

        configurarBuscaMusicas(
            dom.curtidasFiltro,
            dom.curtidasResultados,
            adicionarCurtida,
            () =>
                new Set(
                    (
                        perfilAtual?.curtidas ||
                        []
                    ).map(
                        (musica) =>
                            musica.id
                    )
                )
        );

        dom.playlistForm.addEventListener(
            'submit',
            criarPlaylist
        );
    }

    async function iniciar() {
        if (!getToken()) {
            mostrarBloqueado();
            return;
        }

        try {
            configurarEventos();
            await carregarPerfil();
        } catch (erro) {
            if (erro.status === 401) return;

            mostrarBloqueado();

            const texto =
                dom.bloqueado?.querySelector(
                    '.perfil-bloqueado-texto'
                );

            if (texto) {
                texto.textContent =
                    erro.message ||
                    'Não foi possível carregar o perfil.';
            }
        }
    }

    document.addEventListener(
        'DOMContentLoaded',
        iniciar
    );
})();