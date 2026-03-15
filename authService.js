/**
 * WriteForge Extension — Auth Service
 *
 * Módulo utilitário para o panel.js interagir com o background (auth via API Key).
 *
 * NUNCA acessa o backend diretamente — sempre via chrome.runtime.sendMessage.
 * NUNCA expõe API Key no DOM.
 * NUNCA usa sessionStorage, localStorage da página, ou cookies.
 */
const AuthService = {
  /**
   * Verifica se o usuário está autenticado.
   * Background valida a API Key chamando /auth/me.
   * @returns {Promise<{authenticated: boolean, user?: object}>}
   */
  checkAuth() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "CHECK_AUTH" }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ authenticated: false });
          return;
        }
        resolve(response);
      });
    });
  },

  /**
   * Faz logout — limpa API Key do storage.
   * @returns {Promise<{success: boolean}>}
   */
  logout() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "LOGOUT" }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    });
  },

  /**
   * Envia requisição ao backend via background (proxy).
   * @param {string} endpoint - Rota do backend (ex: /posts/generate)
   * @param {string} method - HTTP method
   * @param {object} body - Request body
   * @returns {Promise<object>}
   */
  backendRequest(endpoint, method = "GET", body = null) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "BACKEND_REQUEST",
          payload: { endpoint, method, body },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response);
        }
      );
    });
  },
};

if (typeof window !== "undefined") {
  window.AuthService = AuthService;
}
