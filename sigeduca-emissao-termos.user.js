// ==UserScript==
// @name         SIGEDUCA - Emissão de Termos
// @namespace    http://tampermonkey.net/
// @version      1.8.1
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

  const CONFIG = {
    scriptVersion: '1.8.1',
    versionSeenStorageKey: 'sigeduca_termos_versao_vista',

    cookieName: 'sigeduca_termos_config_v1',
    positionCookieName: 'sigeduca_termos_posicao_v1',
    cookieMaxAge: 60 * 60 * 24 * 365,

    schoolInfoUrl: '/ged/hwgedteladocumento.aspx?0,36',

    validacaoHistoricoUrl:
      '/ged/HWGedValidacaoHistorico.aspx?3,{ALUNO},F,0,HWMGedHistorico',
    testAlunoCode: '971680',

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

  function extractLeadingCode(value) {
    const text = normalizeSpace(value);

    const match = text.match(
      /^\s*(\d+)\s*-\s*/
    );

    return match
      ? match[1]
      : '';
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

  function extractLabeledValue(doc, label) {
    const strongs =
      doc.querySelectorAll('strong');

    for (const strong of strongs) {
      if (
        normalizeSpace(
          strong.textContent
        ) === label
      ) {
        return normalizeSpace(
          strong.nextElementSibling
            ?.textContent
        );
      }
    }

    return '';
  }

  function looksLikeUnresolvedPlaceholder(
    value
  ) {
    return (
      /#/.test(value)
    );
  }

  async function fetchSchoolInfoFromGed() {
    const validacaoUrl =
      new URL(
        CONFIG.validacaoHistoricoUrl.replace(
          '{ALUNO}',
          CONFIG.testAlunoCode
        ),
        window.location.origin
      ).href;

    await fetch(
      validacaoUrl,
      {
        credentials: 'same-origin'
      }
    );

    const url = new URL(
      CONFIG.schoolInfoUrl,
      window.location.origin
    ).href;

    const response = await fetch(
      url,
      {
        credentials: 'same-origin'
      }
    );

    if (!response.ok) {
      throw new Error(
        'Não foi possível consultar o servidor do SIGEDUCA.'
      );
    }

    const html =
      await response.text();

    const doc = new DOMParser()
      .parseFromString(
        html,
        'text/html'
      );

    const endereco =
      extractLabeledValue(
        doc,
        'Endereço:'
      );

    const numero =
      extractLabeledValue(
        doc,
        'Nº:'
      );

    const cep =
      extractLabeledValue(
        doc,
        'Cep:'
      );

    const cidade =
      extractLabeledValue(
        doc,
        'Cidade:'
      );

    const estado =
      extractLabeledValue(
        doc,
        'Estado:'
      );

    const foneRaw =
      extractLabeledValue(
        doc,
        'Fone:'
      );

    if (
      !endereco ||
      !foneRaw ||
      looksLikeUnresolvedPlaceholder(
        endereco
      ) ||
      looksLikeUnresolvedPlaceholder(
        foneRaw
      )
    ) {
      throw new Error(
        'Os dados da escola não foram encontrados na resposta do servidor.'
      );
    }

    const enderecoPartes = [
      toTitleCase(endereco),
      numero
        ? `nº ${numero}`
        : '',
      cidade
        ? `${toTitleCase(cidade)}${estado ? '/' + estado : ''}`
        : '',
      cep
        ? `CEP ${cep}`
        : ''
    ].filter(Boolean);

    const foneMatch =
      foneRaw.match(
        /\(?(\d{2,3})\)?\s*(\d{4,9})/
      );

    const telefoneEscola =
      foneMatch
        ? formatPhone(
            foneMatch[1],
            foneMatch[2]
          )
        : foneRaw;

    return {
      enderecoEscola:
        enderecoPartes.join(', '),

      telefoneEscola:
        telefoneEscola
    };
  }

  function buildSchoolEmail(
    escolaCodigo
  ) {
    return `escola.${escolaCodigo}@edu.mt.gov.br`;
  }

  async function autoFetchAndSaveSchoolConfig(
    escolaCodigo
  ) {
    if (!escolaCodigo) {
      throw new Error(
        'Código da escola não identificado no cabeçalho do SIGEDUCA.'
      );
    }

    const info =
      await fetchSchoolInfoFromGed();

    const value = {
      enderecoEscola:
        info.enderecoEscola,

      telefoneEscola:
        info.telefoneEscola,

      emailEscola:
        buildSchoolEmail(
          escolaCodigo
        )
    };

    writeCookie(
      CONFIG.cookieName,
      value
    );

    return value;
  }

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
      }
    }

    return null;
  }

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
      }

      try {
        enqueue(win.top);
      } catch {
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
          }
        }
      } catch {
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
    }

    try {
      addWin(window.top);
    } catch {
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

  async function resolveCurrentEscolaCodigo(
    studentDoc
  ) {
    try {
      const headerDoc =
        await resolveHeaderDocument(
          studentDoc
        );

      return extractLeadingCode(
        textOfAny(
          headerDoc,
          CONFIG.headerEscola
        )
      );
    } catch {
      return '';
    }
  }

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

    const escolaCodigo =
      extractLeadingCode(
        escolaHeader
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

      escolaCodigo:
        escolaCodigo,

      municipioCabecalho:
        municipio,

      anoLetivo:
        anoLetivo
    };
  }

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
        --sigeduca-blue: #3982f7;
        --sigeduca-navy: #1d1d1f;
        --sigeduca-muted: #666;
        --sigeduca-danger: #ff3b30;
      }

      #${CONFIG.panelId}{
        position:fixed;
        z-index:2147483000;
        width:228px;
        padding:14px 14px 12px;
        background:rgba(237,237,237,.75);
        border:1px solid rgba(214,214,214,.5);
        border-radius:20px;
        box-shadow:0 8px 32px -4px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.06);
        backdrop-filter:blur(12px);
        -webkit-backdrop-filter:blur(12px);
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
        position:relative;
        height:48px;
        margin:-14px -14px -19px;
        border-radius:20px 20px 0 0;
        cursor:grab;
        touch-action:none;
      }

      #${CONFIG.panelId} .sigeduca-term-handle::after{
        content:"";
        position:absolute;
        left:50%;
        top:9px;
        width:36px;
        height:5px;
        margin-left:-18px;
        border-radius:3px;
        background:rgba(0,0,0,.15);
        transition:background .15s ease;
      }

      #${CONFIG.panelId} .sigeduca-term-handle:hover::after{
        background:rgba(0,0,0,.28);
      }

      #${CONFIG.panelId} .sigeduca-term-handle.sigeduca-term-handle-dragging{
        cursor:grabbing;
      }

      #${CONFIG.panelId} .sigeduca-term-handle.sigeduca-term-handle-dragging::after{
        background:rgba(0,0,0,.35);
      }

      #${CONFIG.panelId}.sigeduca-term-sliding{
        transition:left .32s cubic-bezier(.4,0,.2,1);
      }

      #${CONFIG.panelId} .sigeduca-term-title{
        font-weight:600;
        font-size:14px;
        letter-spacing:-.2px;
        margin:0 26px 10px 2px;
        color:var(--sigeduca-navy);
      }

      #${CONFIG.panelId} .sigeduca-term-close{
        position:absolute;
        top:9px;
        right:9px;
        display:flex;
        align-items:center;
        justify-content:center;
        width:20px;
        height:20px;
        padding:0;
        margin:0;
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

      #${CONFIG.panelId}.sigeduca-term-collapsed .sigeduca-term-title{
        margin:0;
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
        transition:all .2s ease-in-out;
      }

      #${CONFIG.panelId} button.sigeduca-term-btn:hover{
        background:rgba(57,130,247,.16);
        transform:scale(1.02);
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
        padding:8px 12px;
        border:none;
        border-radius:12px;
        background:rgba(120,140,170,.1);
        color:var(--sigeduca-muted);
        text-align:center;
        font-size:11px;
        cursor:pointer;
        transition:background .2s ease, color .2s ease;
      }

      #${CONFIG.panelId} button.sigeduca-term-settings svg{
        width:12px;
        height:12px;
        flex:none;
        fill:currentColor;
      }

      #${CONFIG.panelId} button.sigeduca-term-settings:hover{
        background:rgba(120,140,170,.2);
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
        box-shadow:0 0 0 3px rgba(57,130,247,.15);
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

      #${CONFIG.modalId} .sigeduca-autofetch-btn{
        width:100%;
        padding:9px 12px;
        margin-bottom:4px;
        border:1px dashed rgba(57,130,247,.4);
        border-radius:10px;
        background:rgba(57,130,247,.06);
        color:var(--sigeduca-blue);
        font-size:12.5px;
        font-weight:600;
        cursor:pointer;
        transition:background .2s ease;
      }

      #${CONFIG.modalId} .sigeduca-autofetch-btn:hover{
        background:rgba(57,130,247,.12);
      }

      #${CONFIG.modalId} .sigeduca-autofetch-btn:disabled{
        opacity:.6;
        cursor:default;
      }

      #${CONFIG.modalId} .sigeduca-autofetch-status{
        min-height:14px;
        margin:6px 0 4px;
        font-size:11.5px;
        line-height:1.4;
      }

      #${CONFIG.modalId} .sigeduca-autofetch-status.sigeduca-autofetch-ok{
        color:#1a8f4c;
      }

      #${CONFIG.modalId} .sigeduca-autofetch-status.sigeduca-autofetch-error{
        color:var(--sigeduca-danger);
      }
    `;

    targetDoc.head.appendChild(
      style
    );
  }

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
      ) ||
      panel.classList.contains(
        'sigeduca-term-sliding'
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
          }
        };

        handle.addEventListener(
          'pointermove',
          onMove
        );

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

  function onceTransitionEnd(
    panel,
    property,
    callback
  ) {
    const handler = (event) => {
      if (event.propertyName !== property) {
        return;
      }

      panel.removeEventListener(
        'transitionend',
        handler
      );

      callback();
    };

    panel.addEventListener(
      'transitionend',
      handler
    );
  }

  function collapsePanel(
    hostDoc,
    panel
  ) {
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

    const offscreenLeft =
      hostDoc.defaultView
        .innerWidth + 40;

    panel.classList.add(
      'sigeduca-term-sliding'
    );

    panel.style.left =
      `${offscreenLeft}px`;

    onceTransitionEnd(
      panel,
      'left',
      () => {
        panel.classList.remove(
          'sigeduca-term-sliding'
        );

        panel.classList.add(
          'sigeduca-term-collapsed'
        );

        panel.style.left = '';
        panel.style.right = '0px';
      }
    );
  }

  function expandPanel(
    hostDoc,
    panel
  ) {
    const win =
      hostDoc.defaultView;

    const offscreenLeft =
      win.innerWidth + 40;

    panel.classList.remove(
      'sigeduca-term-collapsed'
    );

    panel.style.right = '';
    panel.style.left =
      `${offscreenLeft}px`;

    void panel.offsetWidth;

    const clamped =
      clampPanelPosition(
        hostDoc,
        panel,
        panelDragPosition.left,
        panelDragPosition.top
      );

    panel.style.top =
      `${Math.round(clamped.top)}px`;

    panel.classList.add(
      'sigeduca-term-sliding'
    );

    panel.style.left =
      `${Math.round(clamped.left)}px`;

    onceTransitionEnd(
      panel,
      'left',
      () => {
        panel.classList.remove(
          'sigeduca-term-sliding'
        );
      }
    );
  }

  function removePanel(targetDoc) {
    $(
      targetDoc,
      `#${CONFIG.panelId}`
    )?.remove();
  }

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
          rgba(57,130,247,.45),
          transparent,
          rgba(52,199,89,.4),
          transparent,
          rgba(57,130,247,.5)
        );
        filter:blur(26px);
        animation:sigeduca-glow-reverse 2000ms ease-out;
      }

      .sigeduca-glow-layer.sigeduca-glow-after{
        background:conic-gradient(
          from 0deg,
          rgba(52,199,89,.5),
          rgba(57,130,247,.6),
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
            }
          },
          duration
        );
      },
      delay
    );
  }

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
        class="sigeduca-term-btn"
        data-term="cienciaMilitar"
      >
        Ciência e Concordância — Militar
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

            const currentStudentDoc =
              findStudentDocument() ||
              studentDoc;

            try {
              await emitTerm(
                currentStudentDoc,
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
            const currentStudentDoc =
              findStudentDocument() ||
              studentDoc;

            const escolaCodigo =
              await resolveCurrentEscolaCodigo(
                currentStudentDoc
              );

            await showSchoolConfigModal(
              hostDoc,
              true,
              escolaCodigo
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
          collapsePanel(
            hostDoc,
            panel
          );
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
    force = false,
    escolaCodigo = ''
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
          <button
            type="button"
            id="sigeducaAutoFetch"
            class="sigeduca-autofetch-btn"
          >
            🔄 Buscar endereço e telefone automaticamente
          </button>

          <div
            class="sigeduca-autofetch-status"
            id="sigeducaAutoFetchStatus"
          ></div>

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

        card
          .querySelector(
            '#sigeducaAutoFetch'
          )
          .addEventListener(
            'click',
            async (event) => {
              const button =
                event.currentTarget;

              const status =
                card.querySelector(
                  '#sigeducaAutoFetchStatus'
                );

              button.disabled = true;
              button.textContent =
                'Buscando...';

              status.className =
                'sigeduca-autofetch-status';

              status.textContent =
                '';

              try {
                const info =
                  await fetchSchoolInfoFromGed();

                card.querySelector(
                  '#sigeducaEndereco'
                ).value =
                  info.enderecoEscola;

                card.querySelector(
                  '#sigeducaTel'
                ).value =
                  info.telefoneEscola;

                if (escolaCodigo) {
                  card.querySelector(
                    '#sigeducaEmail'
                  ).value =
                    buildSchoolEmail(
                      escolaCodigo
                    );
                }

                status.classList.add(
                  'sigeduca-autofetch-ok'
                );

                status.textContent =
                  escolaCodigo
                    ? 'Endereço, telefone e e-mail preenchidos automaticamente. Confira antes de salvar.'
                    : 'Endereço e telefone preenchidos automaticamente. Confira antes de salvar.';
              } catch (error) {
                console.error(
                  '[SIGEDUCA Termos]',
                  error
                );

                status.classList.add(
                  'sigeduca-autofetch-error'
                );

                status.textContent =
                  'Não foi possível buscar automaticamente. Preencha manualmente abaixo.';
              } finally {
                button.disabled = false;

                button.textContent =
                  '🔄 Buscar endereço e telefone automaticamente';
              }
            }
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
        '<<ESCOLA_NOME>>',
        data.escola
      );

    const anoLetivoNum =
      parseInt(
        data.anoLetivo,
        10
      );

    const anoLetivoSubsequente =
      Number.isNaN(anoLetivoNum) ?
        data.anoLetivo :
        String(anoLetivoNum + 1);

    html =
      replaceAllSafe(
        html,
        '<<ANO_LETIVO>>',
        anoLetivoSubsequente
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
        `MT,\n${todayText}.`
      );

    return html;
  }

  function buildAuthMatriculaTerm(
    data
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
        '<<NOME_ALUNO>>',
        data.aluno
      );

    html = data.cpfAluno
      ? replaceAllSafe(
          html,
          '<<CPF_ALUNO>>',
          data.cpfAluno
        )
      : replaceRaw(
          html,
          '<<CPF_ALUNO>>',
          '<span class="blank-inline blank-cpf"></span>'
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

  function buildCienciaMilitarTerm(
    data,
    responsibleRG
  ) {
    let html =
      TEMPLATES.cienciaMilitar;

    html =
      replaceAllSafe(
        html,
        '<<NOME_RESPONSAVEL>>',
        data.responsavel
      );

    html =
      replaceAllSafe(
        html,
        '<<RG_RESPONSAVEL>>',
        responsibleRG ||
        '[RG DO RESPONSÁVEL]'
      );

    html =
      replaceAllSafe(
        html,
        '<<CPF_RESPONSAVEL>>',
        data.cpfResponsavel ||
        '[CPF DO RESPONSÁVEL]'
      );

    const enderecoCompleto =
      [
        data.endereco,
        data.municipio &&
        data.uf ?
          `${data.municipio} - ${data.uf}` :
          '',
        data.cep ?
          `CEP ${data.cep}` :
          ''
      ]
        .filter(Boolean)
        .join(', ');

    html =
      replaceAllSafe(
        html,
        '<<ENDERECO_ALUNO>>',
        enderecoCompleto
      );

    html =
      replaceAllSafe(
        html,
        '<<NOME_ALUNO>>',
        data.aluno
      );

    const todayText =
      currentDateWritten();

    html =
      replaceAllSafe(
        html,
        '<<LOCAL_E_DATA>>',
        `${data.municipioCabecalho || data.municipio}, ${todayText}.`
      );

    return html;
  }

  function openPrintDocument(
    html,
    title
  ) {
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

    let schoolCfg =
      getSchoolConfig();

    if (
      !hasSchoolConfig()
    ) {
      try {
        schoolCfg =
          await autoFetchAndSaveSchoolConfig(
            data.escolaCodigo
          );
      } catch (error) {
        console.warn(
          '[SIGEDUCA Termos] Busca automática dos dados da escola:',
          error
        );

        schoolCfg = null;
      }

      if (!schoolCfg) {
        schoolCfg =
          await showSchoolConfigModal(
            hostDoc,
            false,
            data.escolaCodigo
          );

        if (!schoolCfg) {
          throw new Error(
            'Emissão cancelada.'
          );
        }
      }
    }

    let html;

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

        if (!data.cpfAluno) {
          alert(
            'O CPF do aluno não está preenchido no cadastro. O termo será emitido com um espaço em branco para preenchimento manual do CPF.'
          );
        }

        html =
          buildAuthMatriculaTerm(
            data
          );

        break;
      }

      case 'cienciaMilitar': {

        if (!data.responsavel) {
          throw new Error(
            'O nome do Responsável 1 não está preenchido no cadastro.'
          );
        }

        const rgMilitar =
          await showResponsibleRGModal(
            hostDoc,
            data.responsavel
          );

        html =
          buildCienciaMilitarTerm(
            data,
            rgMilitar
          );

        break;
      }

      default:

        throw new Error(
          'Tipo de documento não reconhecido.'
        );
    }

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
        'Autorização para Matrícula e Retirada de Transferência/Histórico Escolar',

      cienciaMilitar:
        'Termo de Ciência e Concordância — Escola Cívico-Militar'
    };

    openPrintDocument(
      html,
      `${titleMap[termId]} — ${data.aluno}`
    );
  }

  let attempts = 0;
  let installedDoc = null;
  let installedHostDoc = null;
  let isHostOwner = false;

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
Poderão ser tratados, conforme a necessidade, a etapa de ensino e as finalidades institucionais aplicáveis, os seguintes dados pessoais e dados pessoais sensíveis: nome civil e/ou nome social, data de nascimento, nacionalidade e naturalidade, CPF, RG ou outro documento oficial de identificação, endereço residencial, telefone e e-mail, dados dos pais ou responsáveis legais, histórico escolar, certificados e demais documentos da vida escolar, bem como, quando necessários ao atendimento das finalidades institucionais, sexo, raça/cor autodeclarada, informações relacionadas à saúde necessárias ao atendimento escolar, informações sobre atendimento educacional especializado, necessidades nutricionais, tipo sanguíneo, Número de Identificação Social (NIS) e Código Internacional de Doenças (CID), quando aplicável.
</p>

