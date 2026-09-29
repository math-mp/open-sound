(() => {
    'use strict';

    const API_BASE =
        window.location.port === '3000'
            ? ''
            : 'http://localhost:3000';

    const TOKEN_KEY = 'tokenSessao';

    const AVATAR_PADRAO =
        '../assets/avatar-padrao.png';

    const BIO_MAX = 220;
    const CURTIDAS_MAX = 4;

    const AVATAR_EVENTO =
        'opensound:avatar-atualizado';

    const AVATAR_CANAL =
        'opensound-perfil';

    let perfilAtual = null;
    let canalAvatar = null;

    const $ = (seletor) =>
        document.querySelector(seletor);

    const dom = {
        bloqueado: $('#perfil-bloqueado'),
        conteudo: $('#perfil-conteudo'),

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

        banner: $('#perfil-banner'),
        bannerImg: $('#perfil-banner-img'),
        bannerVazio: $('#perfil-banner-vazio'),

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
        constructor(message, status, data) {
            super(message);
            this.status = status;
            this.data = data;
        }
    }


    function getToken() {
        return localStorage.getItem(TOKEN_KEY);
    }


    function imagem(url) {
        return url || AVATAR_PADRAO;
    }


    function mostrarBloqueado(mensagem) {
        dom.bloqueado?.classList.remove('hidden');
        dom.conteudo?.classList.add('hidden');

        if (mensagem) {
            const texto =
                dom.bloqueado?.querySelector(
                    '.perfil-bloqueado-texto'
                );

            if (texto) {
                texto.textContent = mensagem;
            }
        }
    }


    function mostrarConteudo(carregando = false) {
        dom.bloqueado?.classList.add('hidden');
        dom.conteudo?.classList.remove('hidden');

        dom.conteudo?.setAttribute(
            'aria-busy',
            carregando ? 'true' : 'false'
        );
    }


    function status(elemento, mensagem, erro = false) {
        if (!elemento) return;

        elemento.textContent =
            mensagem || '';

        elemento.dataset.estado =
            erro ? 'erro' : 'ok';
    }


    async function api(path, options = {}) {
        const headers =
            new Headers(options.headers || {});

        const token = getToken();

        if (token) {
            headers.set(
                'Authorization',
                `Bearer ${token}`
            );
        }

        if (
            options.body &&
            !(options.body instanceof FormData) &&
            !headers.has('Content-Type')
        ) {
            headers.set(
                'Content-Type',
                'application/json'
            );
        }

        let response;

        try {
            const method =
                String(options.method || 'GET')
                    .toUpperCase();

            response = await fetch(
                `${API_BASE}${path}`,
                {
                    ...options,

                    cache:
                        method === 'GET'
                            ? 'no-store'
                            : options.cache,

                    headers
                }
            );
        } catch {
            throw new Error(
                'Não foi possível conectar ao servidor.'
            );
        }

        let data = {};

        if (
            (
                response.headers
                    .get('content-type') || ''
            ).includes('application/json')
        ) {
            try {
                data = await response.json();
            } catch {
                data = {};
            }
        }

        if (response.status === 401) {
            localStorage.removeItem(
                TOKEN_KEY
            );

            mostrarBloqueado(
                'Sua sessão expirou. Faça login novamente.'
            );

            throw new ApiErro(
                'Sua sessão expirou. Faça login novamente.',
                401,
                data
            );
        }

        if (!response.ok) {
            throw new ApiErro(
                data?.mensagem ||
                    'A operação não pôde ser concluída.',
                response.status,
                data
            );
        }

        return data;
    }


    /* =========================================================
       AVATAR GLOBAL
       ========================================================= */

    function atualizarAvatares(url) {
        const src = imagem(url);

        document
            .querySelectorAll(
                '.btn-perfil-avatar img'
            )
            .forEach((img) => {
                img.src = src;
            });

        if (dom.avatar) {
            dom.avatar.src = src;
        }

        if (dom.avatarPreview) {
            dom.avatarPreview.src = src;
        }
    }


    function ouvirAvatar() {
        window.addEventListener(
            AVATAR_EVENTO,
            (event) => {
                atualizarAvatares(
                    event.detail?.avatarUrl ||
                    null
                );
            }
        );

        if (
            !('BroadcastChannel' in window)
        ) {
            return;
        }

        try {
            canalAvatar =
                new BroadcastChannel(
                    AVATAR_CANAL
                );

            canalAvatar.onmessage =
                (event) => {
                    atualizarAvatares(
                        event.data?.avatarUrl ||
                        null
                    );
                };
        } catch {
            canalAvatar = null;
        }
    }


    function avisarAvatar(url) {
        const detalhe = {
            avatarUrl: url || null
        };

        window.dispatchEvent(
            new CustomEvent(
                AVATAR_EVENTO,
                { detail: detalhe }
            )
        );

        try {
            canalAvatar?.postMessage(
                detalhe
            );
        } catch {
            // Atualização local continua funcionando.
        }
    }


    /* =========================================================
       TEMA
       ========================================================= */

    function renderTema(tema) {
        document.documentElement.dataset.theme =
            tema === 'light'
                ? 'light'
                : 'dark';
    }


    /* =========================================================
       BANNER
       ========================================================= */

    function renderBanner(url) {
        const possuiBanner =
            Boolean(url);

        dom.bannerImg?.classList.toggle(
            'hidden',
            !possuiBanner
        );

        dom.bannerVazio?.classList.toggle(
            'hidden',
            possuiBanner
        );

        dom.bannerPreview?.classList.toggle(
            'hidden',
            !possuiBanner
        );

        dom.bannerPreviewVazio?.classList.toggle(
            'hidden',
            possuiBanner
        );

        if (dom.bannerImg) {
            dom.bannerImg.src =
                possuiBanner
                    ? url
                    : '';
        }

        if (dom.bannerPreview) {
            dom.bannerPreview.src =
                possuiBanner
                    ? url
                    : '';
        }
    }


    /* =========================================================
       FAVORITA
       ========================================================= */

    function renderFavorita(favorita) {
        if (!favorita) {
            dom.favoritaAtual.textContent =
                'Nenhuma música escolhida.';

            dom.favoritaRemover
                .classList
                .add('hidden');

            return;
        }

        dom.favoritaAtual.textContent =
            `${favorita.titulo} — ${favorita.artista}`;

        dom.favoritaRemover
            .classList
            .remove('hidden');
    }


    /* =========================================================
       ITENS DA BIBLIOTECA
       ========================================================= */

    function criarItemAtual(
        musica,
        removerFn,
        textoRemover = 'Remover'
    ) {
        const item =
            document.createElement('div');

        item.className =
            'perfil-item-atual';

        if (musica.url_capa) {
            const capa =
                document.createElement('img');

            capa.className =
                'perfil-item-atual-capa';

            capa.src =
                musica.url_capa;

            capa.alt = '';

            item.appendChild(capa);
        }

        const texto =
            document.createElement('div');

        texto.className =
            'perfil-item-atual-texto';

        const titulo =
            document.createElement('span');

        titulo.className =
            'perfil-item-atual-titulo';

        titulo.textContent =
            musica.nome ||
            musica.titulo ||
            'Sem nome';

        const subtitulo =
            document.createElement('span');

        subtitulo.className =
            'perfil-item-atual-subtitulo';

        subtitulo.textContent =
            musica.artista || '';

        texto.append(
            titulo,
            subtitulo
        );

        item.appendChild(texto);

        if (removerFn) {
            const botao =
                document.createElement('button');

            botao.type = 'button';

            botao.className =
                'perfil-remover-item';

            botao.textContent =
                textoRemover;

            botao.addEventListener(
                'click',
                removerFn
            );

            item.appendChild(botao);
        }

        return item;
    }


    function renderCurtidas(curtidas) {
        dom.curtidasLista
            .replaceChildren();

        dom.curtidasContador.textContent =
            `${curtidas.length}/${CURTIDAS_MAX}`;

        curtidas.forEach((musica) => {
            dom.curtidasLista.appendChild(
                criarItemAtual(
                    musica,
                    () =>
                        removerCurtida(musica.id)
                )
            );
        });
    }


    function renderPlaylists(playlists) {
        dom.playlistsLista
            .replaceChildren();

        if (!playlists.length) {
            const vazio =
                document.createElement('p');

            vazio.className =
                'perfil-estado-mensagem';

            vazio.textContent =
                'Nenhuma playlist pública ainda.';

            dom.playlistsLista.appendChild(
                vazio
            );

            return;
        }

        playlists.forEach((playlist) => {
            const total =
                Number(
                    playlist.total_faixas
                ) || 0;

            dom.playlistsLista.appendChild(
                criarItemAtual(
                    {
                        nome: playlist.nome,
                        artista:
                            `${total} ${
                                total === 1
                                    ? 'faixa'
                                    : 'faixas'
                            }`
                    },
                    () =>
                        removerPlaylist(
                            playlist.id
                        ),
                    'Excluir'
                )
            );
        });
    }


    /* =========================================================
       PERFIL
       ========================================================= */

    function renderPerfil(perfil) {
        perfilAtual = perfil;

        const usuario =
            perfil?.usuario || {};

        const estatisticas =
            perfil?.estatisticas || {};

        dom.nome.textContent =
            usuario.nome_usuario ||
            'Usuário';

        dom.bio.textContent =
            usuario.bio || '';

        dom.avatar.alt =
            `Avatar de ${
                usuario.nome_usuario ||
                'usuário'
            }`;

        atualizarAvatares(
            usuario.avatar_url || null
        );

        if (
            usuario.eh_artista &&
            usuario.nome_artista
        ) {
            dom.nomeArtista.textContent =
                usuario.nome_artista;

            dom.nomeArtista
                .classList
                .remove('hidden');

            const musicas =
                Number(
                    estatisticas.musicas_enviadas
                ) || 0;

            const reproducoes =
                Number(
                    estatisticas.reproducoes
                ) || 0;

            dom.estatisticas.textContent =
                `${musicas} ${
                    musicas === 1
                        ? 'música enviada'
                        : 'músicas enviadas'
                } • ${reproducoes} ${
                    reproducoes === 1
                        ? 'reprodução'
                        : 'reproduções'
                }`;

            dom.estatisticas
                .classList
                .remove('hidden');
        } else {
            dom.nomeArtista
                .classList
                .add('hidden');

            dom.estatisticas
                .classList
                .add('hidden');
        }

        dom.bioTextarea.value =
            usuario.bio || '';

        dom.bioContador.textContent =
            `${dom.bioTextarea.value.length}/${BIO_MAX}`;

        renderTema(usuario.tema);

        renderBanner(
            usuario.url_banner || null
        );

        renderFavorita(
            perfil?.favorita || null
        );

        renderCurtidas(
            Array.isArray(
                perfil?.curtidas
            )
                ? perfil.curtidas
                : []
        );

        renderPlaylists(
            Array.isArray(
                perfil?.playlists
            )
                ? perfil.playlists
                : []
        );

        mostrarConteudo(false);
    }


    async function carregarPerfil() {
        const data =
            await api('/api/perfil');

        renderPerfil(
            data.perfil
        );
    }


    /* =========================================================
       BUSCA DE MÚSICAS
       ========================================================= */

    function renderResultados(
        container,
        musicas,
        callback,
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

            container.appendChild(
                vazio
            );

            return;
        }

        musicas
            .slice(0, 10)
            .forEach((musica) => {

                const botao =
                    document.createElement('button');

                botao.type = 'button';

                botao.className =
                    'perfil-resultado-item';

                botao.disabled =
                    indisponiveis.has(
                        musica.id
                    );

                if (musica.url_capa) {
                    const capa =
                        document.createElement('img');

                    capa.className =
                        'perfil-resultado-capa';

                    capa.src =
                        musica.url_capa;

                    capa.alt = '';

                    botao.appendChild(
                        capa
                    );
                }

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

                botao.appendChild(
                    texto
                );

                botao.addEventListener(
                    'click',
                    () =>
                        callback(musica)
                );

                container.appendChild(
                    botao
                );
            });
    }


    function configurarBusca(
        input,
        container,
        callback,
        getIndisponiveis
    ) {
        let timer = null;

        input.addEventListener(
            'input',
            () => {
                clearTimeout(timer);

                const termo =
                    input.value.trim();

                if (termo.length < 2) {
                    container.replaceChildren();
                    return;
                }

                const loading =
                    document.createElement('p');

                loading.className =
                    'perfil-estado-mensagem';

                loading.textContent =
                    'Buscando...';

                container.replaceChildren(
                    loading
                );

                timer =
                    setTimeout(
                        async () => {
                            try {
                                const data =
                                    await api(
                                        `/api/musicas/buscar?q=${encodeURIComponent(termo)}`
                                    );

                                renderResultados(
                                    container,
                                    Array.isArray(
                                        data.musicas
                                    )
                                        ? data.musicas
                                        : [],
                                    callback,
                                    getIndisponiveis()
                                );
                            } catch (error) {
                                const msg =
                                    document.createElement('p');

                                msg.className =
                                    'perfil-estado-mensagem';

                                msg.textContent =
                                    error.message;

                                container.replaceChildren(
                                    msg
                                );
                            }
                        },
                        250
                    );
            }
        );
    }


    /* =========================================================
       BIO
       ========================================================= */

    async function salvarBio(event) {
        event.preventDefault();

        const bio =
            dom.bioTextarea.value.trim();

        if (bio.length > BIO_MAX) {
            status(
                dom.bioStatus,
                `A bio pode ter no máximo ${BIO_MAX} caracteres.`,
                true
            );

            return;
        }

        status(
            dom.bioStatus,
            'Salvando...'
        );

        try {
            const data =
                await api(
                    '/api/perfil/bio',
                    {
                        method: 'PUT',
                        body:
                            JSON.stringify({
                                bio
                            })
                    }
                );

            perfilAtual.usuario.bio =
                data.bio || null;

            dom.bio.textContent =
                data.bio || '';

            status(
                dom.bioStatus,
                'Bio salva.'
            );
        } catch (error) {
            status(
                dom.bioStatus,
                error.message,
                true
            );
        }
    }


    /* =========================================================
       AVATAR
       ========================================================= */

    async function enviarAvatar(file) {
        if (!file) return;

        const form =
            new FormData();

        form.append(
            'avatar',
            file
        );

        status(
            dom.avatarStatus,
            'Enviando avatar...'
        );

        try {
            const data =
                await api(
                    '/api/perfil/avatar',
                    {
                        method: 'POST',
                        body: form
                    }
                );

            const url =
                data.avatar_url ||
                null;

            perfilAtual.usuario.avatar_url =
                url;

            atualizarAvatares(url);
            avisarAvatar(url);

            status(
                dom.avatarStatus,
                'Avatar atualizado.'
            );
        } catch (error) {
            status(
                dom.avatarStatus,
                error.message,
                true
            );
        }
    }


    async function removerAvatar() {
        status(
            dom.avatarStatus,
            'Removendo avatar...'
        );

        try {
            const data =
                await api(
                    '/api/perfil/avatar',
                    {
                        method: 'DELETE'
                    }
                );

            const url =
                data.avatar_url ||
                null;

            perfilAtual.usuario.avatar_url =
                url;

            atualizarAvatares(url);
            avisarAvatar(url);

            status(
                dom.avatarStatus,
                'Avatar removido.'
            );
        } catch (error) {
            status(
                dom.avatarStatus,
                error.message,
                true
            );
        }
    }


    /* =========================================================
       BANNER
       ========================================================= */

    async function enviarBanner(file) {
        if (!file) return;

        const form =
            new FormData();

        form.append(
            'banner',
            file
        );

        status(
            dom.bannerStatus,
            'Enviando banner...'
        );

        try {
            const data =
                await api(
                    '/api/perfil/banner',
                    {
                        method: 'POST',
                        body: form
                    }
                );

            perfilAtual.usuario.url_banner =
                data.url_banner ||
                null;

            renderBanner(
                perfilAtual.usuario.url_banner
            );

            status(
                dom.bannerStatus,
                'Banner atualizado.'
            );
        } catch (error) {
            status(
                dom.bannerStatus,
                error.status === 404
                    ? 'A rota de banner ainda não está instalada no backend.'
                    : error.message,
                true
            );
        }
    }


    async function removerBanner() {
        status(
            dom.bannerStatus,
            'Removendo banner...'
        );

        try {
            const data =
                await api(
                    '/api/perfil/banner',
                    {
                        method: 'DELETE'
                    }
                );

            perfilAtual.usuario.url_banner =
                data.url_banner ||
                null;

            renderBanner(null);

            status(
                dom.bannerStatus,
                'Banner removido.'
            );
        } catch (error) {
            status(
                dom.bannerStatus,
                error.status === 404
                    ? 'A rota de banner ainda não está instalada no backend.'
                    : error.message,
                true
            );
        }
    }


    /* =========================================================
       TEMA
       ========================================================= */

    async function alternarTema() {
        const atual =
            document.documentElement.dataset.theme === 'light'
                ? 'light'
                : 'dark';

        const proximo =
            atual === 'light'
                ? 'dark'
                : 'light';

        status(
            dom.temaStatus,
            'Salvando tema...'
        );

        try {
            const data =
                await api(
                    '/api/perfil/tema',
                    {
                        method: 'PUT',
                        body:
                            JSON.stringify({
                                tema: proximo
                            })
                    }
                );

            renderTema(
                data.tema ||
                proximo
            );

            perfilAtual.usuario.tema =
                data.tema ||
                proximo;

            status(
                dom.temaStatus,
                'Tema salvo.'
            );
        } catch (error) {
            status(
                dom.temaStatus,
                error.message,
                true
            );
        }
    }


    /* =========================================================
       FAVORITA
       ========================================================= */

    async function selecionarFavorita(musica) {
        try {
            const data =
                await api(
                    '/api/perfil/favorita',
                    {
                        method: 'PUT',
                        body:
                            JSON.stringify({
                                musicaId:
                                    musica.id
                            })
                    }
                );

            perfilAtual.favorita =
                data.favorita ||
                musica;

            renderFavorita(
                perfilAtual.favorita
            );

            dom.favoritaFiltro.value =
                '';

            dom.favoritaResultados
                .replaceChildren();
        } catch (error) {
            const msg =
                document.createElement('p');

            msg.className =
                'perfil-estado-mensagem';

            msg.textContent =
                error.message;

            dom.favoritaResultados
                .replaceChildren(msg);
        }
    }


    async function removerFavorita() {
        try {
            const data =
                await api(
                    '/api/perfil/favorita',
                    {
                        method: 'DELETE'
                    }
                );

            perfilAtual.favorita =
                data.favorita ||
                null;

            renderFavorita(null);
        } catch (error) {
            status(
                dom.bioStatus,
                error.message,
                true
            );
        }
    }


    /* =========================================================
       CURTIDAS
       ========================================================= */

    async function salvarCurtidas(lista) {
        if (
            lista.length >
            CURTIDAS_MAX
        ) {
            throw new Error(
                `O limite é ${CURTIDAS_MAX} músicas.`
            );
        }

        const data =
            await api(
                '/api/perfil/curtidas',
                {
                    method: 'PUT',
                    body:
                        JSON.stringify({
                            musicaIds:
                                lista.map(
                                    (musica) =>
                                        musica.id
                                )
                        })
                }
            );

        perfilAtual.curtidas =
            Array.isArray(
                data.curtidas
            )
                ? data.curtidas
                : lista;

        renderCurtidas(
            perfilAtual.curtidas
        );
    }


    async function adicionarCurtida(musica) {
        const atuais =
            Array.isArray(
                perfilAtual.curtidas
            )
                ? perfilAtual.curtidas
                : [];

        if (
            atuais.some(
                (item) =>
                    item.id === musica.id
            )
        ) {
            return;
        }

        if (
            atuais.length >=
            CURTIDAS_MAX
        ) {
            const msg =
                document.createElement('p');

            msg.className =
                'perfil-estado-mensagem';

            msg.textContent =
                `O limite é ${CURTIDAS_MAX} músicas.`;

            dom.curtidasResultados
                .replaceChildren(msg);

            return;
        }

        try {
            await salvarCurtidas([
                ...atuais,
                musica
            ]);

            dom.curtidasFiltro.value =
                '';

            dom.curtidasResultados
                .replaceChildren();
        } catch (error) {
            const msg =
                document.createElement('p');

            msg.className =
                'perfil-estado-mensagem';

            msg.textContent =
                error.message;

            dom.curtidasResultados
                .replaceChildren(msg);
        }
    }


    async function removerCurtida(id) {
        const atuais =
            Array.isArray(
                perfilAtual.curtidas
            )
                ? perfilAtual.curtidas
                : [];

        try {
            await salvarCurtidas(
                atuais.filter(
                    (musica) =>
                        musica.id !== id
                )
            );
        } catch (error) {
            status(
                dom.curtidasContador,
                error.message,
                true
            );
        }
    }


    /* =========================================================
       PLAYLISTS
       ========================================================= */

    async function criarPlaylist(event) {
        event.preventDefault();

        const nome =
            dom.playlistNome.value.trim();

        if (!nome) return;

        try {
            const data =
                await api(
                    '/api/perfil/playlists',
                    {
                        method: 'POST',
                        body:
                            JSON.stringify({
                                nome
                            })
                    }
                );

            perfilAtual.playlists = [
                ...(perfilAtual.playlists || []),
                data.playlist
            ];

            renderPlaylists(
                perfilAtual.playlists
            );

            dom.playlistNome.value =
                '';
        } catch (error) {
            const msg =
                document.createElement('p');

            msg.className =
                'perfil-estado-mensagem';

            msg.textContent =
                error.message;

            dom.playlistsLista.prepend(msg);
        }
    }


    async function removerPlaylist(id) {
        try {
            await api(
                `/api/perfil/playlists/${encodeURIComponent(id)}`,
                {
                    method: 'DELETE'
                }
            );

            perfilAtual.playlists =
                (
                    perfilAtual.playlists ||
                    []
                ).filter(
                    (playlist) =>
                        playlist.id !== id
                );

            renderPlaylists(
                perfilAtual.playlists
            );
        } catch (error) {
            const msg =
                document.createElement('p');

            msg.className =
                'perfil-estado-mensagem';

            msg.textContent =
                error.message;

            dom.playlistsLista
                .prepend(msg);
        }
    }


    /* =========================================================
       EVENTOS
       ========================================================= */

    function configurarEventos() {

        dom.bioTextarea.addEventListener(
            'input',
            () => {
                dom.bioContador.textContent =
                    `${dom.bioTextarea.value.length}/${BIO_MAX}`;
            }
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
                const file =
                    dom.avatarInput.files?.[0] ||
                    null;

                dom.avatarInput.value =
                    '';

                enviarAvatar(file);
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
                const file =
                    dom.bannerInput.files?.[0] ||
                    null;

                dom.bannerInput.value =
                    '';

                enviarBanner(file);
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


        configurarBusca(
            dom.favoritaFiltro,
            dom.favoritaResultados,
            selecionarFavorita,
            () => new Set()
        );


        configurarBusca(
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


    /* =========================================================
       INICIALIZAÇÃO
       ========================================================= */

    async function iniciar() {
        ouvirAvatar();

        if (!getToken()) {
            mostrarBloqueado();
            return;
        }

        /*
         * O layout fica visível imediatamente.
         * A API carrega em seguida.
         */
        mostrarConteudo(true);

        try {
            configurarEventos();

            await carregarPerfil();
        } catch (error) {
            if (error.status === 401) {
                return;
            }

            mostrarBloqueado(
                error.message ||
                'Não foi possível carregar o perfil.'
            );
        }
    }


    if (
        document.readyState ===
        'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            iniciar,
            { once: true }
        );
    } else {
        iniciar();
    }

})();