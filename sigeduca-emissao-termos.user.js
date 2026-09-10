// ==UserScript==
// @name         SIGEDUCA - Emissão de Termos
// @namespace    http://tampermonkey.net/
// @version      1.2.1
// @description  Emissão de termos escolares em HTML/A4 a partir dos dados do cadastro do aluno.
// @match        http://sigeduca.seduc.mt.gov.br/ged/*
// @match        https://sigeduca.seduc.mt.gov.br/ged/*
// @grant        none
// @run-at       document-idle
// @noframes
// @updateURL    https://raw.githubusercontent.com/Jhonatan-Aquino/termosGED/claude/macro-verification-aisf56/sigeduca-emissao-termos.user.js
// @downloadURL  https://raw.githubusercontent.com/Jhonatan-Aquino/termosGED/claude/macro-verification-aisf56/sigeduca-emissao-termos.user.js
// ==/UserScript==

(() => {
  'use strict';

  /*
   * ============================================================
   * SIGEDUCA — EMISSÃO DE TERMOS
   * ============================================================
   *
   * Esta versão:
   *  - encontra a página do cadastro mesmo dentro de iframe;
   *  - lê o cabeçalho (escola, município, ano) na página principal
   *    do GED, fora do iframe da ficha;
   *  - lê os dados diretamente do SIGEDUCA;
   *  - posiciona o menu à esquerda da foto do aluno;
   *  - guarda endereço, telefone e e-mail da escola em cookie;
   *  - solicita o RG do responsável somente para o termo familiar
   *    do estudante menor de idade;
   *  - gera os documentos totalmente em HTML/A4;
   *  - utiliza a data atual no momento da emissão;
   *  - os modelos usam marcadores universais (ex.: <<NOME_ALUNO>>)
   *    em vez de nomes/dados fictícios como placeholder, tornando
   *    a substituição por campo única e evitando cruzamento entre
   *    campos semanticamente diferentes que compartilhavam o mesmo
   *    texto de exemplo.
   *
   * Modelos:
   *  1. Ciência do Tratamento de Dados Pessoais
   *  2. Uso de Imagem e Voz — Menor
   *  3. Uso de Imagem e Voz — Maior
   *  4. Compromisso Familiar — Menor
   *
   * O compromisso familiar para maior de idade ainda será incluído
   * quando o HTML definitivo desse documento estiver pronto.
   */

  const CONFIG = {
    scriptVersion: '1.2.1',
    versionSeenStorageKey: 'sigeduca_termos_versao_vista',

    cookieName: 'sigeduca_termos_config_v1',
    positionCookieName: 'sigeduca_termos_posicao_v1',
    cookieMaxAge: 60 * 60 * 24 * 365,

    panelId: 'sigeducaTermosPanel',
    modalId: 'sigeducaTermosModal',
    styleId: 'sigeducaTermosCSS',
    glowStyleId: 'sigeducaTermosGlowCSS',

    anchorId: 'FOTOALUNO',

    headerPage: '/ged/hwgedprincipal.aspx',
    headerFrameId: 'sigeducaTermosHeaderFrame',

    headerEscola: [
      '#MPW0010TLOTACAO',
      '#span_MPW0010TLOTACAO'
    ],
    headerMunicipio: [
      '#MPW0010TCIDADE',
      '#span_MPW0010TCIDADE'
    ],
    headerAno: [
      '#MPW0010TANOLETIVO',
      '#span_MPW0010TANOLETIVO'
    ],

    retryMs: 700,
    maxRetries: 40
  };

  // ============================================================
  // UTILIDADES
  // ============================================================

  const $ = (root, selector) =>
    root?.querySelector(selector) || null;

  function textOf(root, selector) {
    const el = $(root, selector);

    if (!el) {
      return '';
    }

    return (
      'value' in el
        ? el.value
        : el.textContent || ''
    ).trim();
  }

  function textOfAny(root, selectors) {
    for (const selector of selectors) {
      const value = textOf(root, selector);

      if (value) {
        return value;
      }
    }

    return '';
  }

  function isHeaderDocument(doc) {
    return Boolean(
      textOfAny(
        doc,
        CONFIG.headerEscola
      )
    );
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function normalizeSpace(value) {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function toTitleCase(value) {
    const particles = new Set([
      'a',
      'as',
      'o',
      'os',
      'de',
      'da',
      'das',
      'do',
      'dos',
      'e',
      'em',
      'na',
      'no',
      'nas',
      'nos'
    ]);

    const acronyms = new Set([
      'ee',
      'eee',
      'em',
      'emef',
      'emei',
      'cef',
      'cei',
      'if',
      'ifmt'
    ]);

    return normalizeSpace(value)
      .split(' ')
      .filter(Boolean)
      .map((word, index) => {
        const lower = word.toLowerCase();

        if (
          acronyms.has(
            lower.replace(/\./g, '')
          )
        ) {
          return lower.toUpperCase();
        }

        if (
          index > 0 &&
          particles.has(lower)
        ) {
          return lower;
        }

        return (
          lower.charAt(0).toUpperCase() +
          lower.slice(1)
        );
      })
      .join(' ');
  }

  function splitCodeName(value) {
    const text = normalizeSpace(value);

    const match = text.match(
      /^\s*\d+\s*-\s*(.+)$/
    );

    return match
      ? match[1].trim()
      : text;
  }

  function formatPhone(ddd, number) {
    ddd = normalizeSpace(ddd)
      .replace(/\D/g, '');

    number = normalizeSpace(number)
      .replace(/\D/g, '');

    if (!ddd && !number) {
      return '';
    }

    if (ddd && number) {
      return `(${ddd}) ${number}`;
    }

    return ddd || number;
  }

  function formatCep(value) {
    const digits = normalizeSpace(value)
      .replace(/\D/g, '');

    if (digits.length === 8) {
      return (
        digits.slice(0, 5) +
        '-' +
        digits.slice(5)
      );
    }

    return normalizeSpace(value);
  }

  function formatCpf(value) {
    const digits = normalizeSpace(value)
      .replace(/\D/g, '');

    if (digits.length === 11) {
      return (
        digits.slice(0, 3) +
        '.' +
        digits.slice(3, 6) +
        '.' +
        digits.slice(6, 9) +
        '-' +
        digits.slice(9)
      );
    }

    return normalizeSpace(value);
  }

  function currentDateWritten(date = new Date()) {
    const months = [
      'janeiro',
      'fevereiro',
      'março',
      'abril',
      'maio',
      'junho',
      'julho',
      'agosto',
      'setembro',
      'outubro',
      'novembro',
      'dezembro'
    ];

    return (
      `${date.getDate()} de ` +
      `${months[date.getMonth()]} de ` +
      `${date.getFullYear()}`
    );
  }

  function calculateAge(dateBR) {
    const match = String(dateBR || '')
      .match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

    if (!match) {
      return null;
    }

    const birth = new Date(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1])
    );

    if (Number.isNaN(birth.getTime())) {
      return null;
    }

    const today = new Date();

    let age =
      today.getFullYear() -
      birth.getFullYear();

    const beforeBirthday =
      today.getMonth() <
        birth.getMonth() ||
      (
        today.getMonth() ===
          birth.getMonth() &&
        today.getDate() <
          birth.getDate()
      );

    if (beforeBirthday) {
      age--;
    }

    return age;
  }

  // ============================================================
  // COOKIE
  // ============================================================

  function readCookie(name) {
    const prefix = `${name}=`;

    const item = document.cookie
      .split('; ')
      .find(row =>
        row.startsWith(prefix)
      );

    if (!item) {
      return null;
    }

    try {
      return JSON.parse(
        decodeURIComponent(
          item.slice(prefix.length)
        )
      );
    } catch {
      return null;
    }
  }

  function writeCookie(name, value) {
    document.cookie =
      `${name}=` +
      `${encodeURIComponent(JSON.stringify(value))}; ` +
      `max-age=${CONFIG.cookieMaxAge}; ` +
      `path=/; ` +
      `SameSite=Lax`;
  }

  function getSchoolConfig() {
    return (
      readCookie(CONFIG.cookieName) ||
      {}
    );
  }

  function hasSchoolConfig() {
    const cfg = getSchoolConfig();

    return Boolean(
      normalizeSpace(
        cfg.enderecoEscola
      ) &&
      normalizeSpace(
        cfg.telefoneEscola
      ) &&
      normalizeSpace(
        cfg.emailEscola
      )
    );
  }

  // ============================================================
  // LOCALIZAÇÃO DO CADASTRO
  // ============================================================

  function findStudentDocument(root = document) {
    if (
      $(root, `#${CONFIG.anchorId}`)
    ) {
      return root;
    }

    const iframes =
      root.querySelectorAll('iframe');

    for (const iframe of iframes) {
      try {
        const childDoc =
          iframe.contentDocument;

        if (!childDoc) {
          continue;
        }

        const found =
          findStudentDocument(childDoc);

        if (found) {
          return found;
        }
      } catch {
        // iframe cross-origin
      }
    }

    return null;
  }

  // ============================================================
  // CABEÇALHO (página principal, fora da ficha)
  // ============================================================

  let cachedHeaderDoc = null;

  function walkSameOriginDocs(
    startWin,
    visit
  ) {
    const seen = new Set();

    const queue = [];

    const enqueue = (win) => {
      if (!win || seen.has(win)) {
        return;
      }

      seen.add(win);
      queue.push(win);
    };

    enqueue(startWin);

    while (queue.length) {
      const win = queue.shift();
      let doc = null;

      try {
        doc = win.document;
      } catch {
        continue;
      }

      if (visit(doc) === true) {
        return doc;
      }

      try {
        enqueue(win.parent);
      } catch {
        // cross-origin
      }

      try {
        enqueue(win.top);
      } catch {
        // cross-origin
      }

      try {
        const frames = win.frames;

        for (
          let i = 0;
          i < frames.length;
          i++
        ) {
          try {
            enqueue(frames[i]);
          } catch {
            // cross-origin
          }
        }
      } catch {
        // frames inacessíveis
      }
    }

    return null;
  }

  function findHeaderDocument(fromDoc) {
    if (
      cachedHeaderDoc &&
      isHeaderDocument(cachedHeaderDoc)
    ) {
      return cachedHeaderDoc;
    }

    const startWins = [];

    const addWin = (win) => {
      if (
        win &&
        !startWins.includes(win)
      ) {
        startWins.push(win);
      }
    };

    addWin(fromDoc?.defaultView);
    addWin(window);

    try {
      addWin(window.parent);
    } catch {
      // cross-origin
    }

    try {
      addWin(window.top);
    } catch {
      // cross-origin
    }

    for (const startWin of startWins) {
      const found = walkSameOriginDocs(
        startWin,
        (doc) => isHeaderDocument(doc)
      );

      if (found) {
        cachedHeaderDoc = found;
        return found;
      }
    }

    return null;
  }

  function resolveHostDocument(
    fromDoc
  ) {
    try {
      if (window.top?.document?.body) {
        return window.top.document;
      }
    } catch {
      // top cross-origin
    }

    try {
      if (
        fromDoc?.defaultView?.parent
          ?.document?.body
      ) {
        return fromDoc.defaultView
          .parent.document;
      }
    } catch {
      // parent cross-origin
    }

    return fromDoc || document;
  }

  function loadHeaderFromHiddenIframe(
    fromDoc
  ) {
    return new Promise(
      (resolve, reject) => {
        const hostDoc =
          resolveHostDocument(
            fromDoc
          );

        if (!hostDoc?.body) {
          reject(
            new Error(
              'Não foi possível anexar o iframe do cabeçalho.'
            )
          );
          return;
        }

        const existing =
          hostDoc.getElementById(
            CONFIG.headerFrameId
          );

        if (existing) {
          try {
            const found =
              findHeaderDocument(
                existing.contentDocument
              );

            if (found) {
              resolve(found);
              return;
            }
          } catch {
            existing.remove();
          }
        }

        const iframe =
          hostDoc.createElement(
            'iframe'
          );

        iframe.id =
          CONFIG.headerFrameId;
        iframe.setAttribute(
          'aria-hidden',
          'true'
        );
        iframe.setAttribute(
          'tabindex',
          '-1'
        );
        iframe.src = new URL(
          CONFIG.headerPage,
          window.location.origin
        ).href;
        iframe.style.cssText =
          [
            'position:fixed',
            'left:-12000px',
            'top:0',
            'width:1024px',
            'height:768px',
            'opacity:0',
            'border:0',
            'pointer-events:none'
          ].join(';');

        let tries = 0;

        const timeoutId =
          setTimeout(
            () => {
              iframe.remove();
              reject(
                new Error(
                  'O cabeçalho do SIGEDUCA não carregou a tempo.'
                )
              );
            },
            20000
          );

        const finish = (doc) => {
          clearTimeout(timeoutId);
          cachedHeaderDoc = doc;
          resolve(doc);
        };

        const probe = () => {
          tries++;

          try {
            const childDoc =
              iframe.contentDocument;

            const found =
              walkSameOriginDocs(
                childDoc?.defaultView ||
                  iframe.contentWindow,
                (doc) =>
                  isHeaderDocument(doc)
              );

            if (found) {
              finish(found);
              return;
            }
          } catch {
            // ainda não acessível
          }

          if (tries >= 25) {
            clearTimeout(timeoutId);
            iframe.remove();
            reject(
              new Error(
                'O cabeçalho do SIGEDUCA não foi localizado no iframe oculto.'
              )
            );
            return;
          }

          setTimeout(probe, 400);
        };

        iframe.addEventListener(
          'load',
          () => {
            setTimeout(probe, 300);
          },
          {
            once: true
          }
        );

        hostDoc.body.appendChild(
          iframe
        );
      }
    );
  }

  async function resolveHeaderDocument(
    fromDoc
  ) {
    const existing =
      findHeaderDocument(fromDoc);

    if (existing) {
      return existing;
    }

    return loadHeaderFromHiddenIframe(
      fromDoc
    );
  }

  // ============================================================
  // LEITURA DOS DADOS
  // ============================================================

  function getStudentData(doc, headerDoc) {
    if (!doc) {
      return null;
    }

    const header =
      headerDoc &&
      isHeaderDocument(headerDoc)
        ? headerDoc
        : findHeaderDocument(doc) ||
          doc;

    // ----------------------------------------------------------
    // CABEÇALHO
    // ----------------------------------------------------------

    const escolaHeader =
      textOfAny(
        header,
        CONFIG.headerEscola
      );

    const municipioHeader =
      textOfAny(
        header,
        CONFIG.headerMunicipio
      );

    const escola =
      toTitleCase(
        splitCodeName(
          escolaHeader
        )
      );

    const municipio =
      toTitleCase(
        splitCodeName(
          municipioHeader
        )
      );

    const anoLetivo =
      textOfAny(
        header,
        CONFIG.headerAno
      ) ||
      String(
        new Date().getFullYear()
      );

    // ----------------------------------------------------------
    // IDENTIFICAÇÃO
    // ----------------------------------------------------------

    const nome =
      textOf(
        doc,
        '#CTLGERPESNOM'
      );

    const nomeSocial =
      textOf(
        doc,
        '#CTLGERPESNOMSOC'
      );

    const dataNascimento =
      textOf(
        doc,
        '#CTLGERPESDTANASC'
      );

    const cpfAluno =
      formatCpf(
        textOf(
          doc,
          '#CTLGERPESCPF'
        )
      );

    // ----------------------------------------------------------
    // FILIAÇÃO
    // ----------------------------------------------------------

    const filiacao1 =
      textOf(
        doc,
        '#CTLGERPESNOMMAE'
      );

    const filiacao2 =
      textOf(
        doc,
        '#CTLGERPESNOMPAI'
      );

    // ----------------------------------------------------------
    // RESPONSÁVEL 1
    // ----------------------------------------------------------

    const responsavel =
      textOf(
        doc,
        '#CTLGERPESNOMRESP'
      );

    const cpfResponsavel =
      formatCpf(
        textOf(
          doc,
          '#CTLGERPESRESPCPF'
        )
      );

    // ----------------------------------------------------------
    // ENDEREÇO
    // ----------------------------------------------------------

    const endereco =
      textOf(
        doc,
        '#CTLGERPESEND'
      );

    const numero =
      textOf(
        doc,
        '#CTLGERPESNMRLOG'
      );

    const complemento =
      textOf(
        doc,
        '#CTLGERPESCMPLOG'
      );

    const bairro =
      textOf(
        doc,
        '#CTLGERPESBAIRRO'
      );

    const cep =
      formatCep(
        textOf(
          doc,
          '#CTLGERPESCEP'
        )
      );

    const cidadeEndereco =
      toTitleCase(
        textOf(
          doc,
          '#span_CTLGERPESENDCIDDSC'
        )
      ) ||
      municipio;

    const ufEndereco =
      textOf(
        doc,
        '#span_CTLGERPESENDUF'
      ) ||
      'MT';

    const enderecoPartes = [
      endereco,
      numero
        ? `nº ${numero}`
        : '',
      complemento,
      bairro
    ].filter(Boolean);

    // ----------------------------------------------------------
    // TELEFONES DO RESPONSÁVEL
    // ----------------------------------------------------------

    const celular =
      formatPhone(
        textOf(
          doc,
          '#CTLGERPESTELCELDDDRESP'
        ),
        textOf(
          doc,
          '#CTLGERPESTELCELRESP'
        )
      );

    const residencial =
      formatPhone(
        textOf(
          doc,
          '#CTLGERPESTELRESDDDRESP'
        ),
        textOf(
          doc,
          '#CTLGERPESTELRESRESP'
        )
      );

    const contato =
      formatPhone(
        textOf(
          doc,
          '#CTLGERPESTELCONDDDRESP'
        ),
        textOf(
          doc,
          '#CTLGERPESTELCONRESP'
        )
      );

    const telefonesResponsavel = [
      celular,
      residencial,
      contato
    ]
      .filter(Boolean)
      .filter(
        (value, index, arr) =>
          arr.indexOf(value) === index
      );

    // ----------------------------------------------------------
    // E-MAIL DO RESPONSÁVEL
    // ----------------------------------------------------------

    const emailResponsavel =
      textOf(
        doc,
        '#CTLGERPESEMAILRESP'
      );

    return {
      aluno:
        nomeSocial ||
        nome,

      nomeCivil:
        nome,

      nomeSocial:
        nomeSocial,

      dataNascimento:
        dataNascimento,

      cpfAluno:
        cpfAluno,

      idade:
        calculateAge(
          dataNascimento
        ),

      pai:
        filiacao2,

      mae:
        filiacao1,

      responsavel:
        responsavel,

      cpfResponsavel:
        cpfResponsavel,

      endereco:
        enderecoPartes.join(', '),

      municipio:
        cidadeEndereco,

      uf:
        ufEndereco,

      cep:
        cep,

      telefonesResponsavel:
        telefonesResponsavel,

      emailResponsavel:
        emailResponsavel,

      escola:
        escola,

      municipioCabecalho:
        municipio,

      anoLetivo:
        anoLetivo
    };
  }

  // ============================================================
  // CSS DA INTERFACE
  // ============================================================

  function injectBaseCSS(targetDoc) {
    if (
      targetDoc.getElementById(
        CONFIG.styleId
      )
    ) {
      return;
    }

    const style =
      targetDoc.createElement(
        'style'
      );

    style.id =
      CONFIG.styleId;

    style.textContent = `
      #${CONFIG.panelId}, #${CONFIG.modalId} {
        --sigeduca-font: "SF Pro Text", "SF Pro Icons", "Helvetica Neue", "Helvetica", "Arial", sans-serif;
        --sigeduca-blue: #087dff;
        --sigeduca-navy: #1d1d1f;
        --sigeduca-muted: #666;
        --sigeduca-danger: #ff3b30;
      }

      #${CONFIG.panelId}{
        position:fixed;
        z-index:2147483000;
        width:228px;
        padding:14px 14px 12px;
        background:rgba(237,237,237,.78);
        border:1px solid rgba(214,214,214,.5);
        border-radius:20px;
        box-shadow:0 8px 32px -4px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.06);
        backdrop-filter:blur(14px);
        -webkit-backdrop-filter:blur(14px);
        font-family:var(--sigeduca-font) !important;
        color:var(--sigeduca-navy);
      }

      #${CONFIG.panelId} *{
        box-sizing:border-box;
        font-family:inherit !important;
      }

      #${CONFIG.panelId}.sigeduca-term-dragging,
      #${CONFIG.panelId}.sigeduca-term-dragging *{
        user-select:none;
      }

      #${CONFIG.panelId} .sigeduca-term-handle{
        width:36px;
        height:5px;
        margin:0 auto 10px;
        border-radius:3px;
        background:rgba(0,0,0,.15);
        cursor:grab;
        touch-action:none;
        transition:background .15s ease;
      }

      #${CONFIG.panelId} .sigeduca-term-handle:hover{
        background:rgba(0,0,0,.28);
      }

      #${CONFIG.panelId} .sigeduca-term-handle.sigeduca-term-handle-dragging{
        cursor:grabbing;
        background:rgba(0,0,0,.35);
      }

      #${CONFIG.panelId} .sigeduca-term-header-row{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
        margin:0 0 10px 2px;
      }

      #${CONFIG.panelId} .sigeduca-term-title{
        font-weight:600;
        font-size:14px;
        letter-spacing:-.2px;
        color:var(--sigeduca-navy);
      }

      #${CONFIG.panelId} .sigeduca-term-close{
        display:flex;
        align-items:center;
        justify-content:center;
        flex:none;
        width:20px;
        height:20px;
        padding:0;
        margin:0 2px 0 0;
        border:none;
        border-radius:50%;
        background:transparent;
        color:var(--sigeduca-muted);
        cursor:pointer;
        transition:background .15s ease, color .15s ease;
      }

      #${CONFIG.panelId} .sigeduca-term-close svg{
        width:10px;
        height:10px;
        fill:none;
        stroke:currentColor;
        stroke-width:2;
        stroke-linecap:round;
      }

      #${CONFIG.panelId} .sigeduca-term-close:hover{
        background:rgba(0,0,0,.08);
        color:var(--sigeduca-danger);
      }

      #${CONFIG.panelId}.sigeduca-term-collapsed{
        width:auto;
        padding:10px 16px;
        border-radius:14px 0 0 14px;
        cursor:pointer;
        box-shadow:0 4px 18px -2px rgba(0,0,0,.2);
        transition:padding-right .15s ease, background .15s ease;
      }

      #${CONFIG.panelId}.sigeduca-term-collapsed:hover{
        background:rgba(255,255,255,.92);
        padding-right:22px;
      }

      #${CONFIG.panelId}.sigeduca-term-collapsed .sigeduca-term-handle,
      #${CONFIG.panelId}.sigeduca-term-collapsed .sigeduca-term-close,
      #${CONFIG.panelId}.sigeduca-term-collapsed button.sigeduca-term-btn,
      #${CONFIG.panelId}.sigeduca-term-collapsed button.sigeduca-term-settings{
        display:none;
      }

      #${CONFIG.panelId}.sigeduca-term-collapsed .sigeduca-term-header-row{
        margin:0;
      }

      #${CONFIG.panelId}.sigeduca-term-collapsed .sigeduca-term-title{
        white-space:nowrap;
      }

      #${CONFIG.panelId} button.sigeduca-term-btn{
        display:block;
        width:100%;
        margin:4px 0;
        padding:9px 12px;
        border:none;
        border-radius:12px;
        background:rgba(255,255,255,.55);
        color:#293254;
        text-align:left;
        font-size:12.5px;
        font-weight:500;
        cursor:pointer;
        transition:background .2s ease, transform .15s ease;
      }

      #${CONFIG.panelId} button.sigeduca-term-btn:hover{
        background:rgba(255,255,255,.92);
      }

      #${CONFIG.panelId} button.sigeduca-term-btn:active{
        transform:scale(.98);
      }

      #${CONFIG.panelId} button.sigeduca-term-settings{
        display:flex;
        align-items:center;
        justify-content:center;
        gap:6px;
        width:100%;
        margin-top:8px;
        padding:8px 2px 0;
        border:none;
        border-top:1px solid rgba(0,0,0,.08);
        background:transparent;
        color:var(--sigeduca-muted);
        text-align:center;
        font-size:11px;
        cursor:pointer;
      }

      #${CONFIG.panelId} button.sigeduca-term-settings svg{
        width:12px;
        height:12px;
        flex:none;
        fill:currentColor;
      }

      #${CONFIG.panelId} button.sigeduca-term-settings:hover{
        color:var(--sigeduca-blue);
      }

      #${CONFIG.modalId}{
        position:fixed;
        inset:0;
        z-index:2147483640;
        display:flex;
        align-items:center;
        justify-content:center;
        background:rgba(0,0,0,.4);
        font-family:var(--sigeduca-font) !important;
      }

      #${CONFIG.modalId} *{
        box-sizing:border-box;
        font-family:inherit !important;
      }

      #${CONFIG.modalId} .sigeduca-modal-card{
        width:min(420px,calc(100vw - 30px));
        padding:22px;
        border-radius:20px;
        background:rgba(255,255,255,.85);
        border:1px solid rgba(214,214,214,.5);
        backdrop-filter:blur(20px);
        -webkit-backdrop-filter:blur(20px);
        box-shadow:0 12px 40px -6px rgba(0,0,0,.28);
      }

      #${CONFIG.modalId} h3{
        margin:0 0 7px;
        font-size:17px;
        font-weight:600;
        letter-spacing:-.3px;
        color:var(--sigeduca-navy);
      }

      #${CONFIG.modalId} p{
        margin:0 0 13px;
        font-size:13px;
        line-height:1.45;
        color:#555;
      }

      #${CONFIG.modalId} label{
        display:block;
        margin:10px 0 5px;
        font-size:11.5px;
        font-weight:600;
        color:#293254;
      }

      #${CONFIG.modalId} input{
        width:100%;
        padding:9px 11px;
        border:1px solid rgba(0,0,0,.15);
        border-radius:10px;
        background:rgba(255,255,255,.7);
        font-size:14px;
      }

      #${CONFIG.modalId} input:focus{
        outline:none;
        border-color:var(--sigeduca-blue);
        box-shadow:0 0 0 3px rgba(8,125,255,.15);
      }

      #${CONFIG.modalId} .sigeduca-modal-actions{
        display:flex;
        gap:8px;
        justify-content:flex-end;
        margin-top:16px;
      }

      #${CONFIG.modalId} .sigeduca-modal-actions button{
        padding:8px 16px;
        border-radius:20px;
        border:1px solid rgba(0,0,0,.12);
        background:rgba(255,255,255,.6);
        color:var(--sigeduca-navy);
        cursor:pointer;
        font-size:13px;
        transition:all .2s ease;
      }

      #${CONFIG.modalId} .sigeduca-modal-actions button:hover{
        opacity:.85;
      }

      #${CONFIG.modalId} .sigeduca-modal-actions .primary{
        background:var(--sigeduca-blue);
        color:#fff;
        border-color:var(--sigeduca-blue);
      }

      #${CONFIG.modalId} .sigeduca-modal-actions .primary:hover{
        opacity:1;
        transform:scale(1.02);
      }

      #${CONFIG.modalId} .sigeduca-modal-error{
        display:none;
        margin-top:9px;
        color:var(--sigeduca-danger);
        font-size:12px;
        font-weight:600;
      }
    `;

    targetDoc.head.appendChild(
      style
    );
  }

  // ============================================================
  // POSICIONAMENTO
  // ============================================================

  let panelDragged = false;
  let panelDragPosition = null;

  (function restoreSavedPanelPosition() {
    const saved =
      readCookie(
        CONFIG.positionCookieName
      );

    if (
      saved &&
      typeof saved.left === 'number' &&
      typeof saved.top === 'number'
    ) {
      panelDragged = true;
      panelDragPosition = saved;
    }
  })();

  function savePanelPosition(position) {
    writeCookie(
      CONFIG.positionCookieName,
      position
    );
  }

  function clampPanelPosition(
    targetDoc,
    panel,
    left,
    top
  ) {
    const win =
      targetDoc.defaultView;

    const width =
      panel.offsetWidth || 228;

    const height =
      panel.offsetHeight || 200;

    const maxLeft =
      win.innerWidth -
      width -
      6;

    const maxTop =
      win.innerHeight -
      height -
      6;

    return {
      left:
        Math.min(
          Math.max(left, 6),
          Math.max(6, maxLeft)
        ),

      top:
        Math.min(
          Math.max(top, 6),
          Math.max(6, maxTop)
        )
    };
  }

  function getRectRelativeToHost(
    element,
    hostDoc
  ) {
    const ownRect =
      element.getBoundingClientRect();

    let rect = {
      left: ownRect.left,
      top: ownRect.top,
      right: ownRect.right,
      bottom: ownRect.bottom
    };

    let win =
      element.ownerDocument
        .defaultView;

    while (
      win &&
      win.document !== hostDoc
    ) {
      let frameEl = null;

      try {
        frameEl = win.frameElement;
      } catch {
        frameEl = null;
      }

      if (!frameEl) {
        break;
      }

      const frameRect =
        frameEl.getBoundingClientRect();

      rect = {
        left: rect.left + frameRect.left,
        top: rect.top + frameRect.top,
        right: rect.right + frameRect.left,
        bottom: rect.bottom + frameRect.top
      };

      win =
        frameEl.ownerDocument
          .defaultView;
    }

    return rect;
  }

  function positionPanel(
    studentDoc,
    hostDoc
  ) {
    const panel =
      $(
        hostDoc,
        `#${CONFIG.panelId}`
      );

    if (!panel) {
      return;
    }

    if (
      panel.classList.contains(
        'sigeduca-term-collapsed'
      )
    ) {
      return;
    }

    if (
      panelDragged &&
      panelDragPosition
    ) {
      const clamped =
        clampPanelPosition(
          hostDoc,
          panel,
          panelDragPosition.left,
          panelDragPosition.top
        );

      panel.style.left =
        `${Math.round(clamped.left)}px`;

      panel.style.top =
        `${Math.round(clamped.top)}px`;

      return;
    }

    const photo =
      $(
        studentDoc,
        `#${CONFIG.anchorId}`
      );

    if (!photo) {
      return;
    }

    const rect =
      getRectRelativeToHost(
        photo,
        hostDoc
      );

    const panelWidth =
      panel.offsetWidth || 228;

    const gap = 9;

    let left =
      rect.left -
      panelWidth -
      gap;

    if (left < 6) {
      left =
        rect.right +
        gap;
    }

    let top = rect.top;

    const maxTop =
      hostDoc.defaultView.innerHeight -
      panel.offsetHeight -
      6;

    if (top > maxTop) {
      top =
        Math.max(
          6,
          maxTop
        );
    }

    if (top < 6) {
      top = 6;
    }

    panel.style.left =
      `${Math.round(left)}px`;

    panel.style.top =
      `${Math.round(top)}px`;
  }

  function makePanelDraggable(
    targetDoc,
    panel
  ) {
    const handle =
      $(
        panel,
        '.sigeduca-term-handle'
      );

    if (!handle) {
      return;
    }

    handle.addEventListener(
      'pointerdown',
      (event) => {
        if (
          event.button !== 0 &&
          event.pointerType === 'mouse'
        ) {
          return;
        }

        const rect =
          panel.getBoundingClientRect();

        const startX = event.clientX;
        const startY = event.clientY;
        const startLeft = rect.left;
        const startTop = rect.top;

        panelDragged = true;

        panelDragPosition = {
          left: startLeft,
          top: startTop
        };

        try {
          handle.setPointerCapture(
            event.pointerId
          );
        } catch {
          // captura indisponível
        }

        handle.classList.add(
          'sigeduca-term-handle-dragging'
        );

        panel.classList.add(
          'sigeduca-term-dragging'
        );

        const onMove = (moveEvent) => {
          const dx =
            moveEvent.clientX - startX;

          const dy =
            moveEvent.clientY - startY;

          const clamped =
            clampPanelPosition(
              targetDoc,
              panel,
              startLeft + dx,
              startTop + dy
            );

          panel.style.left =
            `${Math.round(clamped.left)}px`;

          panel.style.top =
            `${Math.round(clamped.top)}px`;

          panelDragPosition = clamped;
        };

        const endDrag = (endEvent) => {
          handle.classList.remove(
            'sigeduca-term-handle-dragging'
          );

          panel.classList.remove(
            'sigeduca-term-dragging'
          );

          handle.removeEventListener(
            'pointermove',
            onMove
          );

          handle.removeEventListener(
            'pointerup',
            endDrag
          );

          handle.removeEventListener(
            'pointercancel',
            endDrag
          );

          handle.removeEventListener(
            'lostpointercapture',
            endDrag
          );

          if (panelDragPosition) {
            savePanelPosition(
              panelDragPosition
            );
          }

          try {
            handle.releasePointerCapture(
              endEvent.pointerId
            );
          } catch {
            // captura já perdida/indisponível
          }
        };

        handle.addEventListener(
          'pointermove',
          onMove
        );

        /*
         * Em páginas com iframes/postbacks (como o SIGEDUCA), a
         * captura do ponteiro pode ser perdida sem que um
         * "pointerup" limpo chegue a disparar. Sem essa rede de
         * segurança, o listener de "pointermove" ficava vazando e
         * reagia a qualquer passada do mouse sobre o handle usando
         * as coordenadas do arraste anterior — causando o "piscar"
         * ao pairar sobre a posição antiga.
         */
        handle.addEventListener(
          'pointerup',
          endDrag,
          { once: true }
        );

        handle.addEventListener(
          'pointercancel',
          endDrag,
          { once: true }
        );

        handle.addEventListener(
          'lostpointercapture',
          endDrag,
          { once: true }
        );

        event.preventDefault();
      }
    );
  }

  function collapsePanel(panel) {
    if (!panelDragPosition) {
      const rect =
        panel.getBoundingClientRect();

      panelDragPosition = {
        left: rect.left,
        top: rect.top
      };
    }

    panelDragged = true;

    savePanelPosition(
      panelDragPosition
    );

    panel.classList.add(
      'sigeduca-term-collapsed'
    );

    panel.style.left = '';
    panel.style.right = '0px';
  }

  function expandPanel(
    hostDoc,
    panel
  ) {
    panel.classList.remove(
      'sigeduca-term-collapsed'
    );

    panel.style.right = '';

    const clamped =
      clampPanelPosition(
        hostDoc,
        panel,
        panelDragPosition.left,
        panelDragPosition.top
      );

    panel.style.left =
      `${Math.round(clamped.left)}px`;

    panel.style.top =
      `${Math.round(clamped.top)}px`;
  }

  function removePanel(targetDoc) {
    $(
      targetDoc,
      `#${CONFIG.panelId}`
    )?.remove();
  }

  // ============================================================
  // EFEITO DE VERSÃO (NOVO / ATUALIZADO)
  // ============================================================

  let versionGlowTriggered = false;

  function injectVersionGlowCSS(targetDoc) {
    if (
      targetDoc.getElementById(
        CONFIG.glowStyleId
      )
    ) {
      return;
    }

    const style =
      targetDoc.createElement(
        'style'
      );

    style.id =
      CONFIG.glowStyleId;

    style.textContent = `
      .sigeduca-glow-layer{
        position:absolute;
        inset:0;
        z-index:-1;
        border-radius:inherit;
        opacity:0;
        pointer-events:none;
      }

      .sigeduca-glow-layer.sigeduca-glow-before{
        background:conic-gradient(
          from 0deg,
          rgba(8,125,255,.45),
          transparent,
          rgba(52,199,89,.4),
          transparent,
          rgba(8,125,255,.5)
        );
        filter:blur(26px);
        animation:sigeduca-glow-reverse 2000ms ease-out;
      }

      .sigeduca-glow-layer.sigeduca-glow-after{
        background:conic-gradient(
          from 0deg,
          rgba(52,199,89,.5),
          rgba(8,125,255,.6),
          transparent,
          rgba(255,255,255,.75),
          rgba(52,199,89,.5)
        );
        filter:blur(38px);
        animation:sigeduca-glow-forward 2000ms ease-out;
      }

      @keyframes sigeduca-glow-forward{
        0%{
          opacity:0;
          transform:scale(1);
        }
        10%{
          opacity:1;
          transform:scale(1.12);
        }
        50%{
          opacity:.75;
          transform:scale(1.05);
        }
        100%{
          opacity:0;
          transform:scale(1);
        }
      }

      @keyframes sigeduca-glow-reverse{
        0%{
          opacity:0;
          transform:scale(1);
        }
        15%{
          opacity:.9;
          transform:scale(1.08);
        }
        55%{
          opacity:.5;
          transform:scale(1.03);
        }
        100%{
          opacity:0;
          transform:scale(1);
        }
      }
    `;

    targetDoc.head.appendChild(
      style
    );
  }

  function triggerVersionGlow(
    targetDoc,
    panel
  ) {
    if (versionGlowTriggered) {
      return;
    }

    versionGlowTriggered = true;

    let lastSeenVersion = null;

    try {
      lastSeenVersion =
        window.localStorage.getItem(
          CONFIG.versionSeenStorageKey
        );
    } catch {
      // localStorage indisponível (ex.: modo privado)
    }

    if (
      lastSeenVersion ===
      CONFIG.scriptVersion
    ) {
      return;
    }

    injectVersionGlowCSS(targetDoc);

    const glowBefore =
      targetDoc.createElement(
        'div'
      );

    const glowAfter =
      targetDoc.createElement(
        'div'
      );

    glowBefore.className =
      'sigeduca-glow-layer sigeduca-glow-before';

    glowAfter.className =
      'sigeduca-glow-layer sigeduca-glow-after';

    const duration = 2000;
    const delay = 400;

    setTimeout(
      () => {
        panel.prepend(glowAfter);
        panel.prepend(glowBefore);

        setTimeout(
          () => {
            glowBefore.remove();
            glowAfter.remove();

            try {
              window.localStorage.setItem(
                CONFIG.versionSeenStorageKey,
                CONFIG.scriptVersion
              );
            } catch {
              // localStorage indisponível
            }
          },
          duration
        );
      },
      delay
    );
  }

  // ============================================================
  // PAINEL
  // ============================================================

  function createPanel(
    studentDoc,
    hostDoc
  ) {
    injectBaseCSS(hostDoc);
    removePanel(hostDoc);

    const panel =
      hostDoc.createElement(
        'div'
      );

    panel.id =
      CONFIG.panelId;

    panel.innerHTML = `
      <div
        class="sigeduca-term-handle"
        title="Arraste para mover"
        aria-hidden="true"
      ></div>

      <div class="sigeduca-term-header-row">
        <div class="sigeduca-term-title">
          Emitir Documentos
        </div>

        <button
          class="sigeduca-term-close"
          title="Fechar"
          aria-label="Fechar"
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M1 1l10 10M11 1L1 11"/>
          </svg>
        </button>
      </div>

      <button
        class="sigeduca-term-btn"
        data-term="data"
      >
        Ciência do Tratamento de Dados
      </button>

      <button
        class="sigeduca-term-btn"
        data-term="imgMinor"
      >
        Uso de Imagem — Menor de idade
      </button>

      <button
        class="sigeduca-term-btn"
        data-term="imgMajor"
      >
        Uso de Imagem — Maior de idade
      </button>

      <button
        class="sigeduca-term-btn"
        data-term="familyMinor"
      >
        Compromisso Familiar — Menor
      </button>

      <button
        class="sigeduca-term-btn"
        data-term="authMatricula"
      >
        Autorização de Matrícula/Transferência
      </button>

      <button
        class="sigeduca-term-settings"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M17.14 10.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.62-.94l-.36-2.54A.5.5 0 0 0 12 0H8a.5.5 0 0 0-.5.46l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L.61 6.52a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L.73 12.2a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.05.26.28.46.5.46h4c.25 0 .46-.2.5-.46l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.24.1.5 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM10 13.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>
        </svg>
        Configurar dados da escola
      </button>
    `;

    hostDoc.body.appendChild(
      panel
    );

    positionPanel(
      studentDoc,
      hostDoc
    );

    makePanelDraggable(
      hostDoc,
      panel
    );

    panel
      .querySelectorAll(
        '.sigeduca-term-btn'
      )
      .forEach(btn => {
        btn.addEventListener(
          'click',
          async () => {
            const termId =
              btn.dataset.term;

            try {
              await emitTerm(
                studentDoc,
                hostDoc,
                termId
              );
            } catch (error) {
              console.error(
                '[SIGEDUCA Termos]',
                error
              );

              alert(
                error?.message ||
                'Não foi possível emitir o documento.'
              );
            }
          }
        );
      });

    panel
      .querySelector(
        '.sigeduca-term-settings'
      )
      .addEventListener(
        'click',
        async () => {
          try {
            await showSchoolConfigModal(
              hostDoc,
              true
            );
          } catch (error) {
            console.error(
              '[SIGEDUCA Termos]',
              error
            );
          }
        }
      );

    panel
      .querySelector(
        '.sigeduca-term-close'
      )
      .addEventListener(
        'click',
        (event) => {
          event.stopPropagation();
          collapsePanel(panel);
        }
      );

    panel.addEventListener(
      'click',
      () => {
        if (
          panel.classList.contains(
            'sigeduca-term-collapsed'
          )
        ) {
          expandPanel(
            hostDoc,
            panel
          );
        }
      }
    );

    triggerVersionGlow(
      hostDoc,
      panel
    );

    return panel;
  }

  // ============================================================
  // MODAIS
  // ============================================================

  function closeModal(targetDoc) {
    $(
      targetDoc,
      `#${CONFIG.modalId}`
    )?.remove();
  }

  function createModalShell(
    targetDoc,
    title,
    description
  ) {
    closeModal(
      targetDoc
    );

    injectBaseCSS(
      targetDoc
    );

    const overlay =
      targetDoc.createElement(
        'div'
      );

    overlay.id =
      CONFIG.modalId;

    const card =
      targetDoc.createElement(
        'div'
      );

    card.className =
      'sigeduca-modal-card';

    card.innerHTML = `
      <h3>
        ${escapeHtml(title)}
      </h3>

      <p>
        ${escapeHtml(description)}
      </p>
    `;

    overlay.appendChild(
      card
    );

    targetDoc.body.appendChild(
      overlay
    );

    return {
      overlay,
      card
    };
  }

  function showSchoolConfigModal(
    targetDoc,
    force = false
  ) {
    return new Promise(
      (resolve, reject) => {
        const current =
          getSchoolConfig();

        if (
          !force &&
          hasSchoolConfig()
        ) {
          resolve(
            current
          );

          return;
        }

        const {
          overlay,
          card
        } =
          createModalShell(
            targetDoc,
            'Dados da unidade escolar',
            'Informe os dados que não aparecem no cabeçalho do SIGEDUCA. Eles serão guardados em um cookie neste navegador e reutilizados nas próximas emissões.'
          );

        card.insertAdjacentHTML(
          'beforeend',
          `
          <label for="sigeducaEndereco">
            Endereço da escola
          </label>

          <input
            id="sigeducaEndereco"
            type="text"
            autocomplete="off"
            value="${escapeHtml(
              current.enderecoEscola ||
              ''
            )}"
          >

          <label for="sigeducaTel">
            Telefone da escola
          </label>

          <input
            id="sigeducaTel"
            type="text"
            autocomplete="off"
            value="${escapeHtml(
              current.telefoneEscola ||
              ''
            )}"
          >

          <label for="sigeducaEmail">
            E-mail da escola
          </label>

          <input
            id="sigeducaEmail"
            type="email"
            autocomplete="off"
            value="${escapeHtml(
              current.emailEscola ||
              ''
            )}"
          >

          <div
            class="sigeduca-modal-error"
            id="sigeducaModalError"
          >
            Preencha o endereço, o telefone e o e-mail da escola.
          </div>

          <div
            class="sigeduca-modal-actions"
          >
            <button
              type="button"
              id="sigeducaCancel"
            >
              Cancelar
            </button>

            <button
              type="button"
              id="sigeducaSave"
              class="primary"
            >
              Salvar
            </button>
          </div>
          `
        );

        const save = () => {
          const enderecoEscola =
            normalizeSpace(
              card
                .querySelector(
                  '#sigeducaEndereco'
                )
                ?.value
            );

          const telefoneEscola =
            normalizeSpace(
              card
                .querySelector(
                  '#sigeducaTel'
                )
                ?.value
            );

          const emailEscola =
            normalizeSpace(
              card
                .querySelector(
                  '#sigeducaEmail'
                )
                ?.value
            );

          if (
            !enderecoEscola ||
            !telefoneEscola ||
            !emailEscola
          ) {
            card
              .querySelector(
                '#sigeducaModalError'
              )
              .style.display =
              'block';

            return;
          }

          const value = {
            enderecoEscola,
            telefoneEscola,
            emailEscola
          };

          writeCookie(
            CONFIG.cookieName,
            value
          );

          closeModal(
            targetDoc
          );

          resolve(value);
        };

        card
          .querySelector(
            '#sigeducaSave'
          )
          .addEventListener(
            'click',
            save
          );

        card
          .querySelector(
            '#sigeducaCancel'
          )
          .addEventListener(
            'click',
            () => {
              closeModal(
                targetDoc
              );

              if (force) {
                reject(
                  new Error(
                    'Operação cancelada pelo usuário.'
                  )
                );
              } else {
                resolve(null);
              }
            }
          );
      }
    );
  }

  function showResponsibleRGModal(
    targetDoc,
    responsavelAtual
  ) {
    return new Promise(
      (resolve, reject) => {
        const { card } =
          createModalShell(
            targetDoc,
            'RG do responsável',
            `O RG do responsável "${responsavelAtual || 'não informado'}" não está disponível no cadastro. Informe o RG para emitir este termo, ou deixe em branco para usar o CPF do responsável no lugar do RG.`
          );

        card.insertAdjacentHTML(
          'beforeend',
          `
          <label for="sigeducaRG">
            RG do responsável (opcional)
          </label>

          <input
            id="sigeducaRG"
            type="text"
            autocomplete="off"
            placeholder="Ex.: 12.345.678-9 (deixe em branco para usar o CPF)"
          >

          <div
            class="sigeduca-modal-actions"
          >
            <button
              type="button"
              id="sigeducaCancel"
            >
              Cancelar
            </button>

            <button
              type="button"
              id="sigeducaSave"
              class="primary"
            >
              Continuar
            </button>
          </div>
          `
        );

        const save = () => {
          const rg =
            normalizeSpace(
              card
                .querySelector(
                  '#sigeducaRG'
                )
                ?.value
            );

          closeModal(
            targetDoc
          );

          resolve(rg);
        };

        card
          .querySelector(
            '#sigeducaSave'
          )
          .addEventListener(
            'click',
            save
          );

        card
          .querySelector(
            '#sigeducaCancel'
          )
          .addEventListener(
            'click',
            () => {
              closeModal(
                targetDoc
              );

              reject(
                new Error(
                  'Operação cancelada pelo usuário.'
                )
              );
            }
          );
      }
    );
  }

  // ============================================================
  // SUBSTITUIÇÃO DE DADOS
  // ============================================================

  function replaceAllSafe(
    html,
    search,
    replacement
  ) {
    return html
      .split(search)
      .join(
        escapeHtml(
          replacement
        )
      );
  }

  function replaceRaw(
    html,
    search,
    replacement
  ) {
    return html
      .split(search)
      .join(
        replacement
      );
  }

  // ============================================================
  // TERMO — DADOS PESSOAIS
  // ============================================================

  function buildDataTerm(
    data,
    schoolCfg
  ) {
    let html =
      TEMPLATES.data;

    html =
      replaceAllSafe(
        html,
        '<<NOME_RESPONSAVEL>>',
        data.responsavel ||
        data.aluno
      );

    html =
      replaceAllSafe(
        html,
        '<<NOME_ALUNO>>',
        data.aluno
      );

    html =
      replaceAllSafe(
        html,
        '<<ESCOLA_NOME>>',
        data.escola
      );

    html =
      replaceAllSafe(
        html,
        '<<ESCOLA_ENDERECO>>',
        schoolCfg.enderecoEscola
      );

    html =
      replaceAllSafe(
        html,
        '<<ESCOLA_TELEFONE>>',
        schoolCfg.telefoneEscola
      );

    html =
      replaceAllSafe(
        html,
        '<<ESCOLA_EMAIL>>',
        schoolCfg.emailEscola
      );

    const dateText =
      currentDateWritten();

    html =
      replaceAllSafe(
        html,
        '<<LOCAL_E_DATA>>',
        `${data.municipioCabecalho || data.municipio} - MT, ${dateText}.`
      );

    return html;
  }

  // ============================================================
  // TERMO — IMAGEM MENOR
  // ============================================================

  function buildImageMinorTerm(
    data
  ) {
    let html =
      TEMPLATES.imgMinor;

    html =
      replaceAllSafe(
        html,
        '<<NOME_RESPONSAVEL>>',
        data.responsavel
      );

    html =
      replaceAllSafe(
        html,
        '<<NOME_ALUNO>>',
        data.aluno
      );

    html =
      replaceAllSafe(
        html,
        '<<ESCOLA_NOME_CURTO>>',
        data.escola.replace(
          /^Escola Estadual\s*/i,
          ''
        ).trim()
      );

    const todayText =
      currentDateWritten();

    html =
      replaceAllSafe(
        html,
        '<<LOCAL_E_DATA>>',
        `${data.municipioCabecalho || data.municipio} - MT, ${todayText}.`
      );

    return html;
  }

  // ============================================================
  // TERMO — IMAGEM MAIOR
  // ============================================================

  function buildImageMajorTerm(
    data
  ) {
    let html =
      TEMPLATES.imgMajor;

    html =
      replaceAllSafe(
        html,
        '<<NOME_ALUNO>>',
        data.aluno
      );

    html =
      replaceAllSafe(
        html,
        '<<ESCOLA_NOME_CURTO>>',
        data.escola.replace(
          /^Escola Estadual\s*/i,
          ''
        ).trim()
      );

    const todayText =
      currentDateWritten();

    html =
      replaceAllSafe(
        html,
        '<<LOCAL_E_DATA>>',
        `${data.municipioCabecalho || data.municipio} - MT, ${todayText}.`
      );

    return html;
  }

  // ============================================================
  // TERMO — COMPROMISSO FAMILIAR MENOR
  // ============================================================

  function buildFamilyMinorTerm(
    data,
    responsibleRG
  ) {
    let html =
      TEMPLATES.familyMinor;

    html =
      replaceAllSafe(
        html,
        '<<NOME_RESPONSAVEL>>',
        data.responsavel
      );

    html =
      replaceAllSafe(
        html,
        '<<NOME_MAE>>',
        data.mae
      );

    html =
      replaceAllSafe(
        html,
        '<<NOME_PAI>>',
        data.pai
      );

    html =
      replaceAllSafe(
        html,
        '<<NOME_ALUNO>>',
        data.aluno
      );

    html =
      replaceAllSafe(
        html,
        '<<ESCOLA_NOME_CURTO>>',
        data.escola.replace(
          /^Escola Estadual\s*/i,
          ''
        ).trim()
      );

    html =
      replaceAllSafe(
        html,
        '<<ANO_LETIVO>>',
        data.anoLetivo
      );

    html =
      replaceAllSafe(
        html,
        '<<ENDERECO_ALUNO>>',
        data.endereco
      );

    html =
      replaceAllSafe(
        html,
        '<<MUNICIPIO>>',
        data.municipio
      );

    html =
      replaceAllSafe(
        html,
        '<<RG_RESPONSAVEL>>',
        responsibleRG ||
        data.cpfResponsavel ||
        '[RG DO RESPONSÁVEL]'
      );

    html =
      replaceAllSafe(
        html,
        '<<CPF_RESPONSAVEL>>',
        data.cpfResponsavel ||
        '[CPF DO RESPONSÁVEL]'
      );

    html =
      replaceAllSafe(
        html,
        '<<TELEFONES_RESPONSAVEL>>',
        data.telefonesResponsavel.join(' / ')
      );

    html =
      replaceAllSafe(
        html,
        '<<EMAIL_RESPONSAVEL>>',
        data.emailResponsavel
      );

    const todayText =
      currentDateWritten();

    html =
      replaceAllSafe(
        html,
        '<<LOCAL_E_DATA>>',
        `${data.municipioCabecalho || data.municipio} - MT,\n${todayText}.`
      );

    return html;
  }

  // ============================================================
  // TERMO — AUTORIZAÇÃO DE MATRÍCULA/TRANSFERÊNCIA
  // ============================================================

  function buildAuthMatriculaTerm(
    data,
    responsibleRG
  ) {
    let html =
      TEMPLATES.authMatricula;

    html =
      replaceAllSafe(
        html,
        '<<ESCOLA_NOME>>',
        data.escola
      );

    html =
      replaceAllSafe(
        html,
        '<<NOME_RESPONSAVEL>>',
        data.responsavel
      );

    html =
      replaceAllSafe(
        html,
        '<<TELEFONES_RESPONSAVEL>>',
        data.telefonesResponsavel.join(' / ') ||
        '[TELEFONE DO RESPONSÁVEL]'
      );

    html =
      replaceAllSafe(
        html,
        '<<CPF_RESPONSAVEL>>',
        data.cpfResponsavel ||
        '[CPF DO RESPONSÁVEL]'
      );

    html =
      replaceAllSafe(
        html,
        '<<RG_RESPONSAVEL>>',
        responsibleRG ||
        data.cpfResponsavel ||
        '[RG DO RESPONSÁVEL]'
      );

    html =
      replaceAllSafe(
        html,
        '<<NOME_ALUNO>>',
        data.aluno
      );

    html =
      replaceAllSafe(
        html,
        '<<CPF_ALUNO>>',
        data.cpfAluno ||
        '[CPF DO ALUNO]'
      );

    const todayText =
      currentDateWritten();

    html =
      replaceAllSafe(
        html,
        '<<LOCAL_E_DATA>>',
        `${data.municipioCabecalho || data.municipio} - MT, ${todayText}.`
      );

    return html;
  }

  // ============================================================
  // IMPRESSÃO
  // ============================================================

  function openPrintDocument(
    html,
    title
  ) {
    /*
     * Sem "noopener,noreferrer", pois precisamos manter
     * a referência para a nova janela.
     */
    const printWindow =
      window.open(
        '',
        '_blank'
      );

    if (!printWindow) {
      throw new Error(
        'O navegador bloqueou a nova janela. Permita pop-ups para o SIGEDUCA e tente novamente.'
      );
    }

    printWindow.document.open();

    printWindow.document.write(
      html
    );

    printWindow.document.close();

    printWindow.document.title =
      title;

    const tryPrint = () => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch (error) {
        console.error(
          '[SIGEDUCA Termos] Falha ao imprimir:',
          error
        );
      }
    };

    if (
      printWindow.document.readyState ===
      'complete'
    ) {
      setTimeout(
        tryPrint,
        350
      );
    } else {
      printWindow.addEventListener(
        'load',
        () => {
          setTimeout(
            tryPrint,
            350
          );
        },
        {
          once: true
        }
      );
    }
  }

  // ============================================================
  // EMISSÃO
  // ============================================================

  async function emitTerm(
    studentDoc,
    hostDoc,
    termId
  ) {
    let headerDoc = null;

    try {
      headerDoc =
        await resolveHeaderDocument(
          studentDoc
        );
    } catch (error) {
      console.warn(
        '[SIGEDUCA Termos] Cabeçalho:',
        error
      );
    }

    const data =
      getStudentData(
        studentDoc,
        headerDoc
      );

    if (!data) {
      throw new Error(
        'Não foi possível localizar a página do cadastro do aluno.'
      );
    }

    if (!data.aluno) {
      throw new Error(
        'O nome do aluno não foi localizado no cadastro.'
      );
    }

    if (!data.escola) {
      throw new Error(
        'O nome da escola não foi localizado no cabeçalho do SIGEDUCA.'
      );
    }

    if (!data.municipio) {
      throw new Error(
        'O município não foi localizado no cabeçalho do SIGEDUCA.'
      );
    }

    // ----------------------------------------------------------
    // DADOS DA ESCOLA
    // ----------------------------------------------------------

    let schoolCfg =
      getSchoolConfig();

    if (
      !hasSchoolConfig()
    ) {
      schoolCfg =
        await showSchoolConfigModal(
          hostDoc,
          false
        );

      if (!schoolCfg) {
        throw new Error(
          'Emissão cancelada.'
        );
      }
    }

    let html;

    // ----------------------------------------------------------
    // ESCOLHA DO MODELO
    // ----------------------------------------------------------

    switch (termId) {

      case 'data':

        html =
          buildDataTerm(
            data,
            schoolCfg
          );

        break;

      case 'imgMinor':

        if (
          data.idade !== null &&
          data.idade >= 18
        ) {
          throw new Error(
            `O cadastro indica ${data.idade} anos. Este termo é destinado a estudante menor de idade.`
          );
        }

        html =
          buildImageMinorTerm(
            data
          );

        break;

      case 'imgMajor':

        if (
          data.idade !== null &&
          data.idade < 18
        ) {
          throw new Error(
            `O cadastro indica ${data.idade} anos. Este termo é destinado a estudante maior de idade.`
          );
        }

        html =
          buildImageMajorTerm(
            data
          );

        break;

      case 'familyMinor': {

        if (
          data.idade !== null &&
          data.idade >= 18
        ) {
          throw new Error(
            `O cadastro indica ${data.idade} anos. Este termo é destinado a estudante menor de idade.`
          );
        }

        if (!data.responsavel) {
          throw new Error(
            'O nome do Responsável 1 não está preenchido no cadastro.'
          );
        }

        if (!data.emailResponsavel) {
          throw new Error(
            'O e-mail do Responsável 1 não está preenchido no cadastro.'
          );
        }

        if (
          !data.telefonesResponsavel.length
        ) {
          throw new Error(
            'Nenhum telefone foi encontrado no bloco do Responsável 1.'
          );
        }

        const rg =
          await showResponsibleRGModal(
            hostDoc,
            data.responsavel
          );

        html =
          buildFamilyMinorTerm(
            data,
            rg
          );

        break;
      }

      case 'authMatricula': {

        if (!data.responsavel) {
          throw new Error(
            'O nome do Responsável 1 não está preenchido no cadastro.'
          );
        }

        const rgAuth =
          await showResponsibleRGModal(
            hostDoc,
            data.responsavel
          );

        html =
          buildAuthMatriculaTerm(
            data,
            rgAuth
          );

        break;
      }

      default:

        throw new Error(
          'Tipo de documento não reconhecido.'
        );
    }

    // ----------------------------------------------------------
    // TÍTULOS
    // ----------------------------------------------------------

    const titleMap = {
      data:
        'Termo de Ciência do Tratamento de Dados Pessoais',

      imgMinor:
        'Termo de Ciência para Uso de Imagem e Voz — Menor',

      imgMajor:
        'Termo de Ciência para Uso de Imagem e Voz — Maior',

      familyMinor:
        'Termo de Compromisso Familiar — Menor',

      authMatricula:
        'Autorização para Matrícula e Retirada de Transferência/Histórico Escolar'
    };

    openPrintDocument(
      html,
      `${titleMap[termId]} — ${data.aluno}`
    );
  }

  // ============================================================
  // INICIALIZAÇÃO
  // ============================================================

  let attempts = 0;
  let installedDoc = null;
  let installedHostDoc = null;
  let isHostOwner = false;

  /*
   * O SIGEDUCA carrega a ficha do aluno dentro de um iframe cuja
   * URL também bate com o @match do script — então, sem @noframes,
   * o Tampermonkey injeta uma segunda instância inteira dentro
   * desse iframe. As duas instâncias resolvem o mesmo documento
   * "hospedeiro" (topo da página) para montar o painel, mas cada
   * uma mantém seu próprio estado de posição em memória: sempre que
   * o intervalo de recheque de uma instância "perdedora" disparava,
   * ele reaplicava a posição antiga que só ela conhecia, brigando
   * com a instância "dona" a cada ~2,5s — o vaivém constante e
   * independente do mouse. @noframes evita a duplicidade na
   * origem; esta trava é uma segunda camada de segurança para o
   * caso de outro cenário produzir instâncias concorrentes.
   */
  function claimHostOwnership(hostDoc) {
    const win = hostDoc.defaultView;

    if (win.__sigeducaTermosOwner) {
      return false;
    }

    win.__sigeducaTermosOwner = true;

    return true;
  }

  function install() {
    const studentDoc =
      findStudentDocument();

    if (!studentDoc) {
      attempts++;

      if (
        attempts <
        CONFIG.maxRetries
      ) {
        setTimeout(
          install,
          CONFIG.retryMs
        );
      }

      return;
    }

    /*
     * O painel é montado no documento "hospedeiro" (o topo
     * acessível da árvore de frames), não no documento do
     * cadastro em si — assim ele não fica preso dentro do
     * iframe da ficha, podendo ser arrastado para qualquer
     * canto da janela.
     */
    const hostDoc =
      resolveHostDocument(
        studentDoc
      );

    if (
      !claimHostOwnership(
        hostDoc
      )
    ) {
      return;
    }

    isHostOwner = true;

    if (
      $(
        hostDoc,
        `#${CONFIG.panelId}`
      )
    ) {
      positionPanel(
        studentDoc,
        hostDoc
      );
    } else {
      createPanel(
        studentDoc,
        hostDoc
      );
    }

    installedDoc =
      studentDoc;

    installedHostDoc =
      hostDoc;

    const win =
      hostDoc.defaultView;

    const reposition = () => {
      if (
        installedDoc &&
        installedHostDoc
      ) {
        positionPanel(
          installedDoc,
          installedHostDoc
        );
      }
    };

    win.addEventListener(
      'resize',
      reposition,
      {
        passive: true
      }
    );

    win.addEventListener(
      'scroll',
      reposition,
      {
        passive: true
      }
    );

    const observer =
      new MutationObserver(
        () => {

          if (
            !$(
              hostDoc,
              `#${CONFIG.panelId}`
            ) &&
            $(
              studentDoc,
              `#${CONFIG.anchorId}`
            )
          ) {
            createPanel(
              studentDoc,
              hostDoc
            );
          }

          positionPanel(
            studentDoc,
            hostDoc
          );
        }
      );

    observer.observe(
      hostDoc.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  install();

  // ------------------------------------------------------------
  // RECHECAGEM
  // ------------------------------------------------------------

  setInterval(
    () => {
      if (!isHostOwner) {
        return;
      }

      const studentDoc =
        findStudentDocument();

      if (!studentDoc) {
        return;
      }

      const hostDoc =
        resolveHostDocument(
          studentDoc
        );

      if (
        !$(
          hostDoc,
          `#${CONFIG.panelId}`
        )
      ) {
        createPanel(
          studentDoc,
          hostDoc
        );
      }

      positionPanel(
        studentDoc,
        hostDoc
      );
    },
    2500
  );

  // ============================================================
  // MODELOS HTML
  // ============================================================
  //
  // Os modelos definitivos ficam aqui.
  //
  // ============================================================

  const TEMPLATES = {
    data: `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>
Termo de Ciência do Tratamento de Dados Pessoais
</title>

<style>

:root{
  --pw:210mm;
  --ph:297mm;

  --mt:10mm;
  --mr:16mm;
  --mb:12mm;
  --ml:16mm;

  --font:"Times New Roman",Times,serif;
}

*{
  box-sizing:border-box;
}

html,
body{
  margin:0;
  padding:0;

  background:#e9e9e9;
  color:#000;

  font-family:var(--font);
}

.document{
  width:var(--pw);
  margin:12mm auto;
}

.page{
  position:relative;

  width:var(--pw);
  height:var(--ph);

  padding:
    var(--mt)
    var(--mr)
    var(--mb)
    var(--ml);

  background:#fff;

  overflow:hidden;

  page-break-after:always;
  break-after:page;
}

.page:last-child{
  page-break-after:auto;
  break-after:auto;
}

.header{
  width:100%;
  text-align:center;
  margin:0 0 4.3mm;
}

.logo{
  display:block;
  width:67mm;
  height:auto;

  margin:
    1.5mm
    auto
    6.8mm;

  object-fit:contain;
}

.title{
  margin:0;

  font-size:12.2pt;
  line-height:1.05;
  font-weight:bold;

  text-align:center;
}

.body{
  font-size:10.75pt;
  line-height:1.04;

  text-align:justify;
}

.body p{
  margin:0;
}

.intro{
  margin-top:2mm!important;
  text-indent:8mm;
}

.section{
  margin-top:4.9mm!important;

  font-weight:700;

  text-align:left;
}

.school-data{
  margin-top:4.2mm!important;

  line-height:1.04;

  font-weight:400;

  text-align:left;
}

.school-data .label{
  font-weight:700;
}

.school-data .value{
  font-weight:400;
}

.section-text{
  margin-top:4.5mm!important;

  text-indent:8mm;
}

.page-two .header{
  margin-bottom:5.2mm;
}

.page-two .continuation-top{
  margin-top:0!important;
  text-indent:8mm;
}

.page-two .section{
  margin-top:5mm!important;
}

.page-two .paragraph{
  margin-top:4.4mm!important;
  text-indent:8mm;
}

.intro,
.section-text,
.continuation-top,
.declaration{
  text-align:justify;
}

.declaration{
  margin-top:5.1mm!important;

  text-indent:8mm;

  line-height:1.28;
}

.signature{
  margin-top:4.4mm!important;

  text-align:left;
}

.signature-line{
  display:inline-block;

  width:75mm;

  border-bottom:.25mm solid #000;

  height:4.2mm;

  vertical-align:bottom;
}

.signature-caption{
  display:block;

  margin-top:.3mm;
}

.date-line{
  margin-top:3.2mm!important;

  text-align:center;

  font-weight:400;
}

.footer-note{
  position:absolute;

  left:var(--ml);
  right:var(--mr);
  bottom:12.2mm;

  font-size:10.75pt;
  line-height:1.04;

  text-align:justify;
}

@page{
  size:A4 portrait;
  margin:0;
}

@media print{

  html,
  body{
    background:#fff;
  }

  .document{
    width:auto;
    margin:0;
  }

  .page{
    width:210mm;
    height:297mm;

    margin:0;

    padding:
      var(--mt)
      var(--mr)
      var(--mb)
      var(--ml);

    box-shadow:none;

    overflow:hidden;
  }

  a{
    color:#000;
    text-decoration:none;
  }
}

@media screen{

  .page{
    box-shadow:
      0 1px 8px rgba(0,0,0,.14);
  }
}

</style>
</head>

<body>

<main class="document">

<section class="page">

<header class="header">

<img
  class="logo"
  src="https://drive.google.com/thumbnail?id=1Cr4xEqLYkIIfyTlUygYJitMPNQfKrO1k&sz=w1000"
  alt="SEDUC - Governo de Mato Grosso"
>

<h1 class="title">
TERMO DE CIÊNCIA DO TRATAMENTO DE DADOS PESSOAIS
</h1>

</header>

<div class="body">

<p class="intro">
O presente <strong>Termo de Ciência do Tratamento de Dados Pessoais</strong> tem por finalidade assegurar a comunicação clara e inequívoca ao titular dos dados pessoais ou ao seu responsável legal acerca do tratamento de dados pessoais realizado pela Secretaria de Estado de Educação de Mato Grosso – SEDUC/MT, por intermédio das unidades escolares da Rede Pública Estadual de Ensino, em conformidade com a Lei Federal nº 13.709, de 14 de agosto de 2018 – Lei Geral de Proteção de Dados Pessoais (LGPD).
</p>

<p class="section">
1. Identificação da Escola:
</p>

<p class="school-data">
Nome da Escola: <<ESCOLA_NOME>><br>
Endereço: <<ESCOLA_ENDERECO>><br>
Telefone: <<ESCOLA_TELEFONE>><br>
E-mail: <<ESCOLA_EMAIL>>
</p>

<p class="section">
2. Finalidade do Tratamento de Dados:
</p>

<p class="section-text">
Os dados pessoais dos estudantes serão tratados para as seguintes finalidades: identificar e manter contato com o estudante e seu responsável legal para comunicações relacionadas à vida escolar; subsidiar decisões e procedimentos relacionados à saúde, à segurança e ao atendimento de situações de emergência; realizar a gestão pedagógica, administrativa e acadêmica da unidade escolar, incluindo matrícula, rematrícula, transferência, emissão de documentos escolares e demais registros acadêmicos; viabilizar a execução de atividades pedagógicas, culturais, esportivas, recreativas e demais ações promovidas pela unidade escolar; cumprir obrigações legais, regulamentares e administrativas impostas à Rede Pública Estadual de Ensino, incluindo o Censo Escolar e demais sistemas oficiais de informação; executar políticas públicas educacionais; garantir a segurança, a proteção e o bem-estar dos estudantes nas dependências escolares; e produzir estudos, estatísticas e indicadores destinados ao aperfeiçoamento das políticas públicas e dos serviços educacionais, observada a legislação aplicável.
</p>

<p class="section">
3. Dados Pessoais e Dados sensíveis coletados:
</p>

<p class="section-text">
Poderão ser tratados, conforme a necessidade, a etapa de ensino e as finalidades institucionais aplicáveis, os seguintes dados pessoais e dados pessoais sensíveis: nome civil e/ou nome social; data de nascimento; filiação; endereço; telefone; e-mail; documentos de identificação; CPF; dados relacionados à matrícula e à vida escolar; dados de saúde, quando necessários ao atendimento das finalidades institucionais; informações relacionadas a necessidades educacionais específicas; e demais informações necessárias ao cumprimento das atribuições legais e institucionais da unidade escolar.
</p>

<p class="section">
4. Base legal:
</p>

<p class="section-text">
O tratamento dos dados pessoais será realizado com fundamento nas bases legais previstas na Lei nº 13.709/2018, especialmente para o cumprimento de obrigação legal ou regulatória, para a execução de políticas públicas, para o exercício regular de direitos e para a proteção da vida e da incolumidade física do titular, quando aplicáveis.
</p>

<p class="section">
5. Compartilhamento dos dados:
</p>

<p class="section-text">
Os dados poderão ser compartilhados com órgãos públicos, sistemas oficiais de informação e instituições parceiras quando necessário ao cumprimento das finalidades institucionais, das obrigações legais e das políticas públicas educacionais.
</p>

</div>

</section>

<section class="page page-two">

<header class="header">

<img
  class="logo"
  src="https://drive.google.com/thumbnail?id=1Cr4xEqLYkIIfyTlUygYJitMPNQfKrO1k&sz=w1000"
  alt="SEDUC - Governo de Mato Grosso"
>

<h1 class="title">
TERMO DE CIÊNCIA DO TRATAMENTO DE DADOS PESSOAIS
</h1>

</header>

<div class="body">

<p class="continuation-top">
O responsável declara estar ciente de que poderá exercer, nos termos da legislação aplicável, os direitos relativos aos dados pessoais, bem como obter informações sobre o tratamento realizado pela instituição.
</p>

<p class="section">
6. Segurança:
</p>

<p class="section-text">
A Secretaria de Estado de Educação e as unidades escolares adotarão medidas técnicas e administrativas aptas a proteger os dados pessoais contra acessos não autorizados e situações acidentais ou ilícitas de destruição, perda, alteração, comunicação ou difusão.
</p>

<p class="section">
7. Direitos do titular:
</p>

<p class="section-text">
O titular poderá solicitar informações e exercer os direitos assegurados pela legislação de proteção de dados, observados os requisitos e procedimentos estabelecidos pela administração pública.
</p>

<p class="section">
8. Prazo de conservação:
</p>

<p class="section-text">
Os dados serão mantidos pelo período necessário ao cumprimento das finalidades para as quais foram coletados e, posteriormente, pelo período exigido para cumprimento de obrigações legais, regulatórias e administrativas.
</p>

<p class="section">
9. Declaração:
</p>

<p class="declaration">
Eu, <strong><<NOME_RESPONSAVEL>></strong>, na qualidade de responsável legal pelo(a) estudante <strong><<NOME_ALUNO>></strong>, declaro que fui informado(a) acerca do tratamento dos dados pessoais e dados pessoais sensíveis relacionados ao estudante, nos termos deste documento, e que estou ciente das finalidades, das bases legais e das condições apresentadas.
</p>

<p class="declaration">
Declaro, ainda, que as informações fornecidas são verdadeiras e que estou ciente de que eventual alteração dos dados cadastrais deverá ser comunicada à unidade escolar para atualização dos registros.
</p>

<p class="signature">
Responsável: <span class="signature-line"></span>
<span class="signature-caption">
<<NOME_RESPONSAVEL>>
</span>
</p>

<p class="date-line">
<<LOCAL_E_DATA>>
</p>

</div>

</section>

</main>

</body>
</html>`,

    // ========================================================
    // IMAGEM MENOR
    // ========================================================

    imgMinor: `<!DOCTYPE html>
<html lang="pt-BR">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>
Termo de Ciência para Uso de Imagem e Voz — Estudante Menor de Idade
</title>

<style>

:root{
  --page-width:210mm;
  --page-height:297mm;

  --margin-top:10mm;
  --margin-right:29mm;
  --margin-bottom:10mm;
  --margin-left:29mm;

  --font:"Arial",Helvetica,sans-serif;
}

*{
  box-sizing:border-box;
}

html,
body{
  margin:0;
  padding:0;

  background:#e8e8e8;
  color:#000;

  font-family:var(--font);
}

.document{
  width:var(--page-width);
  margin:12mm auto;
}

.page{
  position:relative;

  width:var(--page-width);
  height:var(--page-height);

  padding:
    var(--margin-top)
    var(--margin-right)
    var(--margin-bottom)
    var(--margin-left);

  background:#fff;

  overflow:hidden;
}

.header{
  text-align:center;

  margin:
    0
    0
    8.5mm;
}

.logo{
  display:block;

  width:64mm;
  height:auto;

  margin:
    1.5mm
    auto
    7mm;

  object-fit:contain;
}

.title{
  margin:0;

  font-size:12pt;
  line-height:1.1;

  font-weight:700;

  text-align:center;
}

.subtitle{
  margin:
    3.1mm
    0
    8.8mm;

  font-size:11pt;
  line-height:1.1;

  font-weight:700;

  text-align:center;

  text-transform:uppercase;
}

.body{
  font-size:10.85pt;

  line-height:1.10;

  text-align:justify;
}

.body p{
  margin:0;
}

.opening{
  margin-bottom:6.3mm!important;
}

.paragraph{
  margin-bottom:6.1mm!important;
}

.closing{
  margin-top:1mm!important;
  margin-bottom:0!important;
}

.opening,
.paragraph,
.closing{
  text-align:justify;
}

.date{
  margin-top:20mm!important;

  text-align:center;
}

.signature-wrap{
  margin-top:13mm;

  text-align:center;
}

.signature-line{
  width:62mm;

  height:5mm;

  margin:0 auto;

  border-bottom:
    .25mm solid #000;
}

.signature-label{
  margin-top:2mm;

  font-size:10.85pt;

  line-height:1;
}

@page{
  size:A4 portrait;
  margin:0;
}

@media print{

  html,
  body{
    background:#fff;
  }

  .document{
    width:auto;
    margin:0;
  }

  .page{
    width:210mm;
    height:297mm;

    margin:0;

    box-shadow:none;
  }

}

@media screen{

  .page{
    box-shadow:
      0 1px 8px rgba(0,0,0,.14);
  }

}

</style>

</head>

<body>

<main class="document">

<section class="page">

<header class="header">

<img
  class="logo"
  src="https://drive.google.com/thumbnail?id=1Cr4xEqLYkIIfyTlUygYJitMPNQfKrO1k&sz=w1000"
  alt="SEDUC - Governo de Mato Grosso"
>

<h1 class="title">
TERMO DE CIÊNCIA PARA USO DE IMAGEM E VOZ
</h1>

<div class="subtitle">
(ESTUDANTE MENOR DE IDADE)
</div>

</header>

<div class="body">

<p class="opening">

Eu,
<strong><<NOME_RESPONSAVEL>></strong>,
responsável legal por
<strong><<NOME_ALUNO>></strong>,
atualmente matriculado na Escola Estadual
<strong><<ESCOLA_NOME_CURTO>></strong>,
ESTOU CIENTE do uso da imagem e voz do(a) estudante pela Secretaria de Estado de Educação de Mato Grosso – SEDUC/MT, para divulgação de material de conteúdo informativo voltado à educação de Mato Grosso.

</p>

<p class="paragraph">

Declaro estar ciente de que o uso da imagem e da voz poderá ocorrer em registros fotográficos, gravações de áudio, vídeos, podcasts e demais materiais audiovisuais produzidos no contexto de atividades pedagógicas, culturais, esportivas, eventos escolares, projetos educacionais e demais ações institucionais promovidas pela unidade escolar, pela Diretoria Regional ou Metropolitana de Educação, pela SEDUC/MT e pelo Governo do Estado de Mato Grosso.

</p>

<p class="paragraph">

Estou ciente de que o presente termo terá validade durante todo o período em que o(a) estudante mantiver vínculo de matrícula na Rede Pública Estadual de Ensino. Os registros captados poderão ser divulgados em meios físicos e digitais, inclusive em sítios eletrônicos, redes sociais, publicações institucionais e demais canais oficiais de comunicação, bem como permanecer armazenados para composição de acervos históricos e memoriais institucionais, mesmo após o encerramento do vínculo escolar, observadas as normas de segurança da informação e a legislação vigente.

</p>

<p class="paragraph">

Declaro, ainda, estar ciente de que a utilização da imagem e da voz deverá observar os direitos fundamentais da pessoa, vedada qualquer utilização que implique alteração de seu contexto, desvirtuação de sua finalidade ou violação à honra, à imagem, à intimidade ou à dignidade, em conformidade com o inciso X do art. 5º da Constituição Federal, o art. 20 da Lei nº 10.406, de 10 de janeiro de 2002 (Código Civil), e os princípios estabelecidos pela Lei nº 13.709, de 14 de agosto de 2018 (Lei Geral de Proteção de Dados Pessoais – LGPD).

</p>

<p class="closing">

Por ser esta a expressão da verdade, firmo o presente <strong>Termo de Ciência para o Uso de Imagem e Voz</strong>, declarando que fui devidamente informado(a) acerca das condições acima descritas.

</p>

<p class="date">
<<LOCAL_E_DATA>>
</p>

<div class="signature-wrap">

<div class="signature-line">
</div>

<div class="signature-label">
Assinatura
</div>

</div>

</div>

</section>

</main>

</body>

</html>`,

    // ========================================================
    // IMAGEM MAIOR
    // ========================================================

    imgMajor: `<!DOCTYPE html>
<html lang="pt-BR">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>
Termo de Ciência para Uso de Imagem e Voz — Estudante Maior de Idade
</title>

<style>

:root{
  --page-width:210mm;
  --page-height:297mm;

  --margin-top:10mm;
  --margin-right:29mm;
  --margin-bottom:10mm;
  --margin-left:29mm;

  --font:"Arial",Helvetica,sans-serif;
}

*{
  box-sizing:border-box;
}

html,
body{
  margin:0;
  padding:0;

  background:#e8e8e8;
  color:#000;

  font-family:var(--font);
}

.document{
  width:var(--page-width);

  margin:12mm auto;
}

.page{
  position:relative;

  width:var(--page-width);
  height:var(--page-height);

  padding:
    var(--margin-top)
    var(--margin-right)
    var(--margin-bottom)
    var(--margin-left);

  background:#fff;

  overflow:hidden;
}

.header{
  text-align:center;

  margin:
    0
    0
    8.5mm;
}

.logo{
  display:block;

  width:64mm;
  height:auto;

  margin:
    1.5mm
    auto
    7mm;

  object-fit:contain;
}

.title{
  margin:0;

  font-size:12pt;
  line-height:1.1;

  font-weight:700;

  text-align:center;
}

.subtitle{
  margin:
    3.1mm
    0
    8.8mm;

  font-size:11pt;
  line-height:1.1;

  font-weight:700;

  text-align:center;

  text-transform:uppercase;
}

.body{
  font-size:10.85pt;

  line-height:1.10;

  text-align:justify;
}

.body p{
  margin:0;
}

.opening{
  margin-bottom:6.3mm!important;
}

.paragraph{
  margin-bottom:6.1mm!important;
}

.closing{
  margin-top:1mm!important;
  margin-bottom:0!important;
}

.opening,
.paragraph,
.closing{
  text-align:justify;
}

.date{
  margin-top:20mm!important;

  text-align:center;
}

.signature-wrap{
  margin-top:13mm;

  text-align:center;
}

.signature-line{
  width:62mm;

  height:5mm;

  margin:0 auto;

  border-bottom:
    .25mm solid #000;
}

.signature-label{
  margin-top:2mm;

  font-size:10.85pt;

  line-height:1;
}

@page{
  size:A4 portrait;
  margin:0;
}

@media print{

  html,
  body{
    background:#fff;
  }

  .document{
    width:auto;
    margin:0;
  }

  .page{
    width:210mm;
    height:297mm;

    margin:0;

    box-shadow:none;
  }

}

@media screen{

  .page{
    box-shadow:
      0 1px 8px rgba(0,0,0,.14);
  }

}

</style>

</head>

<body>

<main class="document">

<section class="page">

<header class="header">

<img
  class="logo"
  src="https://drive.google.com/thumbnail?id=1Cr4xEqLYkIIfyTlUygYJitMPNQfKrO1k&sz=w1000"
  alt="SEDUC - Governo de Mato Grosso"
>

<h1 class="title">
TERMO DE CIÊNCIA PARA USO DE IMAGEM E VOZ
</h1>

<div class="subtitle">
(ESTUDANTE MAIOR DE IDADE)
</div>

</header>

<div class="body">

<p class="opening">

Eu,
<strong><<NOME_ALUNO>></strong>,
atualmente matriculado na Escola Estadual
<strong><<ESCOLA_NOME_CURTO>></strong>,
ESTOU CIENTE do uso da minha imagem e voz, pela Secretaria de Estado de Educação de Mato Grosso – SEDUC/MT, para divulgação de material de conteúdo informativo voltado à educação de Mato Grosso.

</p>

<p class="paragraph">

Declaro estar ciente de que o uso da imagem e da voz poderá ocorrer em registros fotográficos, gravações de áudio, vídeos, podcasts e demais materiais audiovisuais produzidos no contexto de atividades pedagógicas, culturais, esportivas, eventos escolares, projetos educacionais e demais ações institucionais promovidas pela unidade escolar, pela Diretoria Regional ou Metropolitana de Educação, pela SEDUC/MT e pelo Governo do Estado de Mato Grosso.

</p>

<p class="paragraph">

Estou ciente de que o presente termo terá validade durante todo o período em que eu mantiver vínculo de matrícula na Rede Pública Estadual de Ensino. Os registros captados poderão ser divulgados em meios físicos e digitais, inclusive em sítios eletrônicos, redes sociais, publicações institucionais e demais canais oficiais de comunicação, bem como permanecer armazenados para composição de acervos históricos e memoriais institucionais, mesmo após o encerramento do vínculo escolar, observadas as normas de segurança da informação e a legislação vigente.

</p>

<p class="paragraph">

Declaro, ainda, estar ciente de que a utilização da imagem e da voz deverá observar os direitos fundamentais da pessoa, vedada qualquer utilização que implique alteração de seu contexto, desvirtuação de sua finalidade ou violação à honra, à imagem, à intimidade ou à dignidade, em conformidade com o inciso X do art. 5º da Constituição Federal, o art. 20 da Lei nº 10.406, de 10 de janeiro de 2002 (Código Civil), e os princípios estabelecidos pela Lei nº 13.709, de 14 de agosto de 2018 (Lei Geral de Proteção de Dados Pessoais – LGPD).

</p>

<p class="closing">

Por ser esta a expressão da verdade, firmo o presente <strong>Termo de Ciência</strong>, declarando que fui devidamente informado(a) acerca das condições acima descritas.

</p>

<p class="date">
<<LOCAL_E_DATA>>
</p>

<div class="signature-wrap">

<div class="signature-line">
</div>

<div class="signature-label">
Assinatura
</div>

</div>

</div>

</section>

</main>

</body>

</html>`,

    // ========================================================
    // COMPROMISSO FAMILIAR — MENOR
    // ========================================================

    familyMinor: `<!DOCTYPE html>
<html lang="pt-BR">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>
Termo de Compromisso Familiar para o Ano Letivo Subsequente
</title>

<style>

@page{
  size:A4 portrait;
  margin:0;
}

*{
  box-sizing:border-box;
}

html,
body{
  margin:0;
  padding:0;

  background:#e9e9e9;

  color:#000;

  font-family:
    "Times New Roman",
    Times,
    serif;
}

.document{
  width:210mm;
  margin:12mm auto;
}

.page{
  position:relative;

  width:210mm;
  height:297mm;

  padding:
    14mm
    17mm
    15mm
    17mm;

  background:#fff;

  overflow:hidden;

  page-break-after:always;
  break-after:page;
}

.page:last-child{
  page-break-after:auto;
  break-after:auto;
}

.header{
  text-align:center;

  margin-bottom:9mm;
}

.brasao{
  display:block;

  width:24mm;
  height:auto;

  margin:
    0
    auto
    3.5mm;
}

.institution{
  font-size:11pt;

  line-height:1.12;

  text-align:center;

  font-weight:700;
}

.body{
  font-size:11pt;

  line-height:1.28;

  text-align:justify;
}

.section-title{
  margin-top:7mm;
  margin-bottom:5mm;

  font-weight:700;

  text-align:left;
}

.family-section{
  margin-top:8mm;
}

.legal-paragraph{
  margin:
    0
    0
    5.6mm;

  text-indent:8mm;

  text-align:justify;
}

.quote{
  margin:
    5mm
    8mm
    6mm;

  text-align:justify;

  font-style:italic;

  line-height:1.25;
}

.closing{
  margin-top:8mm;

  text-indent:8mm;

  text-align:justify;
}

.data-field{
  margin:
    5.5mm
    0
    0;

  line-height:1.25;
}

.data-value{
  font-weight:400;
}

.final-signature{
  margin-top:14mm;

  text-align:center;
}

.final-signature-line{
  width:75mm;

  height:7mm;

  margin:
    0
    auto;

  border-bottom:
    .25mm solid #000;
}

.final-signature-label{
  margin-top:2mm;

  font-size:10.8pt;
}

@media print{

  html,
  body{
    background:#fff;
  }

  .document{
    width:auto;
    margin:0;
  }

  .page{
    width:210mm;
    height:297mm;

    margin:0;

    padding:
      14mm
      17mm
      15mm
      17mm;

    box-shadow:none;
  }

}

@media screen{

  .page{
    box-shadow:
      0 1px 8px rgba(0,0,0,.14);
  }

}

</style>

</head>

<body>

<main class="document">

<!-- ===================================================== -->
<!-- PÁGINA 1 -->
<!-- ===================================================== -->

<section class="page">

<header class="header">

<img
  class="brasao"
  src="https://www.pm.mt.gov.br/documents/2459523/3685962/Bras%C3%A3o_de_Mato_Grosso.png/60bf60db-e5d3-4583-aa6c-5e81a30535c8?t=1458303108435"
  alt="Brasão de Mato Grosso"
>

<div class="institution">

<div>
Governo do Estado de Mato Grosso
</div>

<div>
SEDUC – Secretaria de Estado de Educação
</div>

</div>

</header>

<div class="body">

<div class="section-title">
TERMO DE COMPROMISSO FAMILIAR PARA O ANO LETIVO SUBSEQUENTE
</div>

<p class="legal-paragraph">

Eu,
<strong><<NOME_RESPONSAVEL>></strong>,
responsável legal pelo(a) estudante
<strong><<NOME_ALUNO>></strong>,
matriculado(a) na Escola Estadual
<strong><<ESCOLA_NOME_CURTO>></strong>,
declaro estar ciente da importância da frequência escolar e do acompanhamento permanente da vida escolar do(a) estudante.

</p>

<p class="legal-paragraph">

O presente Termo de Compromisso Familiar tem por finalidade fortalecer a corresponsabilidade entre a família e a escola, contribuindo para a permanência, a frequência e o sucesso escolar do(a) estudante durante o ano letivo de <strong><<ANO_LETIVO>></strong>.

</p>

<p class="legal-paragraph">

Declaro estar ciente de que a família possui papel fundamental no acompanhamento da frequência, do rendimento e do desenvolvimento escolar, devendo manter comunicação com a unidade escolar sempre que houver situações que possam comprometer a participação do(a) estudante nas atividades educacionais.

</p>

<p class="section-title">
I – DA IDENTIFICAÇÃO
</p>

<div class="data-field">
Estudante:
<span class="data-value">
<<NOME_ALUNO>>
</span>
</div>

<div class="data-field">
Endereço:
<span class="data-value">
<<ENDERECO_ALUNO>>
</span>
</div>

<div class="data-field">
Município:
<span class="data-value">
<<MUNICIPIO>>
</span>
</div>

<div class="data-field">
RG do Responsável:
<span class="data-value">
<<RG_RESPONSAVEL>>
</span>
</div>

<div class="data-field">
CPF do Responsável:
<span class="data-value">
<<CPF_RESPONSAVEL>>
</span>
</div>

<p class="section-title">
II – DO COMPROMISSO
</p>

<p class="legal-paragraph">

Comprometo-me a acompanhar a frequência escolar do(a) estudante, verificando a regularidade de sua presença nas aulas e adotando as providências necessárias diante de faltas que possam prejudicar sua aprendizagem.

</p>

<p class="legal-paragraph">

Comprometo-me, ainda, a manter meus dados de contato e endereço atualizados junto à unidade escolar e a atender, sempre que possível, às convocações, reuniões e orientações da equipe escolar relacionadas à vida acadêmica do(a) estudante.

</p>

<p class="legal-paragraph">

Comprometo-me a comunicar previamente à escola, sempre que possível, eventuais ausências do(a) estudante, apresentando justificativa ou documentação quando necessária.

</p>

</div>

</section>

<!-- ===================================================== -->
<!-- PÁGINA 2 -->
<!-- ===================================================== -->

<section class="page page-two">

<header class="header">

<img
  class="brasao"
  src="https://www.pm.mt.gov.br/documents/2459523/3685962/Bras%C3%A3o_de_Mato_Grosso.png/60bf60db-e5d3-4583-aa6c-5e81a30535c8?t=1458303108435"
  alt="Brasão de Mato Grosso"
>

<div class="institution">

<div>
Governo do Estado de Mato Grosso
</div>

<div>
SEDUC – Secretaria de Estado de Educação
</div>

</div>

</header>

<div class="body">

<p class="section-title family-section">
III – DA RESPONSABILIDADE DA FAMÍLIA
</p>

<p class="legal-paragraph">

Reconheço que a participação da família é indispensável para a permanência e o sucesso escolar do(a) estudante, comprometendo-me a adotar as medidas necessárias para assegurar sua frequência e acompanhar sua trajetória escolar.

</p>

<p class="legal-paragraph">

Declaro estar ciente de que a ausência reiterada e injustificada às atividades escolares poderá ensejar a adoção das providências previstas na legislação vigente, incluindo comunicação aos órgãos competentes, especialmente ao Conselho Tutelar, quando caracterizada situação de infrequência escolar.

</p>

<p class="closing">

Por estar de acordo com as disposições acima, firmo o presente <strong>Termo de Compromisso</strong>.

</p>

<div class="data-field">

Pai:
<span class="data-value">
<<NOME_PAI>>
</span>

</div>

<div class="data-field">

Mãe:
<span class="data-value">
<<NOME_MAE>>
</span>

</div>

<div class="data-field">

Responsável Legal:
<span class="data-value">
<<NOME_RESPONSAVEL>>
</span>

</div>

<div class="data-field">

Telefone(s):
<span class="data-value">
<<TELEFONES_RESPONSAVEL>>
</span>

</div>

<div class="data-field">

E-mail:
<span class="data-value">
<<EMAIL_RESPONSAVEL>>
</span>

</div>

<p
  class="data-field"
  style="font-weight:400; margin-top:8mm;"
>

<<LOCAL_E_DATA>>

</p>

<div class="final-signature">

<div class="final-signature-line">
</div>

<div class="final-signature-label">
Assinatura do(a) Responsável Legal
</div>

</div>

</div>

</section>

</main>

</body>

</html>`,

    // ========================================================
    // AUTORIZAÇÃO DE MATRÍCULA/TRANSFERÊNCIA
    // ========================================================

    authMatricula: `<!DOCTYPE html>
<html lang="pt-BR">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>
Autorização para Matrícula e Retirada de Transferência/Histórico Escolar
</title>

<style>

:root{
  --pw:210mm;
  --ph:297mm;

  --mt:14mm;
  --mr:20mm;
  --mb:14mm;
  --ml:20mm;

  --font:"Times New Roman",Times,serif;
}

*{
  box-sizing:border-box;
}

html,
body{
  margin:0;
  padding:0;

  background:#e9e9e9;
  color:#000;

  font-family:var(--font);
}

.document{
  width:var(--pw);
  margin:12mm auto;
}

.page{
  position:relative;

  width:var(--pw);
  height:var(--ph);

  padding:
    var(--mt)
    var(--mr)
    var(--mb)
    var(--ml);

  background:#fff;

  overflow:hidden;
}

.header{
  width:100%;
  text-align:center;
  margin:0 0 9mm;
}

.logo{
  display:block;
  width:60mm;
  height:auto;

  margin:
    1.5mm
    auto
    4mm;

  object-fit:contain;
}

.escola-nome{
  font-size:11.5pt;
  font-weight:700;
  letter-spacing:.2px;
}

.title{
  margin:0 0 12mm;

  font-size:13pt;
  line-height:1.35;
  font-weight:bold;

  text-align:center;
  text-transform:uppercase;
}

.body{
  font-size:12pt;
  line-height:1.9;

  text-align:justify;
}

.body p{
  margin:0;
  text-indent:10mm;
}

.blank-inline{
  display:inline-block;
  border-bottom:.25mm solid #000;
  vertical-align:baseline;
  margin:0 1mm;
}

.blank-inline.blank-name{
  width:68mm;
}

.blank-inline.blank-nationality{
  width:34mm;
}

.blank-inline.blank-cpf{
  width:42mm;
}

.date-line{
  margin-top:14mm;

  text-align:center;
  font-size:12pt;
}

.signature{
  margin-top:22mm;

  text-align:center;
}

.signature-line{
  display:inline-block;

  width:80mm;

  border-bottom:.25mm solid #000;

  height:5mm;
}

.signature-name{
  display:block;
  margin-top:2.5mm;

  font-size:12pt;
  font-weight:700;
}

.signature-caption{
  display:block;
  margin-top:1mm;

  font-size:10.5pt;
  font-weight:400;
}

@page{
  size:A4 portrait;
  margin:0;
}

@media print{

  html,
  body{
    background:#fff;
  }

  .document{
    width:auto;
    margin:0;
  }

  .page{
    width:210mm;
    height:297mm;

    margin:0;

    padding:
      var(--mt)
      var(--mr)
      var(--mb)
      var(--ml);

    box-shadow:none;

    overflow:hidden;
  }
}

@media screen{

  .page{
    box-shadow:
      0 1px 8px rgba(0,0,0,.14);
  }
}

</style>
</head>

<body>

<main class="document">

<section class="page">

<header class="header">

<img
  class="logo"
  src="https://drive.google.com/thumbnail?id=1Cr4xEqLYkIIfyTlUygYJitMPNQfKrO1k&sz=w1000"
  alt="SEDUC - Governo de Mato Grosso"
>

<div class="escola-nome">
<<ESCOLA_NOME>>
</div>

</header>

<h1 class="title">
Autorização para Matrícula e Retirada de<br>
Transferência/Histórico Escolar
</h1>

<div class="body">

<p>
Eu, <strong><<NOME_RESPONSAVEL>></strong>, de nacionalidade brasileira, portador(a) do telefone <<TELEFONES_RESPONSAVEL>>, inscrito(a) no CPF sob o nº <<CPF_RESPONSAVEL>> e no RG nº <<RG_RESPONSAVEL>>, venho, por meio deste documento, autorizar o(a) senhor(a) <span class="blank-inline blank-name"></span>, de nacionalidade <span class="blank-inline blank-nationality"></span>, portador(a) do CPF nº <span class="blank-inline blank-cpf"></span>, a efetuar matrícula e a solicitar ou retirar transferência, histórico escolar e demais documentos referentes à matrícula do(a) aluno(a) <strong><<NOME_ALUNO>></strong>, de nacionalidade brasileira, portador(a) do CPF nº <<CPF_ALUNO>>.
</p>

</div>

<p class="date-line">
<<LOCAL_E_DATA>>
</p>

<div class="signature">

<div class="signature-line"></div>

<span class="signature-name">
<<NOME_RESPONSAVEL>>
</span>

<span class="signature-caption">
Assinatura conforme RG
</span>

</div>

</section>

</main>

</body>

</html>`
  };

})();