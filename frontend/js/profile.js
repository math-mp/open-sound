/* ============================================================
   OPENSOUND — PROFILE.JS
   ============================================================ */

(() => {
    'use strict';


    /* =========================================================
       CONFIGURAÇÃO
       ========================================================= */

    const API_BASE = (() => {

        return (
            window.location.origin === 'null' ||
            window.location.port !== '3000'
        )
            ? 'http://localhost:3000'
            : '';

    })();


    const TOKEN_KEY = 'tokenSessao';

    const BIO_MAX = 220;

    const CURTIDAS_MAX = 4;

    const AVATAR_PADRAO =
        '../assets/avatar-padrao.png';


    /* =========================================================
       ESTADO
       ========================================================= */

    let perfilAtual = null;

    let canalAvatar = null;


    /* =========================================================
       EVENTOS DE AVATAR
       ========================================================= */

    const EVENTO_AVATAR =
        'opensound:avatar-atualizado';

    const CANAL_AVATAR =
        'opensound-perfil';


    /* =========================================================
       DOM
       ========================================================= */

    const $ = (seletor) =>
        document.querySelector(seletor);


    const dom = {

        bloqueado:
            $('#perfil-bloqueado'),

        conteudo:
            $('#perfil-conteudo'),


        /* PERFIL */

        banner:
            $('#perfil-banner'),

        bannerImg:
            $('#perfil-banner-img'),

        bannerVazio:
            $('#perfil-banner-vazio'),

        avatar:
            $('#perfil-avatar'),

        nome:
            $('#perfil-nome'),

        nomeArtista:
            $('#perfil-nome-artista'),

        bio:
            $('#perfil-bio'),

        estatisticas:
            $('#perfil-estatisticas'),


        /* AVATAR */

        avatarInput:
            $('#config-avatar-input'),

        avatarPreview:
            $('#config-avatar-preview'),

        avatarEnviar:
            $('#config-avatar-enviar'),

        avatarRemover:
            $('#config-avatar-remover'),

        avatarStatus:
            $('#config-avatar-status'),


        /* BANNER */

        bannerInput:
            $('#config-banner-input'),

        bannerPreview:
            $('#config-banner-preview-img'),

        bannerPreviewVazio:
            $('#config-banner-preview-vazio'),

        bannerEnviar:
            $('#config-banner-enviar'),

        bannerRemover:
            $('#config-banner-remover'),

        bannerStatus:
            $('#config-banner-status'),


        /* BIO */

        bioForm:
            $('#config-bio-form'),

        bioTextarea:
            $('#config-bio-textarea'),

        bioContador:
            $('#config-bio-contador'),

        bioStatus:
            $('#config-bio-status'),


        /* TEMA */

        temaBtn:
            $('#config-tema-btn'),

        temaStatus:
            $('#config-tema-status'),


        /* FAVORITA */

        favoritaFiltro:
            $('#perfil-favorita-filtro'),

        favoritaResultados:
            $('#perfil-favorita-resultados'),

        favoritaAtual:
            $('#perfil-favorita-atual'),

        favoritaRemover:
            $('#perfil-favorita-remover'),


        /* CURTIDAS */

        curtidasFiltro:
            $('#perfil-curtidas-filtro'),

        curtidasResultados:
            $('#perfil-curtidas-resultados'),

        curtidasLista:
            $('#perfil-curtidas-lista'),

        curtidasContador:
            $('#perfil-curtidas-contador'),


        /* PLAYLISTS */

        playlistForm:
            $('#perfil-playlist-form'),

        playlistNome:
            $('#perfil-playlist-nome'),

        playlistsLista:
            $('#perfil-playlists-lista')

    };


    /* =========================================================
       ERRO DE API
       ========================================================= */

    class ApiErro extends Error {

        constructor(
            mensagem,
            status,
            dados = null
        ) {

            super(mensagem);

            this.name = 'ApiErro';

            this.status = status;

            this.dados = dados;

        }

    }


    /* =========================================================
       TOKEN
       ========================================================= */

    function getToken() {

        return localStorage.getItem(
            TOKEN_KEY
        );

    }


    function limparSessao() {

        localStorage.removeItem(
            TOKEN_KEY
        );

    }


    /* =========================================================
       ESTADOS DA PÁGINA
       ========================================================= */

    function mostrarBloqueado(
        mensagem = null
    ) {

        dom.bloqueado?.classList.remove(
            'hidden'
        );

        dom.conteudo?.classList.add(
            'hidden'
        );


        if (mensagem) {

            const texto =
                dom.bloqueado?.querySelector(
                    '.perfil-bloqueado-texto'
                );


            if (texto) {

                texto.textContent =
                    mensagem;

            }

        }

    }


    function mostrarConteudo(
        carregando = false
    ) {

        dom.bloqueado?.classList.add(
            'hidden'
        );

        dom.conteudo?.classList.remove(
            'hidden'
        );


        dom.conteudo?.setAttribute(
            'aria-busy',
            carregando
                ? 'true'
                : 'false'
        );

    }


    /* =========================================================
       API
       ========================================================= */

    async function apiRequest(
        caminho,
        opcoes = {}
    ) {

        const token =
            getToken();


        const headers =
            new Headers(
                opcoes.headers || {}
            );


        if (token) {

            headers.set(
                'Authorization',
                `Bearer ${token}`
            );

        }


        const ehFormData =
            opcoes.body instanceof FormData;


        if (
            opcoes.body &&
            !ehFormData &&
            !headers.has(
                'Content-Type'
            )
        ) {

            headers.set(
                'Content-Type',
                'application/json'
            );

        }


        let resposta;


        try {

            resposta =
                await fetch(
                    `${API_BASE}${caminho}`,
                    {
                        ...opcoes,

                        cache:
                            (
                                opcoes.method ||
                                'GET'
                            ).toUpperCase() === 'GET'
                                ? 'no-store'
                                : opcoes.cache,

                        headers

                    }
                );

        } catch {

            throw new Error(
                'Não foi possível conectar ao servidor.'
            );

        }


        let dados = null;


        const contentType =
            resposta.headers.get(
                'content-type'
            ) || '';


        if (
            contentType.includes(
                'application/json'
            )
        ) {

            try {

                dados =
                    await resposta.json();

            } catch {

                dados = null;

            }

        }


        if (
            resposta.status === 401
        ) {

            limparSessao();

            mostrarBloqueado(
                'Sua sessão expirou. Faça login novamente.'
            );


            throw new ApiErro(
                'Sua sessão expirou. Faça login novamente.',
                401,
                dados
            );

        }


        if (!resposta.ok) {

            throw new ApiErro(
                dados?.mensagem ||
                    'A operação não pôde ser concluída.',
                resposta.status,
                dados
            );

        }


        return dados || {};

    }


    /* =========================================================
       STATUS
       ========================================================= */

    function setStatus(
        elemento,
        mensagem,
        erro = false
    ) {

        if (!elemento) return;


        elemento.textContent =
            mensagem || '';


        elemento.dataset.estado =
            erro
                ? 'erro'
                : 'ok';

    }


    /* =========================================================
       AVATAR
       ========================================================= */

    function imagemAvatar(
        url
    ) {

        return (
            url ||
            AVATAR_PADRAO
        );

    }


    function atualizarAvatares(
        url
    ) {

        const src =
            imagemAvatar(url);


        document
            .querySelectorAll(
                '.btn-perfil-avatar img'
            )
            .forEach(
                (img) => {

                    img.src =
                        src;

                }
            );


        if (dom.avatar) {

            dom.avatar.src =
                src;

        }


        if (dom.avatarPreview) {

            dom.avatarPreview.src =
                src;

        }

    }


    function ouvirAtualizacaoAvatar() {

        window.addEventListener(
            EVENTO_AVATAR,
            (evento) => {

                atualizarAvatares(
                    evento.detail?.avatarUrl ||
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
                    CANAL_AVATAR
                );


            canalAvatar.onmessage =
                (evento) => {

                    atualizarAvatares(
                        evento.data?.avatarUrl ||
                        null
                    );

                };

        } catch {

            canalAvatar =
                null;

        }

    }


    function publicarAtualizacaoAvatar(
        url
    ) {

        const detalhe = {
            avatarUrl:
                url || null
        };


        window.dispatchEvent(
            new CustomEvent(
                EVENTO_AVATAR,
                {
                    detail:
                        detalhe
                }
            )
        );


        try {

            canalAvatar?.postMessage(
                detalhe
            );

        } catch {

            /* Sem BroadcastChannel,
               a atualização local continua funcionando. */

        }

    }


    /* =========================================================
       TEMA
       ========================================================= */

    function atualizarTema(
        tema
    ) {

        const temaValido =
            tema === 'light'
                ? 'light'
                : 'dark';


        document.documentElement.dataset.theme =
            temaValido;

    }


    /* =========================================================
       BANNER
       ========================================================= */

    function renderizarBanner(
        url
    ) {

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


        if (dom.bannerImg) {

            dom.bannerImg.src =
                possuiBanner
                    ? url
                    : '';

        }


        dom.bannerPreview?.classList.toggle(
            'hidden',
            !possuiBanner
        );


        dom.bannerPreviewVazio?.classList.toggle(
            'hidden',
            possuiBanner
        );


        if (dom.bannerPreview) {

            dom.bannerPreview.src =
                possuiBanner
                    ? url
                    : '';

        }

    }


    /* =========================================================
       BIO
       ========================================================= */

    function atualizarContadorBio() {

        if (!dom.bioContador) {
            return;
        }


        dom.bioContador.textContent =
            `${dom.bioTextarea.value.length}/${BIO_MAX}`;

    }


    /* =========================================================
       RENDER — FAVORITA
       ========================================================= */

    function renderizarFavorita(
        favorita
    ) {

        if (
            !dom.favoritaAtual ||
            !dom.favoritaRemover
        ) {

            return;

        }


        if (!favorita) {

            dom.favoritaAtual.textContent =
                'Nenhuma música escolhida.';


            dom.favoritaRemover
                .classList
                .add(
                    'hidden'
                );


            return;

        }


        dom.favoritaAtual.textContent =
            `${favorita.titulo} — ${favorita.artista}`;


        dom.favoritaRemover
            .classList
            .remove(
                'hidden'
            );

    }


    /* =========================================================
       RENDER — CURTIDAS
       ========================================================= */

    function renderizarCurtidas(
        curtidas
    ) {

        dom.curtidasLista
            .replaceChildren();


        dom.curtidasContador.textContent =
            `${curtidas.length}/${CURTIDAS_MAX}`;


        curtidas.forEach(
            (musica) => {

                const item =
                    document.createElement(
                        'div'
                    );


                item.className =
                    'perfil-item-atual';


                const capa =
                    document.createElement(
                        'img'
                    );


                capa.className =
                    'perfil-item-atual-capa';


                capa.src =
                    musica.url_capa ||
                    '';


                capa.alt =
                    '';


                const texto =
                    document.createElement(
                        'div'
                    );


                texto.className =
                    'perfil-item-atual-texto';


                const titulo =
                    document.createElement(
                        'span'
                    );


                titulo.className =
                    'perfil-item-atual-titulo';


                titulo.textContent =
                    musica.titulo;


                const subtitulo =
                    document.createElement(
                        'span'
                    );


                subtitulo.className =
                    'perfil-item-atual-subtitulo';


                subtitulo.textContent =
                    musica.artista;


                const remover =
                    document.createElement(
                        'button'
                    );


                remover.type =
                    'button';


                remover.className =
                    'perfil-remover-item';


                remover.textContent =
                    'Remover';


                remover.addEventListener(
                    'click',
                    () =>
                        removerCurtida(
                            musica.id
                        )
                );


                texto.append(
                    titulo,
                    subtitulo
                );


                item.append(
                    capa,
                    texto,
                    remover
                );


                dom.curtidasLista
                    .appendChild(
                        item
                    );

            }
        );

    }


    /* =========================================================
       RENDER — PLAYLISTS
       ========================================================= */

    function renderizarPlaylists(
        playlists
    ) {

        dom.playlistsLista
            .replaceChildren();


        if (
            playlists.length === 0
        ) {

            const vazio =
                document.createElement(
                    'p'
                );


            vazio.className =
                'perfil-estado-mensagem';


            vazio.textContent =
                'Nenhuma playlist pública ainda.';


            dom.playlistsLista
                .appendChild(
                    vazio
                );


            return;

        }


        playlists.forEach(
            (playlist) => {

                const item =
                    document.createElement(
                        'div'
                    );


                item.className =
                    'perfil-item-atual';


                const texto =
                    document.createElement(
                        'div'
                    );


                texto.className =
                    'perfil-item-atual-texto';


                const titulo =
                    document.createElement(
                        'span'
                    );


                titulo.className =
                    'perfil-item-atual-titulo';


                titulo.textContent =
                    playlist.nome;


                const subtitulo =
                    document.createElement(
                        'span'
                    );


                subtitulo.className =
                    'perfil-item-atual-subtitulo';


                const total =
                    Number(
                        playlist.total_faixas
                    ) || 0;


                subtitulo.textContent =
                    `${total} ${
                        total === 1
                            ? 'faixa'
                            : 'faixas'
                    }`;


                const remover =
                    document.createElement(
                        'button'
                    );


                remover.type =
                    'button';


                remover.className =
                    'perfil-remover-item';


                remover.textContent =
                    'Excluir';


                remover.addEventListener(
                    'click',
                    () =>
                        removerPlaylist(
                            playlist.id
                        )
                );


                texto.append(
                    titulo,
                    subtitulo
                );


                item.append(
                    texto,
                    remover
                );


                dom.playlistsLista
                    .appendChild(
                        item
                    );

            }
        );

    }


    /* =========================================================
       RENDER — PERFIL
       ========================================================= */

    function renderizarPerfil(
        perfil
    ) {

        perfilAtual =
            perfil;


        const usuario =
            perfil?.usuario ||
            {};


        const estatisticas =
            perfil?.estatisticas ||
            {};


        const curtidas =
            Array.isArray(
                perfil?.curtidas
            )
                ? perfil.curtidas
                : [];


        const playlists =
            Array.isArray(
                perfil?.playlists
            )
                ? perfil.playlists
                : [];


        dom.nome.textContent =
            usuario.nome_usuario ||
            'Usuário';


        if (
            usuario.eh_artista &&
            usuario.nome_artista
        ) {

            dom.nomeArtista.textContent =
                usuario.nome_artista;


            dom.nomeArtista
                .classList
                .remove(
                    'hidden'
                );

        } else {

            dom.nomeArtista.textContent =
                '';


            dom.nomeArtista
                .classList
                .add(
                    'hidden'
                );

        }


        dom.bio.textContent =
            usuario.bio ||
            '';


        atualizarAvatares(
            usuario.avatar_url ||
            null
        );


        if (
            usuario.eh_artista
        ) {

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
                .remove(
                    'hidden'
                );

        } else {

            dom.estatisticas.textContent =
                '';


            dom.estatisticas
                .classList
                .add(
                    'hidden'
                );

        }


        dom.bioTextarea.value =
            usuario.bio ||
            '';


        atualizarContadorBio();


        atualizarTema(
            usuario.tema
        );


        renderizarBanner(
            usuario.url_banner ||
            null
        );


        renderizarFavorita(
            perfil?.favorita ||
            null
        );


        renderizarCurtidas(
            curtidas
        );


        renderizarPlaylists(
            playlists
        );


        mostrarConteudo(
            false
        );

    }


    /* =========================================================
       CARREGAMENTO
       ========================================================= */

    async function carregarPerfil() {

        const dados =
            await apiRequest(
                '/api/perfil'
            );


        renderizarPerfil(
            dados.perfil
        );

    }


    /* =========================================================
       BIO — SALVAR
       ========================================================= */

    async function salvarBio(
        event
    ) {

        event.preventDefault();


        const bio =
            dom.bioTextarea.value
                .trim();


        if (
            bio.length >
            BIO_MAX
        ) {

            setStatus(
                dom.bioStatus,
                `A bio pode ter no máximo ${BIO_MAX} caracteres.`,
                true
            );


            return;

        }


        setStatus(
            dom.bioStatus,
            'Salvando...'
        );


        try {

            const dados =
                await apiRequest(
                    '/api/perfil/bio',
                    {
                        method: 'PUT',

                        body:
                            JSON.stringify({
                                bio
                            })
                    }
                );


            dom.bio.textContent =
                dados.bio ||
                '';


            perfilAtual.usuario.bio =
                dados.bio ||
                null;


            setStatus(
                dom.bioStatus,
                'Bio salva.'
            );

        } catch (erro) {

            setStatus(
                dom.bioStatus,
                erro.message,
                true
            );

        }

    }


    /* =========================================================
       AVATAR — ENVIAR
       ========================================================= */

    async function enviarAvatar(
        arquivo
    ) {

        if (!arquivo) {
            return;
        }


        const formData =
            new FormData();


        formData.append(
            'avatar',
            arquivo
        );


        setStatus(
            dom.avatarStatus,
            'Enviando avatar...'
        );


        try {

            const dados =
                await apiRequest(
                    '/api/perfil/avatar',
                    {
                        method:
                            'POST',

                        body:
                            formData
                    }
                );


            const url =
                dados.avatar_url ||
                null;


            perfilAtual.usuario.avatar_url =
                url;


            atualizarAvatares(
                url
            );


            publicarAtualizacaoAvatar(
                url
            );


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


    /* =========================================================
       AVATAR — REMOVER
       ========================================================= */

    async function removerAvatar() {

        setStatus(
            dom.avatarStatus,
            'Removendo avatar...'
        );


        try {

            const dados =
                await apiRequest(
                    '/api/perfil/avatar',
                    {
                        method:
                            'DELETE'
                    }
                );


            const url =
                dados.avatar_url ||
                null;


            perfilAtual.usuario.avatar_url =
                url;


            atualizarAvatares(
                url
            );


            publicarAtualizacaoAvatar(
                url
            );


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


    /* =========================================================
       BANNER — ENVIAR
       ========================================================= */

    async function enviarBanner(
        arquivo
    ) {

        if (!arquivo) {
            return;
        }


        const formData =
            new FormData();


        formData.append(
            'banner',
            arquivo
        );


        setStatus(
            dom.bannerStatus,
            'Enviando banner...'
        );


        try {

            const dados =
                await apiRequest(
                    '/api/perfil/banner',
                    {
                        method:
                            'POST',

                        body:
                            formData
                    }
                );


            const url =
                dados.url_banner ||
                null;


            perfilAtual.usuario.url_banner =
                url;


            renderizarBanner(
                url
            );


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


    /* =========================================================
       BANNER — REMOVER
       ========================================================= */

    async function removerBanner() {

        setStatus(
            dom.bannerStatus,
            'Removendo banner...'
        );


        try {

            const dados =
                await apiRequest(
                    '/api/perfil/banner',
                    {
                        method:
                            'DELETE'
                    }
                );


            perfilAtual.usuario.url_banner =
                dados.url_banner ||
                null;


            renderizarBanner(
                null
            );


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


    /* =========================================================
       TEMA
       ========================================================= */

    async function alternarTema() {

        const atual =
            document.documentElement.dataset.theme ===
                'light'
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

            const dados =
                await apiRequest(
                    '/api/perfil/tema',
                    {
                        method:
                            'PUT',

                        body:
                            JSON.stringify({
                                tema:
                                    proximo
                            })
                    }
                );


            const tema =
                dados.tema ||
                proximo;


            atualizarTema(
                tema
            );


            perfilAtual.usuario.tema =
                tema;


            setStatus(
                dom.temaStatus,
                `Tema ${
                    tema === 'light'
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


    /* =========================================================
       BUSCA DE MÚSICAS
       ========================================================= */

    function renderizarResultadosBusca(
        container,
        musicas,
        aoSelecionar,
        indisponiveis = new Set()
    ) {

        container.replaceChildren();


        if (
            !musicas.length
        ) {

            const vazio =
                document.createElement(
                    'p'
                );


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
            .forEach(
                (musica) => {

                    const botao =
                        document.createElement(
                            'button'
                        );


                    botao.type =
                        'button';


                    botao.className =
                        'perfil-resultado-item';


                    botao.disabled =
                        indisponiveis.has(
                            musica.id
                        );


                    const capa =
                        document.createElement(
                            'img'
                        );


                    capa.className =
                        'perfil-resultado-capa';


                    capa.src =
                        musica.url_capa ||
                        '';


                    capa.alt =
                        '';


                    const texto =
                        document.createElement(
                            'span'
                        );


                    texto.className =
                        'perfil-resultado-texto';


                    const titulo =
                        document.createElement(
                            'span'
                        );


                    titulo.className =
                        'perfil-resultado-titulo';


                    titulo.textContent =
                        musica.titulo;


                    const artista =
                        document.createElement(
                            'span'
                        );


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
                        () =>
                            aoSelecionar(
                                musica
                            )
                    );


                    container.appendChild(
                        botao
                    );

                }
            );

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

                window.clearTimeout(
                    timeout
                );


                const termo =
                    input.value.trim();


                if (
                    termo.length < 2
                ) {

                    resultados
                        .replaceChildren();


                    return;

                }


                resultados
                    .replaceChildren();


                const carregando =
                    document.createElement(
                        'p'
                    );


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
                                        `/api/musicas/buscar?q=${encodeURIComponent(termo)}`
                                    );


                                renderizarResultadosBusca(
                                    resultados,

                                    Array.isArray(
                                        dados.musicas
                                    )
                                        ? dados.musicas
                                        : [],

                                    aoSelecionar,

                                    getIndisponiveis()
                                );

                            } catch (erro) {

                                resultados
                                    .replaceChildren();


                                const erroEl =
                                    document.createElement(
                                        'p'
                                    );


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


    /* =========================================================
       FAVORITA
       ========================================================= */

    async function selecionarFavorita(
        musica
    ) {

        try {

            const dados =
                await apiRequest(
                    '/api/perfil/favorita',
                    {
                        method:
                            'PUT',

                        body:
                            JSON.stringify({
                                musicaId:
                                    musica.id
                            })
                    }
                );


            perfilAtual.favorita =
                dados.favorita ||
                null;


            renderizarFavorita(
                perfilAtual.favorita
            );


            dom.favoritaFiltro.value =
                '';


            dom.favoritaResultados
                .replaceChildren();

        } catch (erro) {

            const mensagem =
                document.createElement(
                    'p'
                );


            mensagem.className =
                'perfil-estado-mensagem';


            mensagem.textContent =
                erro.message;


            dom.favoritaResultados
                .replaceChildren(
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
                        method:
                            'DELETE'
                    }
                );


            perfilAtual.favorita =
                dados.favorita ||
                null;


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


    /* =========================================================
       CURTIDAS
       ========================================================= */

    async function salvarCurtidas(
        novasCurtidas
    ) {

        const ids =
            novasCurtidas.map(
                (musica) =>
                    musica.id
            );


        if (
            ids.length >
            CURTIDAS_MAX
        ) {

            throw new Error(
                `Você pode destacar no máximo ${CURTIDAS_MAX} músicas.`
            );

        }


        const dados =
            await apiRequest(
                '/api/perfil/curtidas',
                {
                    method:
                        'PUT',

                    body:
                        JSON.stringify({
                            musicaIds:
                                ids
                        })
                }
            );


        perfilAtual.curtidas =
            Array.isArray(
                dados.curtidas
            )
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
                ? [
                    ...perfilAtual.curtidas
                ]
                : [];


        if (
            curtidas.some(
                (item) =>
                    item.id ===
                    musica.id
            )
        ) {

            return;

        }


        if (
            curtidas.length >=
            CURTIDAS_MAX
        ) {

            const mensagem =
                document.createElement(
                    'p'
                );


            mensagem.className =
                'perfil-estado-mensagem';


            mensagem.textContent =
                `O limite é ${CURTIDAS_MAX} músicas.`;


            dom.curtidasResultados
                .replaceChildren(
                    mensagem
                );


            return;

        }


        try {

            await salvarCurtidas(
                [
                    ...curtidas,
                    musica
                ]
            );


            dom.curtidasFiltro.value =
                '';


            dom.curtidasResultados
                .replaceChildren();

        } catch (erro) {

            const mensagem =
                document.createElement(
                    'p'
                );


            mensagem.className =
                'perfil-estado-mensagem';


            mensagem.textContent =
                erro.message;


            dom.curtidasResultados
                .replaceChildren(
                    mensagem
                );

        }

    }


    async function removerCurtida(
        id
    ) {

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
                document.createElement(
                    'p'
                );


            mensagem.className =
                'perfil-estado-mensagem';


            mensagem.textContent =
                erro.message;


            dom.curtidasLista
                .appendChild(
                    mensagem
                );

        }

    }


    /* =========================================================
       PLAYLISTS
       ========================================================= */

    async function criarPlaylist(
        event
    ) {

        event.preventDefault();


        const nome =
            dom.playlistNome.value
                .trim();


        if (!nome) {
            return;
        }


        try {

            const dados =
                await apiRequest(
                    '/api/perfil/playlists',
                    {
                        method:
                            'POST',

                        body:
                            JSON.stringify({
                                nome
                            })
                    }
                );


            perfilAtual.playlists =
                [
                    ...(perfilAtual.playlists || []),

                    dados.playlist

                ];


            renderizarPlaylists(
                perfilAtual.playlists
            );


            dom.playlistNome.value =
                '';

        } catch (erro) {

            const mensagem =
                document.createElement(
                    'p'
                );


            mensagem.className =
                'perfil-estado-mensagem';


            mensagem.textContent =
                erro.message;


            dom.playlistsLista.prepend(
                mensagem
            );

        }

    }


    async function removerPlaylist(
        id
    ) {

        try {

            await apiRequest(
                `/api/perfil/playlists/${encodeURIComponent(id)}`,
                {
                    method:
                        'DELETE'
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


            renderizarPlaylists(
                perfilAtual.playlists
            );

        } catch (erro) {

            const mensagem =
                document.createElement(
                    'p'
                );


            mensagem.className =
                'perfil-estado-mensagem';


            mensagem.textContent =
                erro.message;


            dom.playlistsLista.prepend(
                mensagem
            );

        }

    }


    /* =========================================================
       EVENTOS
       ========================================================= */

    function configurarEventos() {


        /* BIO */

        dom.bioTextarea.addEventListener(
            'input',
            atualizarContadorBio
        );


        dom.bioForm.addEventListener(
            'submit',
            salvarBio
        );


        /* AVATAR */

        dom.avatarEnviar.addEventListener(
            'click',
            () =>
                dom.avatarInput.click()
        );


        dom.avatarInput.addEventListener(
            'change',
            () => {

                const arquivo =
                    dom.avatarInput
                        .files?.[0] ||
                    null;


                dom.avatarInput.value =
                    '';


                enviarAvatar(
                    arquivo
                );

            }
        );


        dom.avatarRemover.addEventListener(
            'click',
            removerAvatar
        );


        /* BANNER */

        dom.bannerEnviar.addEventListener(
            'click',
            () =>
                dom.bannerInput.click()
        );


        dom.bannerInput.addEventListener(
            'change',
            () => {

                const arquivo =
                    dom.bannerInput
                        .files?.[0] ||
                    null;


                dom.bannerInput.value =
                    '';


                enviarBanner(
                    arquivo
                );

            }
        );


        dom.bannerRemover.addEventListener(
            'click',
            removerBanner
        );


        /* TEMA */

        dom.temaBtn.addEventListener(
            'click',
            alternarTema
        );


        /* FAVORITA */

        dom.favoritaRemover.addEventListener(
            'click',
            removerFavorita
        );


        configurarBuscaMusicas(
            dom.favoritaFiltro,

            dom.favoritaResultados,

            selecionarFavorita,

            () =>
                new Set()
        );


        /* CURTIDAS */

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


        /* PLAYLISTS */

        dom.playlistForm.addEventListener(
            'submit',
            criarPlaylist
        );

    }


    /* =========================================================
       INICIALIZAÇÃO
       ========================================================= */

    async function iniciar() {

        ouvirAtualizacaoAvatar();


        if (
            !getToken()
        ) {

            mostrarBloqueado();

            return;

        }


        /*
         * O conteúdo permanece visível enquanto
         * os dados reais são buscados.
         */

        mostrarConteudo(
            true
        );


        try {

            configurarEventos();

            await carregarPerfil();

        } catch (erro) {

            if (
                erro.status === 401
            ) {

                return;

            }


            mostrarBloqueado(
                erro.message ||
                'Não foi possível carregar o perfil.'
            );

        }

    }


    /* =========================================================
       BOOT
       ========================================================= */

    if (
        document.readyState ===
        'loading'
    ) {

        document.addEventListener(
            'DOMContentLoaded',
            iniciar,
            {
                once: true
            }
        );

    } else {

        iniciar();

    }

})();