<p class="section">
4. Compartilhamento de Dados:
</p>

<p class="section-text">
Os dados pessoais poderão ser compartilhados, sempre que necessário e observado o disposto na LGPD, com órgãos e entidades da Administração Pública, quando houver obrigação legal ou regulamentar, órgãos de controle, fiscalização e supervisão da educação, autoridades públicas competentes e instituições parceiras que executem atividades educacionais, culturais, esportivas ou recreativas vinculadas às finalidades institucionais da SEDUC/MT, sendo que todo tratamento e compartilhamento observará base legal adequada, finalidade específica, necessidade, segurança e os demais princípios previstos na Lei Geral de Proteção de Dados Pessoais.
</p>

<p class="section">
5. Direitos dos Titulares dos Dados:
</p>

<p class="section-text">
Os pais ou responsáveis, a qualquer momento, têm o direito de: confirmação da existência de tratamento; acessar os dados pessoais do estudante e solicitar a correção de dados incompletos, inexatos ou desatualizados; e solicitar a anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a LGPD;
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
Eventuais alterações relevantes nas finalidades ou nas condições de tratamento serão informadas ao titular ou ao responsável legal, observada a base legal aplicável.
</p>

<p class="section">
6. Segurança dos Dados:
</p>

<p class="section-text">
A unidade escolar adota medidas necessárias para garantir a segurança e confidencialidade dos dados pessoais, evitando acessos não autorizados, perdas, alterações ou divulgações indevidas.
</p>

