/* Library PC retrieval. Cloud mode uses authenticated staff + one-time database RPCs. */
(() => {
  'use strict';
  const KEY = 'printfair-m3-prototype-2026';
  const backend = window.PrintFairBackend;
  const cloudMode = Boolean(backend?.isConfigured());
  const input = document.querySelector('#k-code');
  const message = document.querySelector('#message');
  const result = document.querySelector('#result');
  const authPanel = document.querySelector('#staff-auth');
  const retrievePanel = document.querySelector('#retrieve-panel');
  const staffMessage = document.querySelector('#staff-message');
  const staffLogout = document.querySelector('#staff-logout');
  const openPdf = document.querySelector('#open-pdf');
  let staffProfile = null;
  let currentObjectUrl = null;

  function populateStations(stations) {
    const select = document.querySelector('#station-id');
    if (!select || !Array.isArray(stations)) return;
    const previous = select.value;
    select.replaceChildren();
    stations.forEach(station => {
      const option = document.createElement('option');
      option.value = station.id;
      option.textContent = `${station.name} · ${station.floor}${station.status === 'Operational' ? '' : ` (${station.status})`}`;
      option.disabled = station.status !== 'Operational';
      select.appendChild(option);
    });
    if ([...select.options].some(option => option.value === previous && !option.disabled)) select.value = previous;
  }

  const show = (text, kind='error') => { message.textContent = text; message.className = kind; };
  const showStaff = (text, kind='error') => { staffMessage.textContent = text; staffMessage.className = kind; };
  const getState = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
  const clean = () => {
    result.hidden = true; openPdf.hidden = true; input.value = ''; message.textContent = ''; message.className = '';
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    input.focus();
  };

  async function checkStaffSession() {
    if (!cloudMode) {
      authPanel.hidden = true; retrievePanel.hidden = false;
      staffLogout.hidden = true;
      const localState = getState(); if (localState?.stations) populateStations(localState.stations);
      // Keep local-demo operation available without displaying the obsolete demo warning.
      document.querySelector('#kiosk-mode-note').hidden = true;
      message.textContent = ''; message.className = ''; 
      return;
    }
    authPanel.hidden = false; retrievePanel.hidden = true; staffLogout.hidden = true;
    const session = await backend.getSession();
    if (!session?.user) { staffProfile = null; return; }
    staffProfile = await backend.getProfile(session.user.id);
    if (staffProfile.role !== 'admin') {
      await backend.signOut(); staffProfile = null;
      showStaff('This account is not authorized for library PC retrieval.');
      return;
    }
    const stations = await backend.loadStations(); populateStations(stations);
    authPanel.hidden = true; retrievePanel.hidden = false; staffLogout.hidden = false;
    document.querySelector('#kiosk-mode-note').textContent = 'Shared backend connected. A successful retrieval does not verify physical printing.';
    show(`Signed in as ${staffProfile.display || staffProfile.name}. Select an operational station and enter the student code.`, 'info');
  }

  async function staffLogin() {
    const email = document.querySelector('#staff-email').value.trim();
    const password = document.querySelector('#staff-password').value;
    if (!email || !password) return showStaff('Enter your staff email and password.');
    try {
      const result = await backend.signIn(email, password);
      if (result.profile.role !== 'admin') {
        await backend.signOut();
        throw new Error('This account is not authorized for library PC retrieval.');
      }
      staffProfile = result.profile;
      await checkStaffSession();
      showStaff('Staff sign-in successful.', 'success');
    } catch (error) { showStaff(error.message || 'Staff sign-in failed.'); }
  }

  async function createRequestedPagesPdf(sourceBlob, record) {
    if (!window.PDFLib?.PDFDocument) throw new Error('The PDF page processor could not load. Check the internet connection and reload the kiosk.');
    const totalPages = Number(record.totalPages);
    const pages = window.PrintFairRules?.expandPageRange(record.pageRange, totalPages);
    if (!pages || pages.length !== Number(record.pages)) throw new Error('The saved page range is invalid or does not match the requested page count. Contact library staff.');
    const source = await window.PDFLib.PDFDocument.load(await sourceBlob.arrayBuffer(), { ignoreEncryption: false });
    if (source.getPageCount() !== totalPages) throw new Error(`The stored PDF has ${source.getPageCount()} pages, but the request recorded ${totalPages}. The document was not prepared.`);
    const output = await window.PDFLib.PDFDocument.create();
    const copied = await output.copyPages(source, pages.map(page => page - 1));
    copied.forEach(page => output.addPage(page));
    const bytes = await output.save();
    return new Blob([bytes], { type: 'application/pdf' });
  }

  async function localRetrieve(code) {
    const state = getState();
    if (!state) throw new Error('No local demo data found. Open the student app in this browser first.');
    const record = state.requests?.find(x => String(x.code || '').toUpperCase() === code);
    if (!record) throw new Error('Code not found. Check the code in My Requests.');
    if (record.status !== 'Reserved') throw new Error(`This request is ${String(record.status).toLowerCase()}; its code is no longer valid.`);
    const time = state.previewTime || new Date().toISOString();
    const expiresAt = record.expiresAt || `${String(record.createdAt).slice(0,10)}T16:30:00+08:00`;
    if (new Date(expiresAt).getTime() <= new Date(time).getTime()) {
      record.status = 'Expired'; record.reason = 'Unused retrieval code expired'; record.countedPages = 0;
      record.history ||= []; record.history.push({ status:'Expired', at:time, reason:record.reason });
      localStorage.setItem(KEY, JSON.stringify(state));
      throw new Error('This retrieval code has expired. The request remains in history.');
    }
    const stationId = document.querySelector('#station-id').value;
    const station = state.stations?.find(x => x.id === stationId);
    if (station && station.status !== 'Operational') throw new Error('The selected station is not operational. Choose another station.');
    let blob = record.storageKey ? await window.PrintFairFiles.get(record.storageKey) : null;
    let demoSample = false;
    if (!blob && !record.storageKey) {
      blob = await fetch('assets/Sample_Research_Paper.pdf').then(response => {
        if (!response.ok) throw new Error('The sample document is unavailable.');
        return response.blob();
      });
      demoSample = true;
    }
    if (!blob) throw new Error('The PDF file could not be found. The request was not marked as retrieved. Upload the document again in this browser.');
    blob = await createRequestedPagesPdf(blob, record);
    record.status = 'Retrieved'; record.retrievedAt = time; record.countedPages = record.pages;
    record.stationId = stationId; record.reason = 'Document retrieved from the local kiosk demo';
    record.history ||= []; record.history.push({ status:'Retrieved', at:time, reason:record.reason });
    localStorage.setItem(KEY, JSON.stringify(state));
    return { record, url: URL.createObjectURL(blob), demoSample };
  }

  async function retrieve() {
    result.hidden = true; openPdf.hidden = true;
    const code = input.value.trim().toUpperCase();
    if (!code) return show('Enter the code from the student request.');
    try {
      let record, url, demoSample = false;
      if (cloudMode) {
        if (staffProfile?.role !== 'admin') throw new Error('Authorized library staff sign-in is required.');
        record = await backend.claimCode(code, document.querySelector('#station-id').value);
        if (record.status === 'Expired') throw new Error('This retrieval code has expired. The request remains in history.');
        if (record.status !== 'Retrieved') throw new Error('The retrieval could not be completed.');
        const sourceUrl = await backend.signedPdfUrl(record.storagePath);
        const response = await fetch(sourceUrl);
        if (!response.ok) throw new Error('The stored PDF could not be downloaded. The request was retrieved, but the file is unavailable.');
        const preparedBlob = await createRequestedPagesPdf(await response.blob(), record);
        url = URL.createObjectURL(preparedBlob);
        currentObjectUrl = url;
      } else {
        const result = await localRetrieve(code);
        record = result.record; url = result.url; demoSample = result.demoSample;
        currentObjectUrl = url;
      }
      document.querySelector('#filename').textContent = record.file;
      document.querySelector('#details').textContent = `${record.pages} selected pages · Original pages ${record.pageRange} · Retrieved`; 
      openPdf.href = url;
      openPdf.textContent = demoSample ? 'Open selected sample pages' : 'Open prepared PDF';
      openPdf.hidden = false;
      result.hidden = false;
      show(cloudMode ? 'Code accepted. The private PDF is ready to open on this library PC.' : 'Code accepted. Retrieval was recorded in this browser demo.', 'success');
    } catch (error) {
      show(error.message || 'The retrieval could not be completed.');
    }
  }

  document.querySelector('#retrieve').addEventListener('click', retrieve);
  input.addEventListener('keydown', event => { if (event.key === 'Enter') retrieve(); });
  document.querySelector('#reset').addEventListener('click', clean);
  document.querySelector('#staff-login')?.addEventListener('click', staffLogin);
  document.querySelector('#staff-password')?.addEventListener('keydown', event => { if (event.key === 'Enter') staffLogin(); });
  staffLogout?.addEventListener('click', async () => {
    try { await backend.signOut(); staffProfile = null; clean(); await checkStaffSession(); }
    catch (error) { show(error.message); }
  });
  checkStaffSession().catch(error => showStaff(error.message || 'Could not verify staff session.'));
})();
