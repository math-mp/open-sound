# Política de Privacidade - OpenSound

**Última atualização:** setembro de 2026 · **Versão:** 1.2

> Esta política explica em linguagem simples quais dados coletamos, por que coletamos e o que você pode fazer a respeito. Em conformidade com a **LGPD (Lei nº 13.709/2018)**.

---

## 1. Quem somos (controlador dos dados)

O OpenSound é uma plataforma de streaming musical desenvolvida como projeto escolar. Para fins da LGPD, somos o controlador dos dados pessoais que você nos fornece.

Contato do responsável pelos dados: **privacidade@opensound.com** 

---

## 2. Quais dados coletamos

### 2.1 Dados que você fornece diretamente

| Dado | Quando é coletado | Por quê |
|------|-------------------|---------|
| Nome de usuário | Cadastro | Identificar você na plataforma |
| Endereço de e-mail | Cadastro | Login, verificação e códigos de segurança |
| Senha | Cadastro | Autenticação (guardada apenas como hash) |
| Nome de artista | Opcional, ao publicar músicas | Identificar o autor das faixas |
| Foto de perfil | Opcional, no perfil | Exibir no perfil |
| Biografia do perfil | Opcional, no perfil (até 300 caracteres) | Exibir no perfil |
| Músicas enviadas (áudio, título e capa) | Ao fazer upload | Disponibilizar a música na plataforma |
| Playlists criadas (nome e capa) | Ao criar/editar playlists | Salvar e exibir suas playlists |
| Músicas favoritadas | Ao favoritar uma música | Preencher a playlist "Favoritos" |
| Música favorita e músicas curtidas em destaque (até 4) | Opcional, no perfil | Exibir no perfil |

### 2.2 Dados coletados automaticamente

| Dado | Por quê |
|------|---------|
| Contagem de reproduções de cada música | Ranking de músicas e artistas mais ouvidos |
| Histórico de redefinições de senha (data e origem) | Aplicar o limite de 3 redefinições em 24 horas |
| Endereço IP (temporário, em memória) | Limitar requisições e prevenir abuso e fraudes |

A contagem de reproduções é **agregada por música**; a plataforma não guarda, nesta versão, um histórico individual do que cada usuário escutou.

### 2.3 Dados que **não** coletamos nesta versão

Histórico individual de escuta, histórico de buscas, tempo de escuta por faixa, artistas seguidos e login com contas de terceiros (Google, por exemplo) **não existem** no OpenSound atual. Se forem implementados, esta Política será atualizada antes e você será avisado.

---

## 3. Para que usamos seus dados

| Finalidade | Base legal (LGPD) |
|------------|-------------------|
| Criar e manter sua conta | Execução de contrato (Art. 7°, V) |
| Verificar seu e-mail e recuperar senha | Execução de contrato |
| Exibir seu perfil, playlists e músicas | Execução de contrato |
| Exibir rankings de músicas e artistas | Execução de contrato |
| Segurança, limite de requisições e prevenção de fraudes | Legítimo interesse (Art. 7°, IX) |
| Análise de erros e melhoria da plataforma | Legítimo interesse |
| Enviar comunicados sobre a plataforma | Legítimo interesse |

> **Não vendemos seus dados.** Não usamos seus dados para publicidade de terceiros.

---

## 4. Com quem compartilhamos seus dados

| Provedor | O que recebe | Por quê |
|----------|-------------|---------|
| **PostgreSQL** (banco gerenciado) **Supabase** | Dados da conta, músicas, playlists e perfil | Banco de dados da aplicação |
| **Render** | Todas as requisições ao servidor (API), incluindo e-mail, dados de cadastro e token de sessão em trânsito, e endereço IP | Hospedagem do backend |
| **Vercel** | Endereço IP e dados do navegador de quem acessa o site | Hospedagem do frontend (páginas do site) |
| **Supabase Storage** | Arquivos de áudio, capas e fotos de perfil | Armazenamento de arquivos |
| **Google Gmail (SMTP)** | Seu e-mail e o código de verificação | Envio de códigos de cadastro e recuperação de senha |
| **Google Fonts** | Endereço IP e dados do navegador | Carregamento da fonte visual das páginas |

