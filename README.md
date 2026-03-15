# WriteForge Extension

Extensão Chrome (MV3) estilo Apollo — painel lateral fixo no LinkedIn para criação de posts com IA.

## Estrutura

```
writeforge-extension/
├── manifest.json        # Manifest V3
├── background.js        # Service worker (auth, proxy, estado)
├── contentScript.js     # Injeta FAB + painel no LinkedIn
├── panel.html           # Interface do painel lateral
├── panel.js             # Lógica do painel (UI)
├── authService.js       # Módulo de auth (comunica com background)
├── popup.html           # Popup do ícone da extensão
├── styles.css           # Estilos injetados no LinkedIn
├── icons/               # Ícones da extensão
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Instalação (Dev)

1. Abra `chrome://extensions/`
2. Ative **Modo do desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação**
4. Selecione a pasta `writeforge-extension`
5. Navegue até `linkedin.com` — o botão flutuante aparecerá

## Arquitetura

### Autenticação (sem iframe)

```
Usuário clica "Login"
  → Panel envia MOCK_LOGIN/LOGIN ao background
  → Background usa chrome.identity.launchWebAuthFlow (produção)
  → Backend redireciona para https://<extension-id>.chromiumapp.org/callback#token=JWT
  → Background extrai token, valida com /me, salva em chrome.storage.local
  → Panel renderiza interface principal
```

**Proibido:** sessionStorage, cookies SameSite, iframe para login, token no DOM.

### Comunicação

```
Panel → chrome.runtime.sendMessage → Background → Backend → Response → Panel
```

Content script **nunca** chama o backend diretamente.

### Layout (estilo Apollo)

- Painel fixo: `position: fixed; right: 0; top: 0; width: 420px; height: 100vh`
- LinkedIn reduz: `document.documentElement.style.width = calc(100% - 420px)`
- Transição suave: 300ms cubic-bezier
- Botão flutuante desaparece quando painel abre

## MVP

A versão atual inclui:

- Login (mock para desenvolvimento, pronto para backend real)
- Abrir/fechar painel lateral com transição suave
- Criar post (textarea com contador de caracteres)
- Gerar post via backend (mock com fallback)
- Exibir resultado + sugestões
- Copiar post gerado
- Persistência de estado ao navegar no LinkedIn

## Configuração do Backend (Produção)

1. Edite `CONFIG.BACKEND_URL` em `background.js`
2. Configure o endpoint `/auth/login` para redirecionar para:
   ```
   https://<extension-id>.chromiumapp.org/callback#token=JWT_TOKEN
   ```
3. Implemente o endpoint `/me` (validação de token)
4. Implemente `/posts/generate` (geração de conteúdo)
5. Em `panel.js`, troque `AuthService.mockLogin()` por `AuthService.login()`

## Segurança

- Token vive apenas em `chrome.storage.local` (não acessível pela página)
- Validação de token no background ao iniciar
- Proxy de requisições via background (content script nunca acessa backend)
- Nenhum dado sensível no DOM
