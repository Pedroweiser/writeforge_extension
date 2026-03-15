/**
 * WriteForge Extension — Panel JS
 *
 * Lógica da interface lateral.
 * Comunicação exclusivamente via chrome.runtime.sendMessage → background.
 * Nunca acessa backend diretamente.
 * Nunca expõe token no DOM.
 */

(function () {
  "use strict";

  // ─── DOM Elements ──────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);

  const screenLoading = $("#screenLoading");
  const screenLogin = $("#screenLogin");
  const screenMain = $("#screenMain");

  const btnClose = $("#btnClose");
  const btnLogin = $("#btnLogin");
  const btnLogout = $("#btnLogout");
  const apiKeyInput = $("#apiKeyInput");
  const btnGenerate = $("#btnGenerate");
  const btnCopy = $("#btnCopy");

  const postTextarea = $("#postTextarea");
  const charCount = $("#charCount");
  const resultArea = $("#resultArea");
  const resultText = $("#resultText");
  const suggestions = $("#suggestions");

  const postTypeSelect = $("#postTypeSelect");

  const userAvatar = $("#userAvatar");
  const userName = $("#userName");
  const userEmail = $("#userEmail");
  const loginError = $("#loginError");

  // ─── State ─────────────────────────────────────────────────────────────────
  let currentUser = null;
  let generatedPost = "";
  let postTypesLoaded = false;

  // ─── Screen Management ─────────────────────────────────────────────────────

  function showScreen(screen) {
    [screenLoading, screenLogin, screenMain].forEach((s) => {
      s.classList.remove("active");
    });
    screen.classList.add("active");
  }

  // ─── User Display ─────────────────────────────────────────────────────────

  function updateUserDisplay(user) {
    if (!user) return;
    currentUser = user;

    const name = user.name || "Usuário";
    const email = user.email || "";
    const initial = name.charAt(0).toUpperCase();

    userAvatar.textContent = initial;
    userName.textContent = name;
    userEmail.textContent = email;
  }

  // ─── Auth Flow ─────────────────────────────────────────────────────────────

  async function checkAuth() {
    showScreen(screenLoading);

    try {
      const response = await AuthService.checkAuth();

      if (response && response.authenticated) {
        updateUserDisplay(response.user);
        showScreen(screenMain);
        loadPostTypes();
      } else {
        showScreen(screenLogin);
      }
    } catch (err) {
      console.error("[WriteForge] checkAuth error:", err);
      showScreen(screenLogin);
    }
  }

  async function handleLogin() {
    const apiKey = apiKeyInput ? apiKeyInput.value.trim() : "";

    if (!apiKey) {
      loginError.textContent = "Cole sua API Key antes de salvar.";
      loginError.classList.add("visible");
      if (apiKeyInput) apiKeyInput.focus();
      return;
    }

    btnLogin.disabled = true;
    btnLogin.textContent = "Validando...";
    loginError.classList.remove("visible");

    try {
      // Envia SET_TOKEN ao background → valida com GET /auth/me → persiste
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: "SET_TOKEN", payload: { token: apiKey } },
          (res) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
              return;
            }
            resolve(res);
          }
        );
      });

      if (response && response.success) {
        // Limpar input antes de sair da tela (nunca manter key no DOM)
        if (apiKeyInput) apiKeyInput.value = "";
        updateUserDisplay(response.user);
        showScreen(screenMain);
        loadPostTypes();
      } else {
        loginError.textContent = response?.error || "API Key inválida. Verifique e tente novamente.";
        loginError.classList.add("visible");
      }
    } catch (err) {
      loginError.textContent = "Erro de conexão. Tente novamente.";
      loginError.classList.add("visible");
    } finally {
      btnLogin.disabled = false;
      btnLogin.textContent = "Salvar API Key";
    }
  }

  async function handleLogout() {
    try {
      await AuthService.logout();
    } catch (err) {
      console.error("[WriteForge] logout error:", err);
    }

    currentUser = null;
    generatedPost = "";
    postTypesLoaded = false;
    postTextarea.value = "";
    resultArea.classList.remove("visible");
    charCount.textContent = "0 / 3000";
    if (apiKeyInput) apiKeyInput.value = "";
    if (postTypeSelect) postTypeSelect.innerHTML = '<option value="">Carregando tipos...</option>';
    showScreen(screenLogin);
  }

  // ─── Post Types ────────────────────────────────────────────────────────────

  async function loadPostTypes() {
    if (postTypesLoaded) return;

    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "GET_POST_TYPES" }, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(res);
        });
      });

      // 401 → token expirado, forçar logout
      if (response && response.code === 401) {
        handleLogout();
        return;
      }

      if (response && response.success && Array.isArray(response.data)) {
        postTypeSelect.innerHTML = '<option value="">Selecione o tipo de post</option>';
        response.data.forEach((pt) => {
          const opt = document.createElement("option");
          opt.value = pt.id;
          opt.textContent = pt.name;
          postTypeSelect.appendChild(opt);
        });
        postTypesLoaded = true;
      } else {
        postTypeSelect.innerHTML = '<option value="">Tipo indisponível</option>';
      }
    } catch (err) {
      console.error("[WriteForge] loadPostTypes error:", err);
      postTypeSelect.innerHTML = '<option value="">Erro ao carregar</option>';
    }
  }

  // ─── Post Generation ──────────────────────────────────────────────────────

  async function handleGenerate() {
    const text = postTextarea.value.trim();

    if (!text) {
      postTextarea.focus();
      postTextarea.style.borderColor = "var(--error)";
      setTimeout(() => {
        postTextarea.style.borderColor = "";
      }, 2000);
      return;
    }

    // UI loading state
    btnGenerate.classList.add("loading");
    btnGenerate.disabled = true;
    resultArea.classList.remove("visible");

    try {
      const postTypeId = postTypeSelect.value || null;

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: "GENERATE_POST",
            payload: { text, postTypeId },
          },
          (res) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
              return;
            }
            resolve(res);
          }
        );
      });

      if (response && response.success && response.data) {
        generatedPost = response.data.generated;
        resultText.textContent = generatedPost;

        // Render suggestions
        if (response.data.suggestions && response.data.suggestions.length > 0) {
          suggestions.innerHTML = response.data.suggestions
            .map(
              (s) => `
              <div class="suggestion-item">
                <span class="suggestion-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                </span>
                <span>${s}</span>
              </div>
            `
            )
            .join("");
        } else {
          suggestions.innerHTML = "";
        }

        resultArea.classList.add("visible");
      } else {
        // Erro ao gerar
        if (response?.code === 401) {
          // Token expirado
          handleLogout();
          return;
        }

        resultText.textContent = "Erro ao gerar post. Tente novamente.";
        suggestions.innerHTML = "";
        resultArea.classList.add("visible");
      }
    } catch (err) {
      console.error("[WriteForge] generate error:", err);
      resultText.textContent = "Erro de conexão. Tente novamente.";
      suggestions.innerHTML = "";
      resultArea.classList.add("visible");
    } finally {
      btnGenerate.classList.remove("loading");
      btnGenerate.disabled = false;
    }
  }

  // ─── Copy ──────────────────────────────────────────────────────────────────

  async function handleCopy() {
    if (!generatedPost) return;

    try {
      await navigator.clipboard.writeText(generatedPost);
      btnCopy.classList.add("copied");
      btnCopy.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Copiado!
      `;

      setTimeout(() => {
        btnCopy.classList.remove("copied");
        btnCopy.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          Copiar post
        `;
      }, 2000);
    } catch (err) {
      console.error("[WriteForge] copy error:", err);
    }
  }

  // ─── Close Panel ──────────────────────────────────────────────────────────

  function handleClose() {
    // Enviar mensagem ao content script via background
    // O content script escuta e fecha o painel
    window.parent.postMessage({ type: "WRITEFORGE_CLOSE" }, "*");

    // Também tentar via chrome.runtime para o content script
    chrome.runtime.sendMessage({ action: "CLOSE_PANEL_REQUEST" });

    // Comunicar diretamente via tabs
    chrome.tabs?.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs?.[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "CLOSE_PANEL" });
      }
    });
  }

  // ─── Char Counter ─────────────────────────────────────────────────────────

  function updateCharCount() {
    const len = postTextarea.value.length;
    charCount.textContent = `${len} / 3000`;
  }

  // ─── Event Listeners ──────────────────────────────────────────────────────

  btnClose.addEventListener("click", handleClose);
  btnLogin.addEventListener("click", handleLogin);
  btnLogout.addEventListener("click", handleLogout);

  // Enter no input de API Key dispara salvar
  if (apiKeyInput) {
    apiKeyInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleLogin();
      }
    });
  }
  btnGenerate.addEventListener("click", handleGenerate);
  btnCopy.addEventListener("click", handleCopy);
  postTextarea.addEventListener("input", updateCharCount);

  // Atalho: Ctrl+Enter para gerar
  postTextarea.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleGenerate();
    }
  });

  // Escutar mensagem postMessage do content script (para fechar)
  window.addEventListener("message", (event) => {
    if (event.data?.type === "WRITEFORGE_CLOSE") {
      // Painel está sendo fechado
    }
  });

  // ─── Auth Invalidation Listener ──────────────────────────────────────────
  // Se o background detecta 401 em qualquer request, envia AUTH_INVALIDATED.
  // Isso garante que o panel volte para login mesmo se o 401 veio de outra aba.

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "AUTH_INVALIDATED") {
      console.warn("[WriteForge] Auth invalidated by background — forcing logout");
      currentUser = null;
      generatedPost = "";
      postTypesLoaded = false;
      if (postTextarea) postTextarea.value = "";
      if (resultArea) resultArea.classList.remove("visible");
      if (charCount) charCount.textContent = "0 / 3000";
      if (postTypeSelect) postTypeSelect.innerHTML = '<option value="">Carregando tipos...</option>';
      showScreen(screenLogin);
    }
  });

  // ─── Init ──────────────────────────────────────────────────────────────────

  checkAuth();
})();
