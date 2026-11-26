/* shared backend adapter. cloud mode is enabled only when real project credentials are configured. */
(() => {
  'use strict';
  const config = window.PRINTFAIR_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/.test(config.SUPABASE_URL || '') &&
    config.SUPABASE_ANON_KEY && !String(config.SUPABASE_ANON_KEY).includes('YOUR_');
  const supaLib = window.supabase;
  const client = configured && supaLib?.createClient
    ? supaLib.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
      }) : null;
  const bucket = config.STORAGE_BUCKET || 'print-documents';

  const fail = (error, fallback) => { if (error) throw new Error(error.message || fallback || 'Backend request failed.'); };
  const mapStation = row => ({
    id: row.id, name: row.name, floor: row.floor, status: row.status,
    reason: row.status_reason || '', updatedAt: row.updated_at
  });
  const mapRequest = row => ({
    id: row.id, file: row.file_name, pages: Number(row.requested_pages), totalPages: Number(row.total_pages),
    pageRange: row.page_range, status: row.status, code: row.retrieval_code || null,
    student: row.student_name, email: row.student_email, year: row.student_year || '',
    program: row.student_program || '', createdAt: row.created_at, retrievedAt: row.retrieved_at,
    stationId: row.station_id, countedPages: Number(row.counted_pages || 0), reason: row.reason || '',
    history: Array.isArray(row.history) ? row.history : [], storagePath: row.storage_path,
    expiresAt: row.expires_at, failedAfterRetrieval: false
  });
  async function getSession() {
    if (!configured) return null;
    if (!client) throw new Error('Supabase is configured, but its browser SDK did not load. Check the internet connection and reload.');
    const { data, error } = await client.auth.getSession(); fail(error);
    return data.session;
  }
  async function getProfile(userId) {
    const { data, error } = await client.from('profiles').select('*').eq('id', userId).single();
    fail(error, 'Your account profile is not configured. Ask the project administrator.');
    return { id: data.id, name: data.full_name, display: data.display_name || data.full_name,
      email: data.email, year: data.year_level || '', program: data.program || '', role: data.role };
  }
  async function signIn(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email, password }); fail(error);
    try {
      const profile = await getProfile(data.user.id);
      return { user: data.user, profile };
    } catch (error) {
      await client.auth.signOut();
      throw error;
    }
  }
  async function signUp(payload) {
    const { data, error } = await client.auth.signUp({ email: payload.email, password: payload.password, options: {
      data: { full_name: payload.fullName, display_name: payload.fullName, year_level: payload.year, program: payload.program }
    } });
    fail(error); return data;
  }
  async function signOut() {
    if (!client) return;
    const { error } = await client.auth.signOut(); fail(error);
  }
  async function sendPasswordReset(email) {
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    fail(error);
  }
  async function loadState() {
    const session = await getSession();
    if (!session?.user) return null;
    const expiry = await client.rpc('expire_own_print_requests'); fail(expiry.error);
    const profile = await getProfile(session.user.id);
    const [stationResult, requestResult] = await Promise.all([
      client.from('stations').select('*').order('name'),
      client.from('print_requests').select('*').order('created_at', { ascending: false })
    ]);
    fail(stationResult.error); fail(requestResult.error);
    return { profile, stations: (stationResult.data || []).map(mapStation), requests: (requestResult.data || []).map(mapRequest) };
  }
  async function createRequest(file, draft) {
    const session = await getSession();
    if (!session?.user) throw new Error('Your session expired. Sign in again.');
    const requestKey = crypto.randomUUID();
    const storagePath = `${session.user.id}/${requestKey}.pdf`;
    const upload = await client.storage.from(bucket).upload(storagePath, file, {
      contentType: 'application/pdf', upsert: false, cacheControl: '0'
    });
    fail(upload.error, 'The PDF could not be uploaded.');
    const result = await client.rpc('create_print_request', {
      p_file_name: draft.fileName,
      p_storage_path: storagePath,
      p_total_pages: draft.totalPages,
      p_page_range: draft.range,
      p_requested_pages: draft.requestedPages
    });
    if (result.error) {
      await client.storage.from(bucket).remove([storagePath]);
      fail(result.error);
    }
    return mapRequest(result.data);
  }
  async function cancelRequest(id) {
    const { data, error } = await client.rpc('cancel_print_request', { p_request_id: id });
    fail(error);
    if (data?.storage_path) {
      const removed = await client.storage.from(bucket).remove([data.storage_path]);
      if (removed.error) console.warn('Request cancelled, but the stored PDF could not yet be removed:', removed.error.message);
    }
    return mapRequest(data);
  }
  async function loadStations() {
    const { data, error } = await client.from('stations').select('*').order('name');
    fail(error); return (data || []).map(mapStation);
  }
  async function updateStation(id, status, reason) {
    const { data, error } = await client.from('stations').update({
      status, status_reason: reason || null, updated_at: new Date().toISOString()
    }).eq('id', id).select('*').single();
    fail(error); return mapStation(data);
  }
  async function addStation(station) {
    const { data, error } = await client.from('stations').insert({
      id: station.id, name: station.name, floor: station.floor, status: 'Operational'
    }).select('*').single();
    fail(error); return mapStation(data);
  }
  async function correctRequest(id, status, countedPages, reason) {
    const { data, error } = await client.rpc('correct_print_request', {
      p_request_id: id, p_status: status, p_counted_pages: countedPages, p_reason: reason
    });
    fail(error); return mapRequest(data);
  }
  async function claimCode(code, stationId) {
    const { data, error } = await client.rpc('claim_print_request', {
      p_code: code, p_station_id: stationId
    });
    fail(error); return mapRequest(data);
  }
  async function signedPdfUrl(path) {
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 90);
    fail(error, 'The PDF could not be opened.'); return data.signedUrl;
  }
  function subscribe(onChange) {
    if (!client) return () => {};
    const channel = client.channel('printfair-live-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'print_requests' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stations' }, onChange)
      .subscribe();
    return () => client.removeChannel(channel);
  }
  window.PrintFairBackend = Object.freeze({
    isConfigured: () => Boolean(configured), getSession, getProfile, signIn, signUp, signOut,
    sendPasswordReset, loadState, loadStations, createRequest, cancelRequest, updateStation,
    addStation, correctRequest, claimCode, signedPdfUrl, subscribe
  });
})();
