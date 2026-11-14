/* printFair mobile ui implementation.
   single request ledger, mock authentication and same-browser demo retrieval.
*/
(() => {
  'use strict';

  const STORE_KEY = 'printfair-m3-prototype-2026';
  const backend = window.PrintFairBackend;
  const cloudMode = Boolean(backend?.isConfigured());
  const LIMIT = 20;
  const $ = selector => document.querySelector(selector);
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const localParts = date => new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).reduce((out, item) => { out[item.type] = item.value; return out; }, {});
  const todayKey = () => { const d = localParts(new Date()); return `${d.year}-${d.month}-${d.day}`; };
  const demoTime = day => `${day}T14:20:00+08:00`;
  const now = () => new Date(state.previewTime || demoTime(todayKey()));
  const timestampLabel = iso => {
    if (!iso) return 'Not recorded';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return String(iso);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Manila', month:'short', day:'numeric' }).format(date);
    const time = new Intl.DateTimeFormat('en-US', { timeZone:'Asia/Manila', hour:'numeric', minute:'2-digit' }).format(date);
    return `${day} · ${time}`;
  };
  const todayOf = iso => iso && String(iso).slice(0, 10) === state.previewTime.slice(0, 10);
  const STATUS = Object.freeze({ Reserved:'Ready for retrieval', Retrieved:'Retrieved', Cancelled:'Cancelled', Failed:'Failed', Expired:'Expired' });
  const VALID = Object.keys(STATUS);
  let signInRole = 'student';
  let uiDraftFileUrl = null;
  let selectedPdfFile = null;
  let selectedPdfBytes = null;
  let stopLiveUpdates = null;
  let profileReturn = 'dashboard';
  let correctionTarget = null;

  function sampleRecord(id, file, pages, status, at, identity, extras = {}) {
    return {
      id, file, pages, totalPages: extras.totalPages || pages,
      pageRange: extras.pageRange || `1-${pages}`, status,
      code: extras.code || null, student: identity.display, email: identity.email,
      year: identity.year, program: identity.program,
      createdAt: at, retrievedAt: status === 'Retrieved' ? at : null,
      stationId: extras.stationId || null, countedPages: status === 'Retrieved' ? pages : 0,
      failedAfterRetrieval: false, reason: '',
      history: [{ status, at, reason: 'Initial demonstration record' }]
    };
  }

  function initialState() {
    const day = todayKey();
    const mika = {
      name: 'Mika Santos Valmorina', display: 'MIKA SANTOS',
      email: '20210039182@my.xu.edu.ph', year: '2nd Year', program: 'BS Information Technology'
    };
    const jordan = { name:'Jordan Cruz', display:'JORDAN CRUZ', email:'20260021919@my.xu.edu.ph', year:'1st Year', program:'BS Information Technology' };
    return {
      version: 4, role: null, previewTime: demoTime(day), student: mika,
      stations: [
        { id:'old2', name:'Old Library', floor:'2nd floor', status:'Operational', reason:'', updatedAt:demoTime(day) },
        { id:'new2', name:'New Library', floor:'2nd floor', status:'Unavailable', reason:'Printer maintenance reported', updatedAt:demoTime(day) },
        { id:'new5', name:'New Library', floor:'5th floor', status:'Operational', reason:'', updatedAt:demoTime(day) },
        { id:'med5', name:'School of Medicine', floor:'5th floor', status:'Operational', reason:'', updatedAt:demoTime(day) }
      ],
      requests: [
        sampleRecord('PF-0241','Research_Paper.pdf',8,'Reserved',`${day}T14:15:00+08:00`,mika,{totalPages:8,pageRange:'1-8',code:'CN3-0241'}),
        sampleRecord('PF-0240','Lab_Handout.pdf',6,'Retrieved',`${day}T11:40:00+08:00`,mika,{stationId:'new5'}),
        sampleRecord('PF-0239','Essay_Final.pdf',3,'Retrieved',`${day}T10:12:00+08:00`,jordan,{stationId:'old2'}),
        sampleRecord('PF-0238','ITCC31_Lab_ACT4.pdf',4,'Cancelled','2026-10-30T09:15:00+08:00',mika)
      ],
      nextId: 242,
      draft: { file:'No document selected', totalPages:0, range:'', isSample:false },
      corrections: []
    };
  }

  function migrate(raw) {
    if (!raw || !Array.isArray(raw.requests)) return initialState();
    if (raw.version === 4) return raw;
    const next = initialState();
    next.role = raw.role || null;
    next.student = { ...next.student, ...(raw.student || {}) };
    next.stations = Array.isArray(raw.stations) ? raw.stations.map(s => ({...s, updatedAt:next.previewTime})) : next.stations;
    next.nextId = Number(raw.counter) || 242;
    if (raw.draft) next.draft = {
      file: raw.draft.file || next.draft.file,
      totalPages: Number(raw.draft.pages) || 0, range: raw.draft.range || '', isSample:true
    };
    const legacy = [...raw.requests, ...(Array.isArray(raw.transactions) ? raw.transactions : [])];
    const seen = new Set();
    const recs = [];
    for (const row of legacy) {
      if (!row.id || seen.has(row.id)) continue;
      seen.add(row.id);
      const status = VALID.includes(row.status) ? row.status : 'Failed';
      let at = `${todayKey()}T14:15:00+08:00`;
      if (/Oct\s*30/i.test(row.time || '')) at = '2026-10-30T14:15:00+08:00';
      const r = sampleRecord(row.id, row.file, Number(row.pages) || 1, status, at,
        { display:row.student || next.student.display, email:row.email || next.student.email,
          year:row.year || next.student.year, program:row.program || next.student.program },
        { totalPages: Number(row.total) || Number(row.pages) || 1, pageRange:row.range || `1-${row.pages}`, code:row.code || null });
      if (row.station) r.stationId = next.stations.find(s => row.station.includes(s.name) && row.station.includes(s.floor))?.id || null;
      recs.push(r);
    }
    if (recs.length) next.requests = recs;
    return next;
  }

  let state;
  try { state = migrate(JSON.parse(localStorage.getItem(STORE_KEY) || localStorage.getItem('printfair-m2-prototype-2026') || 'null')); }
  catch { state = initialState(); }
  // A File object cannot survive a page reload; require the student to reselect the PDF.
  if (state.draft && state.draft.totalPages) state.draft = { file:'No document selected', totalPages:0, range:'', isSample:false };
  const save = () => { if (cloudMode) return; try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch(e) { console.warn('Demo storage could not be saved',e); } };
  const currentUserRequests = () => state.requests.filter(r => r.email === state.student.email);
  const activeRequest = () => currentUserRequests().find(r => r.status === 'Reserved') || null;
  const isToday = r => { if(!r.createdAt) return false; const d=localParts(new Date(r.createdAt)); return `${d.year}-${d.month}-${d.day}` === todayKey(); };
  const usedPages = () => currentUserRequests().filter(isToday).reduce((n,r) => n + (Number(r.countedPages) || 0), 0);
  const pendingPages = () => currentUserRequests().filter(r => isToday(r) && r.status === 'Reserved').reduce((n,r)=>n+r.pages,0);
  const remainingPages = () => Math.max(0, LIMIT - usedPages() - pendingPages());
  const stationTitle = id => { const s = state.stations.find(x => x.id === id); return s ? `${s.name} · ${s.floor}` : 'Not recorded'; };
  const validRange = (value,max) => window.PrintFairRules.parsePageRange(value,max);
  function expirePending() {
    if (cloudMode) return; // Cloud expiry is enforced by the database when a code is claimed.
    // A frozen afternoon clock lets the course UI demo work after library hours.
    const current=now().getTime(); let changed=false;
    for(const r of state.requests) {
      if(r.status==='Reserved' && new Date(`${r.createdAt.slice(0,10)}T16:30:00+08:00`).getTime() <= current) {
        changeStatus(r,'Expired','Unused code expired'); changed=true;
      }
    }
    if(changed) save();
  }
  function permittedCorrection(record, next) {
    if (next === 'Reserved') return false;
    if (next === record.status) return true;
    if (next === 'Retrieved') return Boolean(record.retrievedAt);
    return ['Failed','Cancelled','Expired'].includes(next);
  }
  function changeStatus(record, next, reason='') {
    if(!VALID.includes(next)) throw new Error('Invalid request status');
    const previous=record.status;
    if(previous===next) return;
    if(previous === 'Retrieved' && next === 'Failed') record.failedAfterRetrieval = true;
    if(next === 'Retrieved' && previous !== 'Retrieved') {
      record.retrievedAt = now().toISOString();
      record.countedPages = record.pages;
    }
    if(previous === 'Reserved' && ['Cancelled','Failed','Expired'].includes(next)) record.countedPages=0;
    record.status=next;
    record.reason=reason;
    record.history ||= [];
    record.history.push({status:next,at:now().toISOString(),reason});
  }

  const iconPaths = {
    home:'<path d="m3 9 9-7 9 7v11a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
    printer:'<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6zM18 12h.01"/>',
    history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v6l4 2"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
    left:'<path d="M19 12H5m6 6-6-6 6-6"/>',
    check:'<path d="M20 6 9 17l-5-5"/>',
    eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    clock:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    close:'<path d="M18 6 6 18M6 6l12 12"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
    lock:'<rect x="4" y="10" width="16" height="12" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    info:'<circle cx="12" cy="12" r="10"/><path d="M12 11v6m0-10h.01"/>',
    alert:'<circle cx="12" cy="12" r="10"/><path d="M12 7v6m0 4h.01"/>',
    copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/>'
  };
  const icon = (name, size=18) => `<svg class="icon" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.file}</svg>`;
  const route = () => decodeURIComponent(location.hash.replace(/^#\/?/,'') || 'login');
  const button = (label,action,classes='btn block',arrow=false) => `<button type="button" class="${classes}" data-action="${action}">${label}${arrow?`<span class="tail">${icon('arrow',16)}</span>`:''}</button>`;
  const card = (markup, classes='') => `<section class="card ${classes}">${markup}</section>`;
  const badge = (value) => `<span class="badge ${['Operational','Retrieved'].includes(value)?'good':['Unavailable','Failed','Cancelled','Expired'].includes(value)?'bad':'neutral'}">${escapeHTML(value)}</span>`;
  const brand = notify => `<header class="brand"><img class="brand-logo" src="assets/xu-100-logo.png" alt="Xavier Ateneo centennial logo"><span class="brand-divider"></span><div class="brand-copy"><div class="brand-name">PrintFair</div><div class="brand-sub">XU Library printing support</div></div>${notify?`<button type="button" class="noti" data-action="notifications" aria-label="Notifications">${icon('bell',17)}</button>`:''}</header>`;
  const heading = (text,sub='') => `<div class="page"><h1>${text}</h1><div class="underline"></div>${sub?`<p class="subheading">${sub}</p>`:''}`;
  const nav = (selected,staff=false) => {
    const links=staff?[
      ['dashboard-admin','Home','home'],['stations-admin','Stations','printer'],['transactions-admin','Transactions','file'],['profile-admin','Profile','user']
    ]:[['dashboard','Home','home'],['requests','Requests','file'],['allowance','History','history'],['profile','Profile','user']];
    return `<nav class="bottomnav" aria-label="Main navigation">${links.map(([to,label,ico])=>`<button type="button" class="nav-item ${selected===to?'active':''}" data-route="${to}" aria-label="${label}"><span class="ni">${icon(ico,19)}</span><span>${label}</span></button>`).join('')}</nav>`;
  };
  const shell = (content,selected='dashboard',staff=false,notify=false) => `<div class="shell">${brand(notify)}${content}</div>${nav(selected,staff)}`;
  const stationCard = s => card(`<div class="station"><span class="iconplate">${icon('printer',18)}</span><div class="docinfo"><div class="name">${escapeHTML(s.name)}</div><div class="floor">${escapeHTML(s.floor)}</div></div>${badge(s.status)}</div>`, 'station-card');
  const allowanceCard = () => `<div class="allowance"><div class="allowance-ico">${icon('file',18)}</div><small>DAILY PAGE ALLOWANCE</small><div class="amount"><strong>${remainingPages()}</strong><span>/ 20 pages</span></div><div class="bar"><div class="bar-fill" style="width:${remainingPages()/LIMIT*100}%"></div></div><p class="foot">Available for PrintFair requests</p></div>`;
  const documentCard = r => card(`<div class="row"><span class="docicon">${icon('file',19)}</span><div class="docinfo"><div class="filename">${escapeHTML(r.file)}</div><div class="meta">${r.pages} pages · ${timestampLabel(r.createdAt)}</div></div>${badge(r.status)}</div>`);
  const requestList = () => currentUserRequests().slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const sectionHeading = (label, routeKey, linkLabel) => `<div class="section-head"><h2>${label}</h2>${routeKey?`<button class="link" data-route="${routeKey}">${linkLabel || 'View all'}</button>`:''}</div>`;

  function dashboard() {
    const active=activeRequest();
    return shell(heading('Student Dashboard','Prepare now. Print at the library.') + allowanceCard() +
      button(`${icon('file',17)} New print request`,'start-upload','btn block primary-action',true) +
      sectionHeading('Printing stations','stations') + state.stations.slice(0,3).map(stationCard).join('') +
      sectionHeading('Your requests','requests','View history') +
      (active ? card(`<div class="row"><span class="docicon">${icon('file',18)}</span><div class="docinfo"><div class="filename">${escapeHTML(active.file)}</div><div class="meta">${active.pages} pages · Ready for retrieval</div></div></div>${button('View request','requests','btn sm block top')}`)
        : card(`<div class="row"><span class="docicon">${icon('file',18)}</span><div><div class="filename">No active requests yet</div><div class="meta">Your next print request will appear here.</div></div></div>`)) + '</div>', 'dashboard',false,true);
  }
  function upload() {
    const draft=state.draft;
    return shell(heading('Upload PDF','Step 1 of 2 - Prepare your document') +
      '<div class="stepbar"><span class="on"></span><span></span></div><div class="row between xs"><strong>1 Upload document</strong><span class="text-muted">2 Review</span></div>' +
      `<div class="uploadbox"><span class="uploadico">${icon('upload',29)}</span><b>Choose a PDF document</b><span class="sm text-muted">Upload your finished, ready-to-print file.</span><label class="btn sm" for="pdf-file">Browse files</label><input id="pdf-file" type="file" accept="application/pdf,.pdf" class="visually-hidden"></div>` +
      '<div class="label">SELECTED DOCUMENT</div>' + (draft.totalPages > 0
        ? card(`<div class="row"><span class="docicon">${icon('file',19)}</span><div class="docinfo"><div class="filename">${escapeHTML(draft.file)}</div><div class="meta">${draft.totalPages} actual PDF pages</div></div><span class="positive-icon">${icon('check',19)}</span></div>`)
        : card('<div class="row"><span class="docicon">'+icon('file',19)+'</span><div class="docinfo"><div class="filename">No PDF selected</div><div class="meta">Choose a valid PDF to see its actual page count.</div></div></div>')) +
      `<div class="notice">${icon('info',15)} <b>Before you continue</b><br>Only upload academic, ready-to-print PDFs. Maximum upload size: 20 MB. Finish editing before visiting the library.</div>` +
      button('Continue to preview','review','btn block',true) + `<p class="xs text-muted centered">${cloudMode?'PDFs are stored privately when the shared backend is configured.':'Demo mode: local documents stay in this browser only.'}</p></div>`, 'requests');
  }
  function review() {
    const draft=state.draft;
    if (!draft.totalPages || !selectedPdfFile) return shell(heading('No PDF selected','Choose a valid PDF before reviewing your request.')+button('Back to upload','upload','btn block top')+'</div>','requests');
    const pages=validRange(draft.range,draft.totalPages);
    const allowed=pages!==null && window.PrintFairRules.canReserve(remainingPages(),pages) && !activeRequest();
    const validation=activeRequest()?'You already have an active request.':pages===null?'Enter a page range within the document.':pages>remainingPages()?`Only ${remainingPages()} pages are currently available.`:`Within your recorded allowance. Available: ${remainingPages()} · Request: ${pages} · Remaining: ${remainingPages()-pages}`;
    return shell(heading('Review & submit','Step 2 of 2 - Check your printing request') +
      '<div class="stepbar"><span class="on"></span><span class="on"></span></div><div class="row between xs"><strong>1 Uploaded</strong><strong>2 Review</strong></div>' +
      card(`<div class="review-file">${icon('file',17)} <span class="filename">${escapeHTML(draft.file)}</span><span class="meta">${draft.totalPages} pages</span></div><div class="row top"><div class="pdfpreview"><div class="pdf-page"><canvas id="pdf-preview-canvas" aria-label="Selected PDF page preview"></canvas></div></div><div class="flex1"><b class="sm">Document preview</b><div class="bold top">Page <span id="preview-current">1</span> of ${draft.totalPages}</div><p class="sm text-muted">Review the document layout.</p><div class="row">${button(icon('left',16),'prev-preview','btn ghost sm')}${button(icon('arrow',16),'next-preview','btn ghost sm')}</div></div></div>`, 'top') +
      card(`<b class="sm">Pages to print</b><p class="xs text-muted">Choose a range (example: 1-8)</p><div class="field-row"><input id="page-range" class="range-input" aria-label="Page range" value="${escapeHTML(draft.range)}"><span class="sm" id="range-count">${pages===null?'Invalid range':`${pages} pages selected`}</span></div>`, 'top') +
      `<div class="notice ${allowed?'green':'red'}" id="validation-notice">${escapeHTML(validation)}</div>` +
      button('Submit print request','submit','btn block',true) + '<p class="xs text-muted centered">A retrieval code is generated after submission.</p></div>', 'requests');
  }
  function activeCard(r) {
    return card(`<div class="topline"><span class="status-name">Ready for retrieval</span><span>#${escapeHTML(r.id)}</span></div><div class="row"><span class="docicon">${icon('file',20)}</span><div class="docinfo"><div class="filename">${escapeHTML(r.file)}</div><div class="meta">${r.pages} pages · PDF document</div></div></div><div class="divider"></div><div class="row between"><span class="xs text-muted">Requested</span><b class="xs">${timestampLabel(r.createdAt)}</b></div><div class="row between top"><span class="xs text-muted">Code status</span><b class="xs status-name">Active</b></div>${button(`${icon('eye',16)} View printing code`,'view-code','btn block top',true)}${button(`${icon('close',14)} Cancel request`,'cancel-request','btn danger block top')}`, 'request');
  }
  function requests() {
    const active=activeRequest();
    const past=requestList().filter(r=>r.status!=='Reserved');
    return shell(heading('My requests','Track your request and access your printing code') +
      '<div class="label top">ACTIVE REQUEST</div>' + (active?activeCard(active):card(`<div class="row"><span class="docicon">${icon('file',20)}</span><span class="sm">No active request. You can prepare a new PDF request.</span></div>${button('New print request','start-upload','btn sm block top')}`)) +
      sectionHeading('Previous requests','allowance','View history') + (past.length?past.map(r=>`<button type="button" class="record-button" data-route="request-detail/${escapeHTML(r.id)}">${documentCard(r)}</button>`).join(''):card('<p class="sm text-muted">No previous requests yet.</p>')) +
      '</div>','requests');
  }
  function code() {
    const r=activeRequest();
    if(!r) return shell(heading('Retrieval Code','No active request') + card('<p class="sm">There is no document currently awaiting retrieval.</p>')+button('Back to requests','requests','btn block top')+'</div>','requests');
    return shell(heading('Retrieval Code') + '<div class="text-status good-text">Ready for retrieval</div>' +
      card(`<div class="row"><span class="docicon">${icon('file',20)}</span><div><div class="filename">${escapeHTML(r.file)}</div><div class="meta">${r.pages} pages · PDF document<br>Requested ${timestampLabel(r.createdAt)}</div></div></div>`, 'top') +
      `<div class="codebox"><small>YOUR RETRIEVAL CODE</small><div class="code">${escapeHTML(r.code)}</div><small>${icon('clock',12)} VALID UNTIL ${r.expiresAt?timestampLabel(r.expiresAt):'4:30 PM'}</small></div>` +
      card(`<b class="sm">How to retrieve your document</b><div class="col top">${[
        'Go to an available library printing station',
        'Enter the code on the PC webpage',
        'Open your prepared PDF and print normally'
      ].map((text,i)=>`<div class="row"><span class="stepnumber">${i+1}</span><span class="sm text-muted">${text}</span></div>`).join('')}</div>`) +
      `<div class="top">${button(`${icon('copy',16)} Copy code`,'copy-code','btn secondary block sm')}</div></div>`,'requests');
  }
  function stations() {
    return shell(heading('Printing Station','Staff-updated availability across the library')+
      state.stations.map(stationCard).join('')+'<p class="xs text-muted top">Station statuses are updated by staff.</p></div>','requests');
  }
  function allowance() {
    const history=requestList().filter(r=>r.status!=='Reserved');
    return shell(heading('Printing Allowance','Monitor your daily pages and printing history') + allowanceCard() +
      `<div class="pills"><div class="statbox"><div class="label">RETRIEVED PAGES</div><div class="value">${usedPages()}</div><div class="desc">Pages recorded</div></div><div class="statbox"><div class="label">PENDING PAGES</div><div class="value">${pendingPages()}</div><div class="desc">Pages reserved</div></div></div>` +
      `<div class="statbox top centered day-total"><div class="label">DAILY LIMIT</div><div class="value">${LIMIT}</div><div class="desc">Pages allowed</div></div>` +
      sectionHeading('Printing History') + (history.length?history.map(r=>`<button type="button" class="record-button" data-route="request-detail/${escapeHTML(r.id)}">${documentCard(r)}</button>`).join(''):card('<p class="sm text-muted">No previous requests recorded.</p>')) +
      '<p class="xs text-muted top">These records reflect requested and retrieved pages, not verified physical printing.</p></div>', 'allowance');
  }
  function profile(staff=false) {
    return shell(heading(staff?'Admin Profile':'My Profile','Manage your account details') +
      card(`<div class="row"><span class="avatar">${staff?'LS':'MS'}</span><div class="docinfo"><b class="profile-name">${escapeHTML(cloudMode?state.student.display:(staff?'LIBRARY STAFF':state.student.display))}</b><div class="meta">${escapeHTML(cloudMode?state.student.email:(staff?'library.staff@xu.edu.ph':state.student.email))}</div><p class="role-description">${staff?'Authorized library staff account':'Student account'}</p></div></div>`) +
      '<h2>Account information</h2>' + card(`<div class="record-row"><span class="k">Full name</span><span class="v">${escapeHTML(cloudMode?state.student.name:(staff?'Library Staff':state.student.name))}</span></div><div class="record-row"><span class="k">XU email</span><span class="v">${cloudMode?escapeHTML(state.student.email):(staff?'library.staff@xu.edu.ph':escapeHTML(state.student.email))}</span></div>${staff?'':`<div class="record-row"><span class="k">Year level</span><span class="v">${escapeHTML(state.student.year)}</span></div><div class="record-row"><span class="k">Course / Program</span><span class="v">${escapeHTML(state.student.program)}</span></div>`}`) +
      '<h2>Library information</h2>' + card(`<button type="button" class="plain-row" data-route="guidelines">${icon('file',17)} Free printing guidelines ${icon('arrow',15)}</button>`) +
      button(`${icon('logout',16)} Sign out`,'logout','btn danger block top') +
      '</div>', staff?'profile-admin':'profile',staff);
  }
  function adminDashboard() {
    const today=state.requests.filter(isToday);
    const retrieved=today.filter(r=>r.status==='Retrieved').length;
    const r=state.requests.find(x=>x.status==='Reserved');
    return shell(heading('Admin Dashboard','Printing requests and station overview') +
      card(`<div class="stats3"><div><strong>${today.length}</strong><small>Requests today</small></div><div><strong>${retrieved}</strong><small>Retrieved</small></div><div><strong>${state.stations.filter(s=>s.status==='Operational').length}/${state.stations.length}</strong><small>Operational</small></div></div>`) +
      sectionHeading('Printing stations','stations-admin','Manage')+state.stations.slice(0,3).map(stationCard).join('') +
      sectionHeading('Recent activity','transactions-admin') + (r?documentCard(r):card('<p class="sm text-muted">No active requests.</p>')) +
      '<p class="xs text-muted top">Printing remains outside PrintFair. Admins manage station information and request records.</p></div>','dashboard-admin',true);
  }
  function adminStations() {
    return shell(heading('Printing Station','Manage printing station status') +
      card(`<div class="row between"><span class="sm text-muted">Stations operational</span><b class="sm">${state.stations.filter(s=>s.status==='Operational').length} / ${state.stations.length}</b></div>`) +
      state.stations.map(s=>card(`<div class="row"><span class="docicon">${icon('printer',18)}</span><div><b class="sm">${escapeHTML(s.name)}</b><div class="meta">${escapeHTML(s.floor)}</div></div></div><div class="field"><label for="station-${escapeHTML(s.id)}">Status</label><select id="station-${escapeHTML(s.id)}" data-station="${escapeHTML(s.id)}">${['Operational','Unavailable','Under Maintenance'].map(v=>`<option value="${v}" ${s.status===v?'selected':''}>${v}</option>`).join('')}</select></div>${s.reason?`<div class="meta">${escapeHTML(s.reason)}</div>`:''}`, 'top')).join('')+
      button(`${icon('plus',17)} Add station`,'add-station','btn block top')+'</div>','stations-admin',true);
  }
  function recordCard(r) {
    const letters=r.student.split(' ').map(x=>x[0]).slice(0,2).join('');
    return `<button class="record-button" data-route="transaction-detail/${escapeHTML(r.id)}" type="button">${card(`<div class="row"><span class="avatar small-avatar">${escapeHTML(letters)}</span><div class="docinfo"><b class="sm">${escapeHTML(r.student)}</b><div class="meta">${escapeHTML(r.email)}</div></div></div><div class="divider"></div><div class="row between"><div class="docinfo"><div class="filename">${escapeHTML(r.file)}</div><div class="meta">${r.pages} pages · ${timestampLabel(r.createdAt)}</div></div>${badge(r.status)}</div>`)}</button>`;
  }
  function adminTransactions() {
    const all=state.requests.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const today=all.filter(isToday);
    return shell(heading('Admin transactions','Review digital printing request records') +
      card(`<div class="label">TODAY'S ACTIVITY</div><div class="stats3"><div><strong>${today.length}</strong><small>Requests</small></div><div><strong>${today.filter(r=>r.status==='Retrieved').length}</strong><small>Retrieved</small></div><div><strong>${today.filter(r=>r.status==='Reserved').length}</strong><small>Reserved</small></div></div>`) +
      '<div class="field"><label class="sr-only" for="transaction-search">Search student or document</label><input id="transaction-search" type="search" placeholder="Search student or document" autocomplete="off"></div>' +
      sectionHeading('Printing activity')+`<div id="transaction-list">${all.map(recordCard).join('')}</div></div>`,'transactions-admin',true);
  }
  function informationRow(name,value) { return `<div class="record-row"><span class="k">${name}</span><span class="v">${escapeHTML(value)}</span></div>`; }
  function details(id,staff=false) {
    const r=state.requests.find(x=>x.id===id);
    if (!r || (!staff && r.email!==state.student.email)) return staff?adminTransactions():requests();
    const headingText=staff?'Transaction details':'Request details';
    return shell(heading(headingText,'Digital request and retrieval record') +
      card(`<div class="row"><span class="docicon">${icon('file',19)}</span><div class="docinfo"><div class="filename">${escapeHTML(r.file)}</div><div class="meta">Request #${escapeHTML(r.id)}</div><div class="top">${badge(r.status)}</div></div><b class="sm">${r.pages} pages</b></div>`) +
      '<h2>Student information</h2>' + card(informationRow('Student name',r.student)+informationRow('Gmail address',r.email)+informationRow('Year level',r.year)+informationRow('Course / Program',r.program)) +
      '<h2>Request & retrieval record</h2>' + card(informationRow('Requested pages',`${r.pages} pages`)+informationRow('Pages counted in allowance',`${r.countedPages} pages`)+informationRow('Retrieved pages',`${r.retrievedAt?r.pages:0} pages`)+informationRow('Status',r.status)+informationRow('Requested at',timestampLabel(r.createdAt))+informationRow('Retrieved at',r.retrievedAt?timestampLabel(r.retrievedAt):'Not retrieved')+informationRow('Station',stationTitle(r.stationId)) + (r.reason?informationRow('Note',r.reason):'')) +
      '<div class="notice blue top">Retrieval is recorded automatically. This does not confirm physical printing.</div>' +
      (staff?button('Correct record','open-correction','btn block top'):button('Back to My requests','requests','btn block top'))+'</div>',staff?'transactions-admin':'requests',staff);
  }
  function login() {
    return `<div class="shell login-shell">${brand()}${heading('Welcome to PrintFair')}
      ${card(`<div class="field"><label for="login-email">XU Email Address</label><input id="login-email" type="email" value="${cloudMode?'':escapeHTML(state.student.email)}" autocomplete="username" placeholder="example@my.xu.edu.ph"></div><div class="field"><label for="login-password">Password</label><input id="login-password" type="password" placeholder="Password" autocomplete="current-password"></div><div class="right">${button('Forgot password?','forgot-password','link')}</div>${button('Sign In','sign-in','btn block top',true)}<div class="role-options"><button type="button" class="btn secondary sm ${signInRole==='student'?'selected':''}" data-action="role-student" aria-pressed="${signInRole==='student'}">Student</button><button type="button" class="btn secondary sm ${signInRole==='admin'?'selected':''}" data-action="role-admin" aria-pressed="${signInRole==='admin'}">Staff</button></div>`,'loginbox')}
      <div class="notice blue centered login-note">For currently enrolled XU students<br>Staff accounts are issued to authorized personnel.</div>
      <p class="xs text-muted centered">${cloudMode?'Use your registered XU account. Staff access is issued by the project administrator.':'Local demo mode: sign-in does not verify a real password.'}</p>
      ${cloudMode?button('Create student account','register','btn secondary block top'):''}</div>`;
  }
  function register() {
    return `<div class="shell login-shell">${brand()}${heading('Create student account','Use your official XU email address')}
      ${card(`<div class="field"><label for="register-name">Full name</label><input id="register-name" autocomplete="name" maxlength="100"></div>
      <div class="field"><label for="register-email">XU email</label><input id="register-email" type="email" placeholder="name@my.xu.edu.ph" autocomplete="email"></div>
      <div class="field"><label for="register-year">Year level</label><select id="register-year"><option value="">Select year</option>${['1st Year','2nd Year','3rd Year','4th Year','5th Year'].map(x=>`<option>${x}</option>`).join('')}</select></div>
      <div class="field"><label for="register-program">Course / Program</label><input id="register-program" maxlength="100" placeholder="e.g. BS Information Technology"></div>
      <div class="field"><label for="register-password">Password</label><input id="register-password" type="password" autocomplete="new-password" minlength="8"></div>
      ${button('Create account','create-account','btn block top',true)}`,'loginbox')}
      ${button('Back to sign in','back-to-login','btn secondary block top')}</div>`;
  }
  function guidelines() {
    return shell(heading('Free printing guidelines','XU Library service rules')+
      card(`<div class="rules"><p>Maximum 20 pages per student each day.</p><p>First come, first served at the library.</p><p>Students supply their own bond paper.</p><p>Printing is for academic use.</p><p>The existing physical logbook is still required.</p><p>Printing hours: 8:30–11:30 AM and 1:30–4:30 PM (provided XU notice).</p><p>Temporary PDFs are removed at the end of the service day.</p></div>`) + button('Back to profile','back-to-profile','btn block top')+'</div>',state.role==='admin'?'profile-admin':'profile',state.role==='admin');
  }
  const routes = {
    login,register,dashboard,upload,review,requests,code,stations,allowance,
    profile:()=>profile(false), 'dashboard-admin':adminDashboard,'stations-admin':adminStations,
    'transactions-admin':adminTransactions,'profile-admin':()=>profile(true),guidelines
  };
  function render() {
    expirePending();
    let r=route();
    if(!state.role && !['login','register'].includes(r)) { location.hash='#login'; r='login'; }
    if (state.role === 'student' && (r.endsWith('-admin') || r.startsWith('transaction-detail/'))) { location.hash='#dashboard'; r='dashboard'; }
    if (state.role === 'admin' && ['dashboard','upload','review','requests','code','stations','allowance','profile'].includes(r)) { location.hash='#dashboard-admin'; r='dashboard-admin'; }
    const match = r.match(/^(request-detail|transaction-detail)\/(PF-[A-Z0-9]+)$/i);
    const view = match ? () => details(match[2],match[1]==='transaction-detail') : (routes[r] || dashboard);
    $('#app').innerHTML = view();
    if(r==='review') { bindRange(); renderPdfPreview(Number($('#preview-current')?.textContent)||1); }
  }
  function navigate(page) { location.hash=`#${page}`; render(); window.scrollTo(0,0); }
  function notify(text) {
    document.querySelector('.toast')?.remove();
    const el=document.createElement('div'); el.className='toast'; el.textContent=text;
    document.body.appendChild(el); setTimeout(()=>el.remove(),3600);
  }
  async function inspectPdf(file) {
    if (!file) throw new Error('Choose a PDF document first.');
    if (file.size <= 0) throw new Error('This file is empty. Choose a non-empty PDF.');
    if (file.size > 20 * 1024 * 1024) throw new Error('The PDF is larger than the 20 MB upload limit.');
    if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) throw new Error('Only PDF documents are accepted.');
    const bytes = await file.arrayBuffer();
    const head = new TextDecoder().decode(bytes.slice(0, 1024));
    if (!head.includes('%PDF-')) throw new Error('This file does not contain a valid PDF header.');
    if (!window.pdfjsLib) throw new Error('The PDF reader could not load. Check your internet connection and reload PrintFair.');
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const task = window.pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false });
      const pdf = await task.promise;
      const pages = Number(pdf.numPages);
      await pdf.destroy();
      if (!Number.isInteger(pages) || pages < 1) throw new Error('The PDF has no readable pages.');
      return { pages, bytes };
    } catch (error) {
      if (/password/i.test(error?.message || '')) throw new Error('This PDF is password-protected. Upload an unlocked copy.');
      throw new Error(`The PDF could not be read. It may be damaged or password-protected. (${error.message || 'Unknown PDF error'})`);
    }
  }

  async function renderPdfPreview(pageNumber) {
    const canvas = $('#pdf-preview-canvas');
    if (!canvas || !selectedPdfBytes || !window.pdfjsLib) return;
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const task = window.pdfjsLib.getDocument({ data: new Uint8Array(selectedPdfBytes.slice(0)), isEvalSupported: false });
      const pdf = await task.promise;
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const scale = Math.min(105 / base.width, 140 / base.height);
      const viewport = page.getViewport({ scale });
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext('2d');
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      await page.render({ canvasContext: context, viewport }).promise;
      await pdf.destroy();
    } catch (error) { console.warn('PDF page preview could not be rendered:', error); }
  }

  async function applyCloudState() {
    if (!cloudMode) return false;
    const loaded = await backend.loadState();
    if (!loaded) { state.role = null; render(); return false; }
    state.role = loaded.profile.role;
    state.student = loaded.profile;
    state.stations = loaded.stations;
    state.requests = loaded.requests;
    state.previewTime = new Date().toISOString();
    if (stopLiveUpdates) stopLiveUpdates();
    stopLiveUpdates = backend.subscribe(async () => {
      try {
        const next = await backend.loadState();
        if (!next) return;
        state.role = next.profile.role; state.student = next.profile;
        state.stations = next.stations; state.requests = next.requests;
        state.previewTime = new Date().toISOString(); render();
      } catch (error) { console.warn('PrintFair live refresh failed:', error); }
    });
    render();
    return true;
  }

  async function restoreCloudSession() {
    if (!cloudMode) return;
    try {
      const session = await backend.getSession();
      if (session?.user) await applyCloudState();
    } catch (error) { notify(`Backend connection: ${error.message}`); }
  }

  function bindRange() {
    const input=$('#page-range'); if(!input) return;
    input.addEventListener('input',()=>{
      state.draft.range=input.value; save();
      const n=validRange(input.value,state.draft.totalPages);
      $('#range-count').textContent = n===null?'Invalid range':`${n} pages selected`;
      const allowed=n!==null && n<=remainingPages() && !activeRequest();
      const note=$('#validation-notice'); note.className=`notice ${allowed?'green':'red'}`;
      note.textContent=activeRequest()?'Another request is still active.':n===null?'Enter a valid page range.':allowed?`Available: ${remainingPages()} · Requested: ${n} · Remaining: ${remainingPages()-n}`:`Only ${remainingPages()} pages are available.`;
    });
  }
  async function submitRequest() {
    if (!selectedPdfFile || !state.draft.totalPages) return notify('Choose and validate a PDF before submitting.');
    if(activeRequest()) return notify('Only one active request is allowed.');
    const n=validRange(state.draft.range,state.draft.totalPages);
    if(n===null) return notify('Enter a valid page range within the PDF.');
    if(!window.PrintFairRules.canReserve(remainingPages(),n)) return notify(`Only ${remainingPages()} pages remain available.`);
    try {
      let r;
      if (cloudMode) {
        r = await backend.createRequest(selectedPdfFile, {
          fileName: state.draft.file, totalPages: state.draft.totalPages,
          range: state.draft.range, requestedPages: n
        });
        const latest = await backend.loadState();
        if (latest) { state.student=latest.profile; state.stations=latest.stations; state.requests=latest.requests; }
      } else {
        const number=state.nextId++;
        const id=`PF-${number}`;
        await window.PrintFairFiles.put(id, selectedPdfFile);
        r=sampleRecord(id,state.draft.file,n,'Reserved',now().toISOString(),state.student,
          {code:`CN3-${String(number).padStart(4,'0')}`,pageRange:state.draft.range,totalPages:state.draft.totalPages});
        r.storageKey=id;
        state.requests.unshift(r); save();
      }
      selectedPdfFile=null; selectedPdfBytes=null;
      if(uiDraftFileUrl) { URL.revokeObjectURL(uiDraftFileUrl); uiDraftFileUrl=null; }
      state.draft={file:'No document selected',totalPages:0,range:'',isSample:false}; save();
      navigate('requests'); notify('Request created. Your selected pages have been reserved.');
    } catch (error) { notify(error.message || 'The request could not be submitted.'); }
  }
  function openModal(title,contents,actions) {
    document.querySelector('.modal-overlay')?.remove();
    const box=document.createElement('div'); box.className='modal-overlay'; box.innerHTML=`<section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}"><h2>${escapeHTML(title)}</h2>${contents}<div class="modal-actions">${actions}</div></section>`;
    document.body.appendChild(box); box.addEventListener('click',event=>{if(event.target===box)box.remove()});
  }
  const dismissModal=()=>document.querySelector('.modal-overlay')?.remove();
  function correctionModal() {
    const id=route().split('/')[1]; const r=state.requests.find(x=>x.id===id); if(!r)return;
    correctionTarget=r.id;
    openModal('Correct request record',`<p class="sm text-muted">${escapeHTML(r.file)} · ${r.pages} pages requested</p>
       <div class="field"><label for="correct-status">Request status</label><select id="correct-status">${VALID.filter(s=>permittedCorrection(r,s)).map(s=>`<option value="${s}" ${r.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
       <div class="field"><label for="correct-pages">Pages counted in allowance (0–${r.pages})</label><input id="correct-pages" type="number" min="0" max="${r.pages}" step="1" value="${r.countedPages}"></div>
       <div class="field"><label for="correct-reason">Reason for correction</label><textarea id="correct-reason" rows="2" placeholder="Describe the printing issue or correction"></textarea></div>
       <p class="xs text-muted">Retrieved pages remain counted until staff explicitly corrects the allowance.</p>
       <p id="correction-error" class="correction-error" role="alert" aria-live="assertive" hidden></p>`,
       button('Cancel','close-modal','btn secondary') + button('Save correction','save-correction','btn'));
  }
  function onAction(action) {
    switch(action) {
      case 'notifications': notify('No new notifications.'); break;
      case 'start-upload': if(activeRequest()) {notify('Resolve your active request before making another.');navigate('requests');}else navigate('upload'); break;
      case 'review': if(!selectedPdfFile || !state.draft.totalPages) { notify('Select and validate a PDF first.'); navigate('upload'); } else navigate('review'); break;
      case 'prev-preview': case 'next-preview': {
        const curr=Number($('#preview-current')?.textContent)||1;
        const next=action==='next-preview'?Math.min(state.draft.totalPages,curr+1):Math.max(1,curr-1);
        if($('#preview-current')) $('#preview-current').textContent=next;
        renderPdfPreview(next);
        break;
      }
      case 'submit': submitRequest(); break;
      case 'view-code': navigate('code'); break;
      case 'cancel-request': {
        const r=activeRequest();if(!r)return;
        openModal('Cancel print request',`<p class="sm">Cancel ${escapeHTML(r.file)}? Its ${r.pages} reserved pages will be released. The request will remain in your history.</p>`,button('Keep request','close-modal','btn secondary')+button('Cancel request','confirm-cancel','btn danger'));
        break;
      }
      case 'confirm-cancel': { const r=activeRequest(); if(r) {
        if(cloudMode) backend.cancelRequest(r.id).then(async()=>{await applyCloudState();dismissModal();render();notify('Request cancelled. Reserved pages have been released.');}).catch(error=>notify(error.message));
        else { changeStatus(r,'Cancelled','Cancelled by student before retrieval'); if(r.storageKey)window.PrintFairFiles.remove(r.storageKey).catch(()=>{}); save();dismissModal();render();notify('Request cancelled and saved to history.'); }
      } else dismissModal(); break; }
      case 'copy-code': { const code=activeRequest()?.code; if(!code)return; if(navigator.clipboard?.writeText)navigator.clipboard.writeText(code).then(()=>notify('Code copied')).catch(()=>notify(`Code: ${code}`));else notify(`Code: ${code}`);break; }
      case 'open-kiosk': window.open('kiosk.html','_blank','noopener'); break;
      case 'role-student': signInRole='student';render();break;
      case 'role-admin': signInRole='admin';render();break;
      case 'register': if(cloudMode) navigate('register'); else notify('Student registration is available after the shared backend is configured.'); break;
      case 'back-to-login': navigate('login'); break;
      case 'create-account': {
        if(!cloudMode) return notify('Student registration requires a configured shared backend.');
        const fullName=$('#register-name')?.value.trim(); const email=$('#register-email')?.value.trim();
        const year=$('#register-year')?.value; const program=$('#register-program')?.value.trim(); const password=$('#register-password')?.value;
        if(!fullName||!email||!year||!program||!password) return notify('Complete every field.');
        if(!/^[^\s@]+@my\.xu\.edu\.ph$/i.test(email)) return notify('Use your official @my.xu.edu.ph email.');
        if(password.length<8) return notify('Use a password with at least 8 characters.');
        backend.signUp({fullName,email,year,program,password}).then(result=>{notify(result.session?'Account created. You can now sign in.':'Check your XU email to confirm your account, then sign in.');navigate('login');}).catch(error=>notify(error.message));
        break;
      }
      case 'sign-in': {
        const email=$('#login-email')?.value.trim();const pass=$('#login-password')?.value;
        if(!email||!email.includes('@')||!pass) return notify('Enter an email and password to continue.');
        if (cloudMode) {
          backend.signIn(email,pass).then(async result=>{
            if(result.profile.role!==signInRole) { await backend.signOut(); throw new Error(`This account is registered as ${result.profile.role}, not ${signInRole}.`); }
            await applyCloudState(); navigate(state.role==='admin'?'dashboard-admin':'dashboard'); notify('Signed in to the shared PrintFair system.');
          }).catch(error=>notify(error.message));
        } else { state.role=signInRole;save();navigate(state.role==='admin'?'dashboard-admin':'dashboard');notify('Signed in to local demo mode.'); }
        break;
      }
      case 'logout': {
        selectedPdfFile=null; selectedPdfBytes=null; state.draft={file:'No document selected',totalPages:0,range:'',isSample:false};
        if(uiDraftFileUrl) { URL.revokeObjectURL(uiDraftFileUrl); uiDraftFileUrl=null; }
        if(cloudMode) backend.signOut().then(()=>{if(stopLiveUpdates)stopLiveUpdates();state.role=null;state.requests=[];navigate('login');}).catch(error=>notify(error.message));
        else {state.role=null;save();navigate('login');} break;
      }
      case 'forgot-password': { const email=$('#login-email')?.value.trim(); if(cloudMode&&email) backend.sendPasswordReset(email).then(()=>notify('Password reset email sent.')).catch(error=>notify(error.message)); else notify('Enter your email first. Password recovery is available after backend setup.'); break; }
      case 'guidelines': navigate('guidelines');break;
      case 'back-to-profile': navigate(state.role==='admin'?'profile-admin':'profile');break;
      case 'reset-demo': openModal('Reset sample data','<p class="sm">Restore the original sample accounts, stations, and request history?</p>',button('Keep current data','close-modal','btn secondary')+button('Reset sample data','confirm-reset','btn danger'));break;
      case 'confirm-reset': state=initialState();state.role=signInRole;save();dismissModal();navigate(state.role==='admin'?'dashboard-admin':'dashboard');notify('Sample data restored.');break;
      case 'add-station': openModal('Add printing station','<div class="field"><label for="new-station-name">Station name</label><input id="new-station-name" maxlength="60" placeholder="e.g. School of Medicine"></div><div class="field"><label for="new-station-floor">Location</label><input id="new-station-floor" maxlength="50" placeholder="e.g. 5th floor"></div>',button('Cancel','close-modal','btn secondary')+button('Add station','save-station','btn'));break;
      case 'save-station': {
        const name=$('#new-station-name')?.value.trim();const floor=$('#new-station-floor')?.value.trim();
        if(!name||!floor)return notify('Enter the station and its location.');
        const station={id:`station-${Date.now()}`,name,floor,status:'Operational',reason:'',updatedAt:now().toISOString()};
        if(cloudMode) backend.addStation(station).then(saved=>{state.stations.push(saved);dismissModal();render();notify('Station added to the shared system.');}).catch(error=>notify(error.message));
        else {state.stations.push(station);save();dismissModal();render();notify('Station added.');} break;
      }
      case 'open-correction': correctionModal();break;
      case 'save-correction': {
        const r=state.requests.find(x=>x.id===correctionTarget);if(!r)return;
        const next=$('#correct-status')?.value;const raw=$('#correct-pages')?.value;const pages=Number(raw);const reason=$('#correct-reason')?.value.trim();
        const correctionError=$('#correction-error');
        const showCorrectionError=text=>{if(correctionError){correctionError.textContent=text;correctionError.hidden=false;correctionError.scrollIntoView({block:'nearest',behavior:'smooth'});}else notify(text);};
        if(!permittedCorrection(r,next)||raw===''||!Number.isInteger(pages)||pages<0||pages>r.pages) return showCorrectionError('Enter a valid status and counted page total.');
        if(!r.retrievedAt && pages>0) return showCorrectionError('Pages cannot be counted before document retrieval.');
        if(!reason) return showCorrectionError('A correction reason is required.');
        const reservedOther=currentUserRequests().filter(x=>isToday(x)&&x.id!==r.id&&x.status==='Reserved').reduce((n,x)=>n+x.pages,0);
        const usedOther=currentUserRequests().filter(x=>isToday(x)&&x.id!==r.id).reduce((n,x)=>n+(x.countedPages||0),0);
        if(r.email===state.student.email&&isToday(r)&&usedOther+reservedOther+pages+(next==='Reserved'?r.pages:0)>LIMIT) return showCorrectionError('Correction would exceed the recorded daily allowance.');
        if(cloudMode) {
          backend.correctRequest(r.id,next,pages,reason).then(async()=>{await applyCloudState();dismissModal();render();notify('Correction saved to the shared request history.');}).catch(error=>showCorrectionError(error.message));
        } else {
          changeStatus(r,next,reason);r.countedPages=pages;
          state.corrections.push({id:r.id,status:next,previousStatus:r.history.at(-2)?.status||next,countedPages:pages,reason,at:now().toISOString()});
          save();dismissModal();render();notify('Correction saved to the request history.');
        } break;
      }
      case 'close-modal': dismissModal();break;
      default: if(routes[action]) navigate(action);
    }
  }

  document.addEventListener('click',event=>{
    const navEl=event.target.closest('[data-route]');
    if(navEl) {event.preventDefault();navigate(navEl.dataset.route);return;}
    const actionEl=event.target.closest('[data-action]');
    if(actionEl) {event.preventDefault();onAction(actionEl.dataset.action);}
  });
  document.addEventListener('change',event=>{
    const input=event.target;
    if(input.id==='pdf-file') {
      const file=input.files?.[0]; if(!file)return;
      selectedPdfFile=null; selectedPdfBytes=null;
      if(uiDraftFileUrl) { URL.revokeObjectURL(uiDraftFileUrl); uiDraftFileUrl=null; }
      inspectPdf(file).then(parsed=>{
        selectedPdfFile=file; selectedPdfBytes=parsed.bytes;
        uiDraftFileUrl=URL.createObjectURL(file);
        state.draft={file:file.name,totalPages:parsed.pages,range:`1-${Math.min(8,parsed.pages)}`,isSample:false};
        save();render();notify(`PDF validated: ${parsed.pages} actual pages detected.`);
      }).catch(error=>{selectedPdfFile=null;selectedPdfBytes=null;state.draft={file:'No document selected',totalPages:0,range:'',isSample:false};render();notify(error.message);});
    }
    if(input.matches('[data-station]')) {
      if(state.role!=='admin')return;
      const station=state.stations.find(s=>s.id===input.dataset.station);
      if(station){const reason=input.value==='Operational'?'':input.value==='Unavailable'?'Printer issue reported':'Under maintenance';
        if(cloudMode) backend.updateStation(station.id,input.value,reason).then(updated=>{Object.assign(station,updated);render();notify('Station status updated for all connected users.');}).catch(error=>{render();notify(error.message);});
        else {station.status=input.value;station.reason=reason;station.updatedAt=now().toISOString();save();render();notify('Station status updated.');}}
    }
  });
  document.addEventListener('input',event=>{
    if(event.target.id==='transaction-search') {
      const query=event.target.value.trim().toLowerCase();
      document.querySelectorAll('#transaction-list .record-button').forEach(el=>{
        el.hidden=!el.textContent.toLowerCase().includes(query);
      });
    }
  });
  window.addEventListener('hashchange',render);
  window.addEventListener('storage',event=>{
    if(!cloudMode && event.key===STORE_KEY&&event.newValue) {try{state=migrate(JSON.parse(event.newValue));render()}catch(e){console.warn('Could not load the demo update',e);}}
  });
  window.PrintFairDemo = {
    getState:()=>structuredClone(state),
    reset:()=>{state=initialState();save();render();},
    changeStatus:(id,next,reason='Demonstration status change')=>{
      const r=state.requests.find(x=>x.id===id);if(!r||!VALID.includes(next))return false;
      changeStatus(r,next,reason);save();render();return true;
    },
    expireActive:()=>{const r=activeRequest();if(!r)return false;changeStatus(r,'Expired','Demonstrated code expiry');save();render();return true;},
    setTime:iso=>{if(!Number.isFinite(new Date(iso).getTime()))return false;state.previewTime=iso;expirePending();save();render();return true;}
  };
  if (cloudMode) state.role=null;
  else save();
  render();
  restoreCloudSession();
})();