<p class="paragraph">
Durante a execução do presente Termo, os dados pessoais necessários serão tratados internamente pelos servidores autorizados, que estão diretamente envolvidos com o objeto neste Termo.
</p>

<p class="paragraph">
A comunicação ou o uso compartilhado de dados pessoais de pessoa jurídica de direito público a pessoa de direito privado será informada à autoridade e dependerá de consentimento do titular, observados os requisitos, limites e garantias previstos na Lei Geral de Proteção de Dados Pessoais (LGPD).
</p>

<p class="paragraph">
O Controlador responsabiliza-se pela manutenção de medidas de segurança, técnicas e administrativas aptas a proteger os dados pessoais de acessos não autorizados e de situações acidentais ou ilícitas de destruição, perda, alteração, comunicação ou qualquer forma de tratamento inadequado ou ilícito. Em conformidade ao art. 48 da Lei nº 13.709, o Controlador comunicará ao Titular e à Autoridade Nacional de Proteção de Dados (ANPD) a ocorrência de incidente de segurança que possa acarretar risco ou dano relevante ao Titular.
</p>

<p class="section">
7. Contato para Exercício dos Direitos:
</p>

<p class="section-text">
Para exercer os direitos mencionados no item 5 ou esclarecer qualquer dúvida relacionada ao tratamento de dados pessoais, entre em contato com a Secretaria da unidade escolar por e-mail ou presencialmente.
</p>