Os arquivos enviados ficam em armazenamento **público por link**: quem tiver a URL de uma música, capa ou foto consegue acessá-la diretamente. Fora os casos acima, **não compartilhamos seus dados com terceiros**, exceto quando exigido por lei ou ordem judicial.

---

## 5. Por quanto tempo guardamos seus dados

| Dado | Tempo de retenção |
|------|-------------------|
| Dados da conta ativa | Enquanto a conta existir |
| Músicas, playlists, favoritos e perfil | Enquanto a conta existir (ou até você excluir) |
| Cadastros e códigos de verificação pendentes | Até 10 minutos (validade do código) |
| Histórico de redefinições de senha | Enquanto a conta existir |
| Dados após exclusão da conta | Removidos imediatamente do banco e do armazenamento

---

## 6. Seus direitos (LGPD)

Você pode excluir sua conta e todas as suas músicas, playlists e arquivos a qualquer momento em **Configurações**. Para os demais direitos, entre em contato por **privacidade@opensound.com**. Responderemos em até **15 dias úteis**.

| Direito | O que significa na prática |
|---------|---------------------------|
| **Acesso** | Receber cópia dos dados que temos sobre você |
| **Correção** | Corrigir dados incorretos ou incompletos (nome de usuário, bio, foto e senha podem ser alterados no perfil e nas configurações) |
| **Exclusão** | Excluir a conta diretamente em Configurações ou por e-mail |
| **Portabilidade** | Receber seus dados em formato estruturado (ex.: JSON), mediante solicitação |
| **Oposição** | Opor-se ao uso dos dados para determinada finalidade |
| **Informação** | Saber com quem compartilhamos seus dados |

---

## 7. Segurança dos dados

- **Criptografia em trânsito:** a comunicação deve usar HTTPS (TLS) em produção;
- **Autenticação segura:** senhas e códigos de verificação armazenados apenas como hash (bcrypt), nunca em texto puro;
- **Tokens JWT:** sessões autenticadas por token com expiração de **7 dias** (ou **30 dias**, se você marcar "lembrar de mim");
- **Verificação em duas etapas** no cadastro e limite de tentativas de código;
- **Limite de requisições por IP** nas rotas sensíveis (login, cadastro, códigos e upload);
- **Acesso restrito:** apenas membros autorizados da equipe acessam o banco e as chaves de serviço.

Em caso de violação de dados que afete você, notificaremos por e-mail em até **72 horas** após tomarmos conhecimento do incidente.

---

## 8. Armazenamento local

O OpenSound utiliza apenas armazenamento estritamente necessário, no `localStorage` do seu navegador:

| Item | Finalidade |
|------|-----------|
| Token de sessão (JWT) | Manter você logado |
| Tema de cor escolhido | Lembrar preferência visual |
| Dados de perfil em cache local | Agilizar a exibição do perfil e das playlists |

> Não usamos cookies de rastreamento, publicidade ou analíticas de terceiros.

---

## 9. Idade mínima

O OpenSound é destinado exclusivamente a pessoas com **18 anos ou mais**. Nesta versão, o cadastro **não verifica a idade**; ao criar a conta, você declara ser maior de 18 anos. Não coletamos intencionalmente dados de menores de 18 anos. Se acreditar que uma conta pertence a um menor, entre em contato para exclusão imediata.

---


## 10. Alterações e contato

Quando atualizarmos esta Política, a data no topo será alterada e usuários com conta ativa serão notificados por e-mail.

**privacidade@opensound.com**

*Em conformidade com a LGPD (Lei nº 13.709/2018).*

---

*OpenSound - Projeto escolar · [Termo de Licenciamento e Uso](./termos-de-licenciamento-e-uso.md)*
