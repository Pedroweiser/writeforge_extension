// ─── Auth Layer ────────────────────────────────────────────────────────────────
// Camada dedicada: CHECK_AUTH, SET_TOKEN, LOGOUT (API Key auth)
importScripts("backgroundAuth.js");

/**
 * WriteForge Extension — Background Service Worker (MV3)
 *
 * Este arquivo lida com:
 *  - Proxy de requisições ao backend
 *  - Gerenciamento de estado do painel
 *
 * Auth vive em backgroundAuth.js (CHECK_AUTH, SET_TOKEN, LOGOUT).
 */

// ─── Config ────────────────────────────────────────────────────────────────────
const CONFIG = {
  BACKEND_URL: "https://api.writeforge.com",
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function getToken() {
  // Preferir o token da auth layer
  const authToken = BackgroundAuth.getToken();
  if (authToken) return authToken;

  // Fallback: ler direto do storage (chaves legadas)
  const data = await chrome.storage.local.get(["authToken", "wf_auth_token"]);
  return data.wf_auth_token || data.authToken || null;
}

/**
 * Notifica todos os tabs LinkedIn que o token foi invalidado (401).
 * O panel escuta AUTH_INVALIDATED e força logout na UI.
 */
function _broadcastAuthInvalidated() {
  chrome.tabs.query({ url: "https://www.linkedin.com/*" }, (tabs) => {
    if (chrome.runtime.lastError) return;
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { action: "AUTH_INVALIDATED" }).catch(() => {});
    }
  });
}

async function backendFetch(endpoint, options = {}) {
  const token = await getToken();
  if (!token) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const res = await fetch(`${CONFIG.BACKEND_URL}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    if (res.status === 401) {
      await BackgroundAuth.logout();
      // Notificar todos os tabs/panels que a sessão expirou
      _broadcastAuthInvalidated();
      return { success: false, error: "Token expired", code: 401 };
    }

    const data = await res.json();
    return { success: res.ok, data, status: res.status };
  } catch (err) {
    console.error("[WriteForge] backendFetch error:", err);
    return { success: false, error: err.message };
  }
}

// ─── Mock Backend (MVP) ────────────────────────────────────────────────────────

function mockBackendResponse(endpoint, body) {
  if (endpoint === "/me") {
    return {
      success: true,
      data: {
        id: "user_001",
        name: "Pedro WriteForge",
        email: "pedro@writeforge.com",
      },
    };
  }

  if (endpoint === "/posts/generate") {
    const text = body?.text || "";
    return {
      success: true,
      data: {
        original: text,
        generated: `✨ ${text}\n\nEsse conteúdo foi aprimorado pelo WriteForge. Aqui está uma versão profissional e engajante do seu post:\n\n---\n\n${text}\n\n💡 Dica: Posts com storytelling geram 3x mais engajamento.\n\n#WriteForge #LinkedIn #ContentCreation`,
        suggestions: [
          "Adicionar uma pergunta no final para engajamento",
          "Incluir dados ou estatísticas relevantes",
          "Usar emojis estrategicamente",
        ],
      },
    };
  }

  if (endpoint === "/post-types") {
    return {
      success: true,
      data: [
        { id: "engaging", name: "Engajamento" },
        { id: "storytelling", name: "Storytelling" },
        { id: "educational", name: "Educacional" },
        { id: "promotional", name: "Promocional" },
        { id: "personal_brand", name: "Marca Pessoal" },
        { id: "case_study", name: "Caso de Estudo" },
      ],
    };
  }

  return { success: false, error: "Unknown endpoint" };
}

// ─── Message Router ────────────────────────────────────────────────────────────
// Auth messages (CHECK_AUTH, SET_TOKEN, LOGOUT) são tratadas pelo backgroundAuth.js.
// Este listener trata o resto.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, payload } = message;

  // Não tratar ações que pertencem ao backgroundAuth
  if (["CHECK_AUTH", "SET_TOKEN", "LOGOUT"].includes(action)) {
    return false;
  }

  (async () => {
    try {
      switch (action) {
        // ── Backend Proxy ──
        case "BACKEND_REQUEST": {
          const { endpoint, method = "GET", body } = payload;

          const response = await backendFetch(endpoint, {
            method,
            body: body ? JSON.stringify(body) : undefined,
          });

          if (!response.success && response.error !== "Token expired") {
            const mockResponse = mockBackendResponse(endpoint, body);
            sendResponse(mockResponse);
          } else {
            sendResponse(response);
          }
          break;
        }

        case "GET_POST_TYPES": {
          const response = await backendFetch("/post-types", { method: "GET" });

          if (!response.success && response.error !== "Token expired") {
            const mockResponse = mockBackendResponse("/post-types");
            sendResponse(mockResponse);
          } else {
            sendResponse(response);
          }
          break;
        }

        case "GENERATE_POST": {
          const { text, postTypeId } = payload;
          const token = await getToken();

          if (!token) {
            sendResponse({ success: false, error: "Not authenticated" });
            break;
          }

          const response = await backendFetch("/posts/generate", {
            method: "POST",
            body: JSON.stringify({ text, postTypeId }),
          });

          if (!response.success && response.error !== "Token expired") {
            const mockResponse = mockBackendResponse("/posts/generate", { text, postTypeId });
            sendResponse(mockResponse);
          } else {
            sendResponse(response);
          }
          break;
        }

        // ── Panel State ──
        case "GET_PANEL_STATE": {
          const data = await chrome.storage.local.get("panelOpen");
          sendResponse({ panelOpen: data.panelOpen || false });
          break;
        }

        case "SET_PANEL_STATE": {
          await chrome.storage.local.set({ panelOpen: payload.open });
          sendResponse({ success: true });
          break;
        }

        default:
          sendResponse({ success: false, error: `Unknown action: ${action}` });
      }
    } catch (err) {
      console.error("[WriteForge] Message handler error:", err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true;
});

// ─── Startup ───────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  console.log("[WriteForge] Extension installed/updated — auth handled by BackgroundAuth");
});