<p class="section">
8. Tempo de Tratamento de Dados:
</p>

<p class="section-text">
O Controlador poderá manter e tratar os dados pessoais do Titular durante todo o período em que os mesmos forem pertinentes ao alcance das finalidades listadas neste termo. Dados pessoais anonimizados, sem possibilidade de associação ao indivíduo, poderão ser mantidos por período indefinido.
</p>

<p class="paragraph">
Os formulários que contenham dados pessoais e sensíveis, quando em formato físico, serão armazenados na pasta de vida escolar do estudante e guardados em local seguro, com acesso restrito aos agentes autorizados, e conservados pelos prazos estabelecidos na legislação, nas normas de gestão documental, asseguradas a confidencialidade e a proteção das informações.
</p>

<p class="section">
9. DECLARAÇÃO DO RESPONSÁVEL:
</p>

<p class="declaration">
Eu, <strong><<NOME_RESPONSAVEL>></strong>, responsável legal pelo(a) aluno(a) <strong><<NOME_ALUNO>></strong>, DECLARO que li e compreendi as informações contidas neste Termo de Ciência para o tratamento dos dados pessoais nos termos aqui descritos.
</p>

<p class="signature">
Assinatura: <span class="signature-line"></span>
<span class="signature-caption">
(Responsável legal/Estudante maior de idade)
</span>
</p>

