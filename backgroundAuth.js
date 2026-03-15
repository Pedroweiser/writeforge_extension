/**
 * WriteForge Extension — Background Auth Layer
 *
 * Autenticação via API Key (sem OAuth, sem iframe, sem launchWebAuthFlow).
 *
 * Fluxo:
 *  1. Usuário cola API Key no painel
 *  2. Panel envia SET_TOKEN { token: apiKey } ao background
 *  3. Background valida chamando GET /auth/me com Bearer apiKey
 *  4. Se 200 → salva em chrome.storage.local, libera CreatePost
 *  5. Se 401 → rejeita, mostra erro
 *
 * Messages: CHECK_AUTH, SET_TOKEN, LOGOUT
 *
 * Regras:
 *  - Toda auth centralizada aqui.
 *  - UI nunca acessa backend direto.
 *  - API Key nunca exposta no DOM após salvar.
 *
 * Carregado via importScripts('backgroundAuth.js') no background.js
 */

const BackgroundAuth = (() => {
  // ─── State em memória ──────────────────────────────────────────────────────
  let _apiKey = null;
  let _isAuthenticated = false;

  // ─── Config ────────────────────────────────────────────────────────────────
  const AUTH_CONFIG = {
    BACKEND_URL: "https://api.writeforge.com",
    AUTH_ME_ENDPOINT: "/auth/me",
    STORAGE_KEY_API_KEY: "wf_api_key",
    STORAGE_KEY_AUTH: "wf_authenticated",
    STORAGE_KEY_USER: "wf_auth_user",
  };

  // ─── Storage ───────────────────────────────────────────────────────────────

  async function _persistState(apiKey, user) {
    _apiKey = apiKey;
    _isAuthenticated = !!apiKey;

    const data = {
      [AUTH_CONFIG.STORAGE_KEY_API_KEY]: apiKey,
      [AUTH_CONFIG.STORAGE_KEY_AUTH]: _isAuthenticated,
    };
    if (user) {
      data[AUTH_CONFIG.STORAGE_KEY_USER] = user;
    }

    await chrome.storage.local.set(data);
    console.log("[BackgroundAuth] State persisted — authenticated:", _isAuthenticated);
  }

  async function _clearState() {
    _apiKey = null;
    _isAuthenticated = false;

    await chrome.storage.local.remove([
      AUTH_CONFIG.STORAGE_KEY_API_KEY,
      AUTH_CONFIG.STORAGE_KEY_AUTH,
      AUTH_CONFIG.STORAGE_KEY_USER,
      // Chaves legadas
      "wf_auth_token",
      "authToken",
      "authenticated",
    ]);
    console.log("[BackgroundAuth] State cleared");
  }

  async function _hydrateFromStorage() {
    const data = await chrome.storage.local.get([
      AUTH_CONFIG.STORAGE_KEY_API_KEY,
      AUTH_CONFIG.STORAGE_KEY_AUTH,
      AUTH_CONFIG.STORAGE_KEY_USER,
    ]);

    _apiKey = data[AUTH_CONFIG.STORAGE_KEY_API_KEY] || null;
    _isAuthenticated = data[AUTH_CONFIG.STORAGE_KEY_AUTH] === true;

    console.log("[BackgroundAuth] Hydrated — authenticated:", _isAuthenticated);
    return {
      apiKey: _apiKey,
      isAuthenticated: _isAuthenticated,
      user: data[AUTH_CONFIG.STORAGE_KEY_USER] || null,
    };
  }

  // ─── Validation ────────────────────────────────────────────────────────────

  /**
   * Valida API Key chamando GET /auth/me com Bearer.
   * @param {string} apiKey
   * @returns {Promise<{ valid: boolean, user?: object, error?: string, networkError?: boolean, status?: number }>}
   */
  async function validateKey(apiKey) {
    if (!apiKey) {
      return { valid: false, error: "No API Key provided" };
    }

    try {
      const res = await fetch(
        `${AUTH_CONFIG.BACKEND_URL}${AUTH_CONFIG.AUTH_ME_ENDPOINT}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (res.status === 401 || res.status === 403) {
        return { valid: false, error: "API Key inválida", status: res.status };
      }

      if (!res.ok) {
        return { valid: false, error: `Erro do servidor (HTTP ${res.status})`, status: res.status };
      }

      const user = await res.json();
      return { valid: true, user };
    } catch (err) {
      console.error("[BackgroundAuth] validateKey network error:", err.message);
      return { valid: false, error: err.message, networkError: true };
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * SET_TOKEN — salva API Key, valida com backend, persiste se válida.
   */
  async function setToken(apiKey) {
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return { success: false, error: "API Key não pode ser vazia" };
    }

    apiKey = apiKey.trim();

    const validation = await validateKey(apiKey);

    if (validation.valid) {
      await _persistState(apiKey, validation.user);
      return { success: true, user: validation.user };
    }

    // Erro de rede: aceitar provisoriamente para não bloquear offline
    if (validation.networkError) {
      console.warn("[BackgroundAuth] Network error, accepting API Key provisionally");
      await _persistState(apiKey, null);
      return { success: true, user: null, provisional: true };
    }

    // Key inválida
    await _clearState();
    return { success: false, error: validation.error || "API Key inválida" };
  }

  /**
   * CHECK_AUTH — verifica se há API Key salva e se ainda é válida.
   */
  async function checkAuth() {
    if (!_apiKey) {
      const stored = await _hydrateFromStorage();
      if (!stored.apiKey) {
        return { authenticated: false };
      }
    }

    const validation = await validateKey(_apiKey);

    if (validation.valid) {
      await _persistState(_apiKey, validation.user);
      return { authenticated: true, user: validation.user };
    }

    if (validation.networkError) {
      const stored = await chrome.storage.local.get(AUTH_CONFIG.STORAGE_KEY_USER);
      return {
        authenticated: _isAuthenticated,
        user: stored[AUTH_CONFIG.STORAGE_KEY_USER] || null,
        offline: true,
      };
    }

    // Key inválida → limpar
    await _clearState();
    return { authenticated: false };
  }

  /**
   * LOGOUT — limpa API Key e estado.
   */
  async function logout() {
    await _clearState();
    return { success: true };
  }

  /**
   * Retorna API Key (uso interno do background apenas).
   */
  function getToken() {
    return _apiKey;
  }

  function isAuthenticated() {
    return _isAuthenticated;
  }

  /**
   * Boot — hidrata e valida key existente.
   */
  async function init() {
    console.log("[BackgroundAuth] Initializing...");
    const stored = await _hydrateFromStorage();

    if (stored.apiKey) {
      const validation = await validateKey(stored.apiKey);
      if (validation.valid) {
        await _persistState(stored.apiKey, validation.user);
        console.log("[BackgroundAuth] Init — API Key valid");
      } else if (validation.networkError) {
        console.log("[BackgroundAuth] Init — offline, keeping cached state");
      } else {
        await _clearState();
        console.log("[BackgroundAuth] Init — API Key invalid, cleared");
      }
    } else {
      console.log("[BackgroundAuth] Init — no stored API Key");
    }
  }

  return {
    init,
    setToken,
    checkAuth,
    logout,
    validateKey,
    getToken,
    isAuthenticated,
    get CONFIG() {
      return { ...AUTH_CONFIG };
    },
  };
})();

// ─── Message Listener ────────────────────────────────────────────────────────
// Actions: CHECK_AUTH, SET_TOKEN, LOGOUT

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, payload } = message;

  if (!["CHECK_AUTH", "SET_TOKEN", "LOGOUT"].includes(action)) {
    return false;
  }

  (async () => {
    try {
      switch (action) {
        case "CHECK_AUTH": {
          const result = await BackgroundAuth.checkAuth();
          sendResponse(result);
          break;
        }

        case "SET_TOKEN": {
          const apiKey = payload?.token;
          if (!apiKey) {
            sendResponse({ success: false, error: "API Key é obrigatória" });
            break;
          }
          const result = await BackgroundAuth.setToken(apiKey);
          sendResponse(result);
          break;
        }

        case "LOGOUT": {
          const result = await BackgroundAuth.logout();
          sendResponse(result);
          break;
        }
      }
    } catch (err) {
      console.error("[BackgroundAuth] Message handler error:", err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true;
});

// ─── Boot ────────────────────────────────────────────────────────────────────
BackgroundAuth.init();
