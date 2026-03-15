/**
 * WriteForge Extension — Content Script
 *
 * Responsável por:
 *  - Injetar botão flutuante no LinkedIn
 *  - Injetar painel lateral (div, não iframe para login)
 *  - Gerenciar layout do LinkedIn (reduzir/restaurar)
 *  - Comunicação com background via chrome.runtime.sendMessage
 *
 * NUNCA chama o backend diretamente.
 * NUNCA acessa ou expõe tokens.
 */

(function () {
  "use strict";

  // Evitar injeção duplicada
  if (document.getElementById("writeforge-fab")) return;

  // ─── Constants ─────────────────────────────────────────────────────────────
  const PANEL_WIDTH = 420;
  const TRANSITION_MS = 300;
  const PANEL_ID = "writeforge-panel";
  const FAB_ID = "writeforge-fab";

  // ─── State ─────────────────────────────────────────────────────────────────
  let isPanelOpen = false;
  let panelFrame = null;

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Envia mensagem ao background e retorna promise.
   */
  function sendMessage(action, payload = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action, payload }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[WriteForge] sendMessage error:", chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        resolve(response);
      });
    });
  }

  // ─── LinkedIn Layout ──────────────────────────────────────────────────────

  /**
   * Reduz o LinkedIn para abrir espaço ao painel.
   */
  function shrinkLinkedIn() {
    const html = document.documentElement;
    const body = document.body;

    html.style.transition = `width ${TRANSITION_MS}ms ease, margin ${TRANSITION_MS}ms ease`;
    html.style.width = `calc(100% - ${PANEL_WIDTH}px)`;
    html.style.overflowX = "hidden";
    html.style.position = "relative";

    body.style.transition = `width ${TRANSITION_MS}ms ease`;
    body.style.overflowX = "hidden";
  }

  /**
   * Restaura layout original do LinkedIn.
   */
  function restoreLinkedIn() {
    const html = document.documentElement;
    const body = document.body;

    html.style.width = "";
    html.style.overflowX = "";
    html.style.position = "";

    body.style.overflowX = "";

    // Limpar transition após completar
    setTimeout(() => {
      html.style.transition = "";
      body.style.transition = "";
    }, TRANSITION_MS);
  }

  // ─── FAB (Floating Action Button) ─────────────────────────────────────────

  function createFAB() {
    const fab = document.createElement("div");
    fab.id = FAB_ID;
    fab.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 20H21" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M16.5 3.50023C16.8978 3.1024 17.4374 2.87891 18 2.87891C18.2786 2.87891 18.5544 2.93378 18.8118 3.04038C19.0692 3.14699 19.303 3.30324 19.5 3.50023C19.697 3.69721 19.8532 3.93106 19.9598 4.18843C20.0665 4.4458 20.1213 4.72165 20.1213 5.00023C20.1213 5.2788 20.0665 5.55465 19.9598 5.81202C19.8532 6.06939 19.697 6.30324 19.5 6.50023L7 19.0002L3 20.0002L4 16.0002L16.5 3.50023Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    fab.title = "WriteForge — Abrir painel";
    fab.addEventListener("click", togglePanel);
    document.body.appendChild(fab);
    return fab;
  }

  function showFAB() {
    const fab = document.getElementById(FAB_ID);
    if (fab) {
      fab.style.opacity = "1";
      fab.style.pointerEvents = "auto";
      fab.style.transform = "scale(1)";
    }
  }

  function hideFAB() {
    const fab = document.getElementById(FAB_ID);
    if (fab) {
      fab.style.opacity = "0";
      fab.style.pointerEvents = "none";
      fab.style.transform = "scale(0.8)";
    }
  }

  // ─── Panel ─────────────────────────────────────────────────────────────────

  function createPanel() {
    // Container do painel
    const panel = document.createElement("div");
    panel.id = PANEL_ID;

    // Iframe para carregar panel.html (UI interna, NÃO para login)
    const iframe = document.createElement("iframe");
    iframe.id = "writeforge-panel-frame";
    iframe.src = chrome.runtime.getURL("panel.html");
    iframe.style.cssText = "width:100%;height:100%;border:none;background:transparent;";
    iframe.setAttribute("allow", "");

    panel.appendChild(iframe);
    document.body.appendChild(panel);

    panelFrame = iframe;
    return panel;
  }

  function openPanel() {
    let panel = document.getElementById(PANEL_ID);

    if (!panel) {
      panel = createPanel();
    }

    // Forçar reflow antes de animar
    panel.offsetHeight;

    requestAnimationFrame(() => {
      panel.classList.add("writeforge-panel--open");
      shrinkLinkedIn();
      hideFAB();
    });

    isPanelOpen = true;
    sendMessage("SET_PANEL_STATE", { open: true });
  }

  function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    panel.classList.remove("writeforge-panel--open");
    restoreLinkedIn();

    setTimeout(() => {
      showFAB();
    }, TRANSITION_MS);

    isPanelOpen = false;
    sendMessage("SET_PANEL_STATE", { open: false });
  }

  function togglePanel() {
    if (isPanelOpen) {
      closePanel();
    } else {
      openPanel();
    }
  }

  // ─── Message Listener (do panel.js via background) ────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "TOGGLE_PANEL") {
      togglePanel();
      sendResponse({ success: true, open: isPanelOpen });
      return;
    }

    if (message.action === "CLOSE_PANEL") {
      closePanel();
      sendResponse({ success: true });
      return;
    }

    if (message.action === "OPEN_PANEL") {
      openPanel();
      sendResponse({ success: true });
      return;
    }
  });

  // ─── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    // Criar botão flutuante
    createFAB();

    // Verificar se painel estava aberto (persistência ao navegar)
    const state = await sendMessage("GET_PANEL_STATE");
    if (state && state.panelOpen) {
      // Reabrir painel sem animação
      const panel = createPanel();
      panel.classList.add("writeforge-panel--open");
      shrinkLinkedIn();
      hideFAB();
      isPanelOpen = true;
    }
  }

  // Iniciar quando DOM estiver pronto
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