<p class="date-line">
<<LOCAL_E_DATA>>
</p>

<p class="footer-note">
Este termo deve ser preenchido, assinado e entregue na secretaria da unidade escolar, que se compromete a tratar os dados pessoais em conformidade com a LGPD e a respeitar a privacidade e a proteção dos dados dos estudantes e seus responsáveis.
</p>

</div>

</section>

</main>

</body>
</html>`,

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
responsável legal pelo(a) estudante
<strong><<NOME_ALUNO>></strong>,
matriculado(a) na Escola Estadual
<strong><<ESCOLA_NOME_CURTO>></strong>,
DECLARO ESTAR CIENTE de que a imagem e a voz do(a) estudante poderão ser utilizadas pela Secretaria de Estado de Educação de Mato Grosso – SEDUC/MT, para fins educacionais, institucionais e informativos, relacionados às ações desenvolvidas pela Rede Pública Estadual de Ensino.

</p>

<p class="paragraph">

Declaro estar ciente de que a utilização da imagem e da voz poderá ocorrer em fotografias, gravações de áudio, vídeos, podcasts e demais registros audiovisuais produzidos durante atividades pedagógicas, culturais, esportivas, eventos escolares, projetos educacionais e demais ações institucionais promovidas pela unidade escolar, pela Diretoria Regional ou Metropolitana de Educação, pela SEDUC/MT e pelo Governo do Estado de Mato Grosso.

</p>

<p class="paragraph">

Estou ciente de que o presente termo terá validade durante todo o período em que o(a) estudante mantiver vínculo de matrícula na Rede Pública Estadual de Ensino. Os registros captados poderão ser divulgados em meios físicos e digitais, inclusive em sítios eletrônicos, redes sociais, publicações institucionais e demais canais oficiais de comunicação, bem como permanecer armazenados para composição de acervos históricos e memoriais institucionais, mesmo após o encerramento do vínculo escolar, observadas as normas de segurança da informação e a legislação vigente.

</p>

<p class="paragraph">

Declaro estar ciente de que a utilização da imagem e da voz observará os direitos da personalidade, sendo vedada qualquer utilização que implique alteração de seu contexto, desvirtuação de sua finalidade ou violação da honra, da imagem, da intimidade ou da dignidade do estudante, em conformidade com o inciso X do art. 5º da Constituição Federal, com o art. 20 da Lei nº 10.406, de 10 de janeiro de 2002 (Código Civil), e com os princípios estabelecidos na Lei nº 13.709, de 14 de agosto de 2018 (Lei Geral de Proteção de Dados Pessoais – LGPD).

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
matriculado(a) na Escola Estadual
<strong><<ESCOLA_NOME_CURTO>></strong>,
DECLARO ESTAR CIENTE de que a minha imagem e voz poderão ser utilizadas pela Secretaria de Estado de Educação de Mato Grosso – SEDUC/MT, para fins educacionais, institucionais e informativos, relacionados às ações desenvolvidas pela Rede Pública Estadual de Ensino.

</p>

<p class="paragraph">

Declaro estar ciente de que a utilização da imagem e da voz poderá ocorrer em fotografias, gravações de áudio, vídeos, podcasts e demais registros audiovisuais produzidos durante atividades pedagógicas, culturais, esportivas, eventos escolares, projetos educacionais e demais ações institucionais promovidas pela unidade escolar, pela Diretoria Regional ou Metropolitana de Educação, pela SEDUC/MT e pelo Governo do Estado de Mato Grosso.

</p>

<p class="paragraph">

Estou ciente de que o presente termo terá validade durante todo o período em que eu mantiver vínculo de matrícula na Rede Pública Estadual de Ensino. Os registros captados poderão ser divulgados em meios físicos e digitais, inclusive em sítios eletrônicos, redes sociais, publicações institucionais e demais canais oficiais de comunicação, bem como permanecer armazenados para composição de acervos históricos e memoriais institucionais, mesmo após o encerramento do vínculo escolar, observadas as normas de segurança da informação e a legislação vigente.

</p>

<p class="paragraph">

Declaro estar ciente de que a utilização da imagem e da voz observará os direitos da personalidade, sendo vedada qualquer utilização que implique alteração de seu contexto, desvirtuação de sua finalidade ou violação da minha honra, imagem, intimidade ou dignidade, em conformidade com o inciso X do art. 5º da Constituição Federal, com o art. 20 da Lei nº 10.406, de 10 de janeiro de 2002 (Código Civil), e com os princípios estabelecidos na Lei nº 13.709, de 14 de agosto de 2018 (Lei Geral de Proteção de Dados Pessoais – LGPD).

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

.doc-title{
  margin-bottom:8mm;

  font-weight:700;

  text-align:center;
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

.opening-paragraph{
  line-height:1.65;
}

.legal-list{
  margin:
    0
    0
    5.6mm;

  padding-left:13mm;
}

.legal-list li{
  margin-bottom:2mm;

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

<div class="doc-title">
TERMO DE COMPROMISSO FAMILIAR PARA O ANO LETIVO SUBSEQUENTE
</div>

<p class="legal-paragraph opening-paragraph">

Eu,
<strong><<NOME_RESPONSAVEL>></strong>,
portador(a) da Carteira de Identidade nº
<strong><<RG_RESPONSAVEL>></strong>,
inscrito(a) no CPF nº
<strong><<CPF_RESPONSAVEL>></strong>,
residente e domiciliado(a) à
<strong><<ENDERECO_ALUNO>></strong>,
Município de
<strong><<MUNICIPIO>></strong>,
Estado de Mato Grosso, responsável legal pelo(a) estudante
<strong><<NOME_ALUNO>></strong>,
matriculado(a) na
<strong><<ESCOLA_NOME>></strong>,
para o ano letivo de
<strong><<ANO_LETIVO>></strong>,
firmo o presente Termo de Compromisso com a Frequência Escolar, assumindo as seguintes responsabilidades:

</p>

<p class="section-title">
I – DO COMPROMISSO
</p>

<p class="legal-paragraph">
Comprometo-me a:
</p>

<ul class="legal-list">

<li>
assegurar a frequência regular do(a) estudante às atividades escolares durante todo o ano letivo;
</li>

<li>
acompanhar sua vida escolar, observando sua assiduidade, rendimento e participação nas atividades propostas pela unidade escolar;
</li>

<li>
comunicar à escola, com a maior brevidade possível, qualquer situação que impeça temporariamente a frequência do(a) estudante;
</li>

<li>
apresentar documentação comprobatória, quando necessária, para justificar ausências, conforme as normas da unidade escolar e da legislação vigente;
</li>

<li>
manter atualizados meus dados cadastrais junto à escola, possibilitando a comunicação entre a família e a instituição de ensino;
</li>

<li>
participar das reuniões, atendimentos e demais ações promovidas pela escola, colaborando com o desenvolvimento educacional do(a) estudante.
</li>

</ul>

<p class="section-title">
II – DA FUNDAMENTAÇÃO LEGAL
</p>

<p class="legal-paragraph">

Declaro estar ciente de que a educação constitui direito de todos e dever do Estado e da família, conforme estabelece o art. 205 da Constituição Federal de 1988:

</p>

<p class="quote">

"A educação, direito de todos e dever do Estado e da família, será promovida e incentivada com a colaboração da sociedade, visando ao pleno desenvolvimento da pessoa, seu preparo para o exercício da cidadania e sua qualificação para o trabalho."

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

<p class="legal-paragraph">

Declaro, ainda, ter conhecimento de que, nos termos do art. 24, inciso VI, da Lei nº 9.394/1996 (Lei de Diretrizes e Bases da Educação Nacional), é exigida a frequência mínima de <strong>75% (setenta e cinco por cento)</strong> do total de horas letivas para aprovação, cabendo à escola o controle da frequência dos estudantes.

</p>

<p class="legal-paragraph">

Estou ciente, igualmente, de que o Estatuto da Criança e do Adolescente (Lei nº 8.069/1990) assegura o direito à educação e estabelece a corresponsabilidade da família na garantia do acesso e da permanência da criança e do adolescente na escola.

</p>

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
Eu, <strong><<NOME_RESPONSAVEL>></strong>, de nacionalidade brasileira, portador(a) do telefone <<TELEFONES_RESPONSAVEL>>, inscrito(a) no CPF sob o nº <<CPF_RESPONSAVEL>>, venho, por meio deste documento, autorizar o(a) senhor(a) <span class="blank-inline blank-name"></span>, de nacionalidade <span class="blank-inline blank-nationality"></span>, portador(a) do CPF nº <span class="blank-inline blank-cpf"></span>, a efetuar matrícula e a solicitar ou retirar transferência, histórico escolar e demais documentos referentes à matrícula do(a) aluno(a) <strong><<NOME_ALUNO>></strong>, de nacionalidade brasileira, portador(a) do CPF nº <<CPF_ALUNO>>.
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

</html>`,

    cienciaMilitar: `<!DOCTYPE html>
<html lang="pt-BR">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>
Termo de Ciência e Concordância — Escola Cívico-Militar
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
    "SF Pro Text",
    "Helvetica Neue",
    Helvetica,
    Arial,
    sans-serif;
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
}

.header-military{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:6mm;

  padding-bottom:5mm;

  border-bottom:.3mm solid #000;

  margin-bottom:9mm;
}

.header-spacer{
  width:23mm;
  flex:0 0 auto;
}

.header-text{
  flex:1;

  text-align:center;
}

.header-anexo{
  font-size:11pt;
  font-weight:700;

  margin-bottom:5mm;
}

.header-institution{
  font-size:12pt;
  font-weight:700;
  line-height:1.6;

  text-transform:uppercase;
}

.header-brasao{
  display:block;

  width:23mm;
  height:auto;

  flex:0 0 auto;
}

.body{
  font-size:12.5pt;

  line-height:1.75;

  text-align:justify;
}

.doc-title{
  margin-bottom:9mm;

  font-size:13.5pt;
  font-weight:700;

  text-align:center;
}

.legal-paragraph{
  margin:
    0
    0
    6.5mm;

  text-indent:8mm;

  text-align:justify;
}

.blank-inline{
  display:inline-block;

  border-bottom:.25mm solid #000;
  vertical-align:baseline;

  margin:0 1mm;

  width:30mm;
}

.date-line{
  margin-top:14mm;

  text-align:left;
}

.final-signature{
  margin-top:16mm;

  text-align:center;
}

.final-signature-line{
  width:85mm;

  height:7mm;

  margin:
    0
    auto;

  border-bottom:
    .25mm solid #000;
}

.final-signature-label{
  margin-top:2mm;

  font-size:12pt;
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

<section class="page">

<header class="header-military">

<div class="header-spacer"></div>

<div class="header-text">

<div class="header-anexo">
Anexo I
</div>

<div class="header-institution">
Estado de Mato Grosso<br>
Secretaria de Estado de Educação<br>
Superintendência de Escolas Militares e Cívico-Militares<br>
Escola Estadual Cívico-Militar
</div>

</div>

<img
  class="header-brasao"
  src="https://drive.google.com/thumbnail?id=1ooGkSLedmC2m64g4OmfJnv8wvzIaDWBV&sz=w1000"
  alt="Escola Estadual Cívico-Militar"
>

</header>

<div class="body">

<div class="doc-title">
TERMO DE CIÊNCIA E CONCORDÂNCIA
</div>

<p class="legal-paragraph">

Eu, <strong><<NOME_RESPONSAVEL>></strong> (nome completo), portador do documento de identidade nº <strong><<RG_RESPONSAVEL>></strong>, CPF nº <strong><<CPF_RESPONSAVEL>></strong>, residente e domiciliado em <strong><<ENDERECO_ALUNO>></strong> (endereço completo), responsável legal pelo aluno(a) <strong><<NOME_ALUNO>></strong> (nome completo), matriculado na turma <span class="blank-inline"></span>, Declaro, para todos os fins úteis, que:

</p>

<p class="legal-paragraph">

Estou familiarizado com as disposições contidas no Manual das Escolas Cívicas e Militares do Estado, incluindo, mas não se limitando a, normas disciplinares, regulamentos internos, diretrizes educacionais, procedimentos de segurança e protocolos administrativos.

</p>

<p class="legal-paragraph">

Aceito o conteúdo dos documentos de orientação, sejam eles o Regulamento Disciplinar Escolar, o Projeto de Política Pedagógica, as Normas e Orientações a que se referem, nomeadamente a apresentação pessoal e o sistema de créditos e reduções, bem como, afirmo que tenho conhecimento dos documentos aqui citados.

</p>

<p class="date-line">
<<LOCAL_E_DATA>>
</p>

<div class="final-signature">

<div class="final-signature-line">
</div>

<div class="final-signature-label">
Nome e assinatura do responsável
</div>

</div>

</div>

</section>

</main>

</body>

</html>`
  };

})();