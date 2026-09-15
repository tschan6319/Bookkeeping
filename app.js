const SUPABASE_URL = 'https://Plqelsrzhcboeejgxnui.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_QLJgsmp_pm7ANwo05GEE6A_tnE-3In4';
const STORE_KEY = 'family-ledger-v1';
const ACCOUNT_STORE_KEY = 'family-ledger-accounts-v1';
const FOREIGN_ACCOUNT_STORE_KEY = 'family-ledger-foreign-accounts-v1';
const UTILITY_PROFILE_KEY = 'family-ledger-utility-profiles-v1';
const RECURRING_STORE_KEY = 'family-ledger-recurring-v1';
const SUPABASE_CACHE_OWNER_KEY = 'family-ledger-supabase-cache-owner-v1';
const SUPABASE_JS_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
let supabaseClient = null;
let signedInUser = null;
let cloudSyncReady = false;
let initializedUserId = '';
let cloudRefreshBusy = false;
const cloudPushTimers = new Map();
const cloudSyncLocks = new Set();
const dirtyCloudCollections = new Set();
const knownCloudIds = new Map();
let initialLocalUploadAllowed = true;
const expenseCategories = ['飲食', '交通', '居家', '房貸', '水電瓦斯', '網路費', '電話費', '教育', '醫療', '娛樂', '購物', '保險', '其他'];
const incomeCategories = ['薪資', '獎金', '房租', '房貸收入', '投資', '兼職', '補助', '其他收入'];
const rentalProperties = ['148號', '41號', '台南房子', '高雄房子', '新市房子'];
const mortgageProperties = ['台南房子', '高雄房子', '新化房子'];
const defaultUtilityProfiles = [
  { id: 'electric-1', type: 'electric', name: '電費 1F', user: '', detail: '' }, { id: 'electric-2', type: 'electric', name: '電費 2F', user: '', detail: '' }, { id: 'electric-3', type: 'electric', name: '電費 3F', user: '', detail: '' },
  { id: 'internet-1', type: 'internet', name: '家庭網路', user: '', detail: '' }, { id: 'mobile-1', type: 'mobile', name: '手機 1', user: '', detail: '' }, { id: 'mobile-2', type: 'mobile', name: '手機 2', user: '', detail: '' }, { id: 'mobile-3', type: 'mobile', name: '手機 3', user: '', detail: '' }, { id: 'mobile-4', type: 'mobile', name: '手機 4', user: '', detail: '' }, { id: 'mobile-5', type: 'mobile', name: '手機 5', user: '', detail: '' }, { id: 'landline-1', type: 'landline', name: '家用電話', user: '', detail: '' }
];
let records = loadRecords();
let accounts = loadAccounts();
let foreignAccounts = loadForeignAccounts();
let utilityProfiles = loadUtilityProfiles();
let recurringSettings = loadRecurringSettings();

const $ = id => document.getElementById(id);
const els = { month: $('monthFilter'), type: $('typeFilter'), quick: $('quickFilter'), search: $('searchInput'), body: $('recordBody'), empty: $('emptyState'), dialog: $('entryDialog'), form: $('entryForm'), category: $('entryCategory'), property: $('entryProperty'), propertyWrap: $('entryPropertyWrap'), payment: $('entryPayment'), cardName: $('entryCardName'), cardWrap: $('cardNameWrap') };

function localDateValue(date = new Date()) {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function loadRecords() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || [] } catch { return [] } }
function saveRecords() { saveLocalCollection('records', records) }
function loadAccounts() { try { return JSON.parse(localStorage.getItem(ACCOUNT_STORE_KEY)) || [] } catch { return [] } }
function saveAccounts() { saveLocalCollection('accounts', accounts) }
function loadForeignAccounts() { try { return JSON.parse(localStorage.getItem(FOREIGN_ACCOUNT_STORE_KEY)) || [] } catch { return [] } }
function saveForeignAccounts() { saveLocalCollection('foreignAccounts', foreignAccounts) }
function loadUtilityProfiles() { try { const saved = JSON.parse(localStorage.getItem(UTILITY_PROFILE_KEY)); if (!Array.isArray(saved)) return defaultUtilityProfiles.map(p => ({ ...p })); const oldNames = { 'electric-1': '電錶 1', 'electric-2': '電錶 2', 'electric-3': '電錶 3' }; const newNames = { 'electric-1': '電費 1F', 'electric-2': '電費 2F', 'electric-3': '電費 3F' }; return saved.map(p => oldNames[p.id] === p.name ? { ...p, name: newNames[p.id] } : p) } catch { return defaultUtilityProfiles.map(p => ({ ...p })) } }
function saveUtilityProfiles() { saveLocalCollection('utilityProfiles', utilityProfiles) }
function loadRecurringSettings() { try { return JSON.parse(localStorage.getItem(RECURRING_STORE_KEY)) || [] } catch { return [] } }
function saveRecurringSettings() { localStorage.setItem(RECURRING_STORE_KEY, JSON.stringify(recurringSettings)) }

const CLOUD_COLLECTIONS = Object.freeze({
  records: { table: 'records', storageKey: STORE_KEY, get: () => records, set: value => { records = value } },
  accounts: { table: 'accounts', storageKey: ACCOUNT_STORE_KEY, get: () => accounts, set: value => { accounts = value } },
  foreignAccounts: { table: 'foreign_accounts', storageKey: FOREIGN_ACCOUNT_STORE_KEY, get: () => foreignAccounts, set: value => { foreignAccounts = value } },
  utilityProfiles: { table: 'utility_profiles', storageKey: UTILITY_PROFILE_KEY, get: () => utilityProfiles, set: value => { utilityProfiles = value } }
});
migratePropertyNames();

function saveLocalCollection(type, value) {
  const collection = CLOUD_COLLECTIONS[type];
  localStorage.setItem(collection.storageKey, JSON.stringify(value));
  if (cloudSyncReady && signedInUser) { dirtyCloudCollections.add(type); scheduleCloudPush(type) }
}
function supabaseSyncConfigured() {
  return /^https:\/\/.+\.supabase\.co\/?$/i.test(SUPABASE_URL) && SUPABASE_PUBLISHABLE_KEY && SUPABASE_PUBLISHABLE_KEY !== '請貼上你的 Publishable key';
}
function loadSupabaseJs() {
  if (window.supabase?.createClient) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = SUPABASE_JS_CDN; script.async = true;
    script.onload = resolve; script.onerror = () => reject(new Error('Supabase JS v2 CDN 載入失敗'));
    document.head.appendChild(script);
  });
}
function camelToSnake(key) { return key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`) }
function snakeToCamel(key) { return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()) }
function toSupabaseRow(item, userId) {
  const row = {}; Object.entries(item).forEach(([key, value]) => { if (value !== undefined) row[camelToSnake(key)] = value }); row.user_id = userId; return row;
}
function fromSupabaseRow(row) {
  const item = {}; Object.entries(row).forEach(([key, value]) => { if (!['user_id', 'updated_at'].includes(key)) item[snakeToCamel(key)] = value }); return item;
}
function scheduleCloudPush(type, delay = 700) {
  clearTimeout(cloudPushTimers.get(type));
  cloudPushTimers.set(type, setTimeout(() => { cloudPushTimers.delete(type); syncCollectionToSupabase(type) }, delay));
}
async function syncCollectionToSupabase(type) {
  if (!cloudSyncReady || !signedInUser || !navigator.onLine || cloudSyncLocks.has(type)) return;
  const collection = CLOUD_COLLECTIONS[type], current = collection.get(), currentIds = new Set(current.map(item => String(item.id)));
  cloudSyncLocks.add(type); dirtyCloudCollections.delete(type);
  try {
    if (current.length) { const { error } = await supabaseClient.from(collection.table).upsert(current.map(item => toSupabaseRow(item, signedInUser.id))); if (error) throw error }
    const deletedIds = [...(knownCloudIds.get(type) || new Set())].filter(id => !currentIds.has(id));
    if (deletedIds.length) { const { error } = await supabaseClient.from(collection.table).delete().eq('user_id', signedInUser.id).in('id', deletedIds); if (error) throw error }
    knownCloudIds.set(type, currentIds);
  } catch (error) { dirtyCloudCollections.add(type); console.warn(`[Supabase sync] ${collection.table} 同步失敗，資料仍保留在本機。`, error) }
  finally { cloudSyncLocks.delete(type); if (dirtyCloudCollections.has(type) && navigator.onLine) scheduleCloudPush(type, 1500) }
}
function renderSyncedData() {
  render(); renderAccounts(); renderForeignAccounts(); renderUtilityProfiles();
}
async function loadInitialCollection(type) {
  const collection = CLOUD_COLLECTIONS[type], local = collection.get();
  const { data, error } = await supabaseClient.from(collection.table).select('*').eq('user_id', signedInUser.id);
  if (error) throw error;
  if (data.length) {
    const cloud = data.map(fromSupabaseRow); collection.set(cloud); localStorage.setItem(collection.storageKey, JSON.stringify(cloud)); knownCloudIds.set(type, new Set(cloud.map(item => String(item.id)))); return;
  }
  const seedRows = initialLocalUploadAllowed ? local : (type === 'utilityProfiles' ? defaultUtilityProfiles.map(profile => ({ ...profile })) : []);
  const shouldSeed = seedRows.length && (localStorage.getItem(collection.storageKey) !== null || type === 'utilityProfiles');
  if (shouldSeed) {
    const { error: uploadError } = await supabaseClient.from(collection.table).upsert(seedRows.map(item => toSupabaseRow(item, signedInUser.id))); if (uploadError) throw uploadError;
    collection.set(seedRows); localStorage.setItem(collection.storageKey, JSON.stringify(seedRows)); knownCloudIds.set(type, new Set(seedRows.map(item => String(item.id)))); return;
  }
  collection.set([]); localStorage.setItem(collection.storageKey, '[]');
  knownCloudIds.set(type, new Set());
}
async function initializeUserSync(user) {
  if (!user || initializedUserId === user.id) return;
  const cacheOwner = localStorage.getItem(SUPABASE_CACHE_OWNER_KEY); initialLocalUploadAllowed = !cacheOwner || cacheOwner === user.id;
  signedInUser = user; cloudSyncReady = false; initializedUserId = user.id; setAuthMessage('登入成功，正在同步資料…');
  try {
    await Promise.all(Object.keys(CLOUD_COLLECTIONS).map(loadInitialCollection)); localStorage.setItem(SUPABASE_CACHE_OWNER_KEY, user.id); cloudSyncReady = true; hideAuthDialog(); updateAuthButton(); renderSyncedData();
  } catch (error) { initializedUserId = ''; setAuthMessage(`同步失敗：${error.message}`, true); console.error('[Supabase sync] 初始同步失敗', error) }
}
async function refreshCollectionsFromSupabase() {
  if (!cloudSyncReady || !signedInUser || !navigator.onLine || cloudRefreshBusy) return;
  cloudRefreshBusy = true;
  try {
    await Promise.all([...dirtyCloudCollections].map(syncCollectionToSupabase));
    let changed = false;
    for (const [type, collection] of Object.entries(CLOUD_COLLECTIONS)) {
      if (dirtyCloudCollections.has(type) || cloudSyncLocks.has(type)) continue;
      const { data, error } = await supabaseClient.from(collection.table).select('*').eq('user_id', signedInUser.id); if (error) throw error;
      const cloud = data.map(fromSupabaseRow); collection.set(cloud); localStorage.setItem(collection.storageKey, JSON.stringify(cloud)); knownCloudIds.set(type, new Set(cloud.map(item => String(item.id)))); changed = true;
    }
    if (changed) renderSyncedData();
  } catch (error) { console.warn('[Supabase sync] 雲端重新整理失敗，繼續使用本機快取。', error) }
  finally { cloudRefreshBusy = false }
}
function createAuthUi() {
  if (document.getElementById('supabaseAuthDialog')) return;
  const dialog = document.createElement('dialog'); dialog.id = 'supabaseAuthDialog'; dialog.style.cssText = 'border:0;border-radius:20px;padding:0;max-width:390px;width:calc(100% - 32px);box-shadow:0 24px 80px rgba(15,23,42,.3)';
  dialog.innerHTML = `<form id="supabaseAuthForm" style="padding:28px;display:grid;gap:16px"><div><h2 style="margin:0 0 8px">家庭記帳登入</h2><p style="margin:0;color:#64748b">登入後會將本機資料與 Supabase 同步。</p></div><label style="display:grid;gap:6px">Email<input id="supabaseEmail" type="email" autocomplete="username" required style="padding:12px;border:1px solid #cbd5e1;border-radius:10px"></label><label style="display:grid;gap:6px">Password<input id="supabasePassword" type="password" autocomplete="current-password" required style="padding:12px;border:1px solid #cbd5e1;border-radius:10px"></label><p id="supabaseAuthMessage" role="status" style="min-height:20px;margin:0;color:#64748b"></p><button type="submit" style="border:0;border-radius:10px;padding:12px;background:#2563eb;color:white;font-weight:700;cursor:pointer">登入並同步</button></form>`;
  dialog.addEventListener('cancel', event => event.preventDefault()); document.body.appendChild(dialog);
  $('supabaseAuthForm').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true; setAuthMessage('登入中…');
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email: $('supabaseEmail').value.trim(), password: $('supabasePassword').value });
    button.disabled = false; if (error) { setAuthMessage(`登入失敗：${error.message}`, true); return } await initializeUserSync(data.user);
  });
  const authButton = document.createElement('button'); authButton.id = 'supabaseAuthButton'; authButton.type = 'button'; authButton.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:20;border:0;border-radius:999px;padding:10px 14px;background:#0f172a;color:white;box-shadow:0 8px 24px rgba(15,23,42,.22);cursor:pointer';
  authButton.addEventListener('click', async () => { if (signedInUser) await supabaseClient.auth.signOut(); else showAuthDialog() }); document.body.appendChild(authButton); updateAuthButton();
}
function setAuthMessage(message, isError = false) { const element = $('supabaseAuthMessage'); if (element) { element.textContent = message; element.style.color = isError ? '#dc2626' : '#64748b' } }
function showAuthDialog(message = '') { setAuthMessage(message); const dialog = $('supabaseAuthDialog'); if (dialog && !dialog.open) dialog.showModal() }
function hideAuthDialog() { const dialog = $('supabaseAuthDialog'); if (dialog?.open) dialog.close() }
function updateAuthButton() { const button = $('supabaseAuthButton'); if (button) button.textContent = signedInUser ? 'Supabase 登出' : 'Supabase 登入' }
function handleSignedOut() {
  signedInUser = null; cloudSyncReady = false; initializedUserId = ''; cloudSyncLocks.clear(); dirtyCloudCollections.clear(); knownCloudIds.clear(); updateAuthButton(); showAuthDialog('請使用 Email 與 Password 登入。');
}
async function startSupabaseSync() {
  if (!supabaseSyncConfigured()) { console.info('[Supabase sync] 尚未填入 Project URL 與 Publishable key，目前僅使用 localStorage。'); return }
  createAuthUi();
  try { await loadSupabaseJs() } catch (error) { setAuthMessage(error.message, true); showAuthDialog(); return }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  supabaseClient.auth.onAuthStateChange((event, session) => setTimeout(() => {
    if (event === 'SIGNED_OUT' || !session?.user) handleSignedOut(); else initializeUserSync(session.user);
  }, 0));
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) { setAuthMessage(error.message, true); showAuthDialog(); return }
  if (data.session?.user) await initializeUserSync(data.session.user); else handleSignedOut();
  window.addEventListener('online', () => refreshCollectionsFromSupabase());
  window.addEventListener('focus', () => refreshCollectionsFromSupabase());
  setInterval(() => refreshCollectionsFromSupabase(), 60000);
}
function migratePropertyNames() {
  let recordsChanged = false, settingsChanged = false; records = records.map(r => { if (r.property === '新化秀子') { recordsChanged = true; return { ...r, property: '新市房子' } } return r }); recurringSettings = recurringSettings.map(s => { if (s.property === '新化秀子') { settingsChanged = true; return { ...s, property: '新市房子' } } return s }); if (recordsChanged) saveRecords(); if (settingsChanged) saveRecurringSettings();
}
function money(n) { return `NT$ ${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(n) || 0)}` }
function foreignMoney(n, currency) { return new Intl.NumberFormat('zh-TW', { style: 'currency', currency, maximumFractionDigits: currency === 'JPY' ? 0 : 2 }).format(n) }
function esc(v = '') { return String(v).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])) }
function filteredRecords() {
  const q = els.search.value.trim().toLowerCase();
  return records.filter(r => {
    const quickOk = els.quick.value === 'all' || (els.quick.value === 'expense' && r.type === 'expense') || (els.quick.value === 'credit' && r.type === 'expense' && r.payment === '信用卡') || (els.quick.value === 'income' && r.type === 'income') || (els.quick.value === 'mortgage' && r.type === 'expense' && r.category === '房貸');
    return (!els.month.value || r.date.startsWith(els.month.value)) && (els.type.value === 'all' || r.type === els.type) && quickOk && (!q || [r.category, r.property, r.member, r.note, r.payment, r.cardName].some(v => (v || '').toLowerCase().includes(q)));
  }).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}
function detailRecords() {
  const selected = $('recordTypeFilter').value;
  return records.filter(r => (!els.month.value || (r.date || '').startsWith(els.month.value)) && (selected === 'all' || r.type === selected)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}
function render() {
  syncRecurringRecords();
  const monthRecords = records.filter(r => !els.month.value || r.date.startsWith(els.month.value));
  const selectedType = els.type.value, summaryRecords = selectedType === 'all' ? monthRecords : monthRecords.filter(r => r.type === selectedType);
  const list = filteredRecords(), details = detailRecords(), income = summaryRecords.filter(r => r.type === 'income'), expense = summaryRecords.filter(r => r.type === 'expense');
  const incomeTotal = income.reduce((s, r) => s + r.amount, 0), expenseTotal = expense.reduce((s, r) => s + r.amount, 0);
  const creditTotal = summaryRecords.filter(r => r.type === 'expense' && r.payment === '信用卡').reduce((s, r) => s + r.amount, 0);
  const balance = incomeTotal - expenseTotal;
  const mortgageTotal = summaryRecords.filter(r => r.type === 'expense' && r.category === '房貸').reduce((s, r) => s + r.amount, 0);
  $('incomeTotal').textContent = money(incomeTotal); $('expenseTotal').textContent = money(expenseTotal); $('balanceTotal').textContent = money(balance);
  $('incomeCount').textContent = `${income.length} 筆`; $('expenseCount').textContent = `${expense.length} 筆`;
  $('balanceHint').textContent = balance > 0 ? '已扣除信用卡支出' : balance < 0 ? '含信用卡後支出超過收入' : '含信用卡後收支平衡'; $('recordCount').textContent = `共 ${details.length} 筆`;
  $('creditTotal').textContent = money(creditTotal); $('mortgageTotal').textContent = `房貸 ${money(mortgageTotal)}`;
  els.empty.hidden = details.length > 0;
  els.body.innerHTML = details.map(r => `<tr><td>${esc(r.date)}</td><td><span class="tag ${r.type}">${r.type === 'income' ? '收入' : '支出'}</span></td><td><div class="record-main">${esc(r.category)}${r.property ? ` · ${esc(r.property)}` : ''}</div><div class="record-note">${esc(r.note || '—')}</div></td><td><div>${esc(r.payment || '未設定')}${r.cardName ? ` · ${esc(r.cardName)}` : ''}</div><div class="record-note">${esc(r.member || '共同')}</div></td><td class="money ${r.type}">${r.type === 'income' ? '+' : '−'} ${money(r.amount)}</td><td class="row-actions"><button class="icon-btn" data-edit="${r.id}" title="編輯">編輯</button><button class="icon-btn" data-delete="${r.id}" title="刪除">刪除</button></td></tr>`).join('');
  renderBreakdown(expense);
  renderCreditRecords();
  renderUtilityRecords();
  renderAnnualAnalysis();
  renderRecurringSettings();
}
function renderBreakdown(expenses) {
  const totals = {}; expenses.forEach(r => totals[r.category] = (totals[r.category] || 0) + r.amount);
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]), total = expenses.reduce((s, r) => s + r.amount, 0);
  $('breakdown').innerHTML = rows.length ? rows.map(([name, value]) => { const pct = Math.round(value / total * 100); return `<div class="bar-row"><div class="bar-label"><span>${esc(name)}</span><strong>${money(value)}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><div class="bar-percent">${pct}%</div></div>` }).join('') : '<div class="breakdown-empty">本月尚無支出資料</div>';
}
function renderAnnualAnalysis() {
  const yearSelect = $('annualYear'), currentYear = String(new Date().getFullYear()), previous = yearSelect.value;
  const years = [...new Set([currentYear, ...records.map(r => (r.date || '').slice(0, 4)).filter(y => /^\d{4}$/.test(y))])].sort((a, b) => b.localeCompare(a));
  yearSelect.innerHTML = years.map(y => `<option value="${y}">${y} 年</option>`).join(''); yearSelect.value = years.includes(previous) ? previous : (years.includes(currentYear) ? currentYear : years[0]);
  const selectedYear = yearSelect.value, annual = records.filter(r => (r.date || '').startsWith(selectedYear));
  const annualIncome = annual.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0), annualExpense = annual.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0), annualBalance = annualIncome - annualExpense;
  $('annualIncome').textContent = money(annualIncome); $('annualExpense').textContent = money(annualExpense); $('annualBalance').textContent = money(annualBalance); $('annualBalance').className = annualBalance >= 0 ? 'income-text' : 'expense-text';
  $('annualMonthBody').innerHTML = Array.from({ length: 12 }, (_, i) => { const month = `${selectedYear}-${String(i + 1).padStart(2, '0')}`, items = annual.filter(r => (r.date || '').startsWith(month)), income = items.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0), expense = items.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0), balance = income - expense; return `<tr><td>${i + 1} 月</td><td class="money income">${money(income)}</td><td class="money expense">${money(expense)}</td><td class="money ${balance >= 0 ? 'income' : 'expense'}">${money(balance)}</td></tr>` }).join('');
  const categoryTotals = {}; annual.filter(r => r.type === 'expense').forEach(r => categoryTotals[r.category] = (categoryTotals[r.category] || 0) + r.amount); const categoryRows = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
  $('annualCategoryBreakdown').innerHTML = categoryRows.length ? categoryRows.map(([name, value]) => { const pct = annualExpense ? Math.round(value / annualExpense * 100) : 0; return `<div class="bar-row"><div class="bar-label"><span>${esc(name)}</span><strong>${money(value)}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><div class="bar-percent">${pct}%</div></div>` }).join('') : '<div class="breakdown-empty">此年度尚無支出資料</div>';
  const historyIncome = records.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0), historyExpense = records.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0), historyBalance = historyIncome - historyExpense;
  $('historyIncome').textContent = money(historyIncome); $('historyExpense').textContent = money(historyExpense); $('historyBalance').textContent = money(historyBalance); $('historyBalanceHead').textContent = money(historyBalance); $('historyBalance').className = historyBalance >= 0 ? 'income-text' : 'expense-text'; $('historyBalanceHead').style.color = historyBalance >= 0 ? 'var(--income)' : 'var(--expense)';
  const dates = records.map(r => r.date).filter(Boolean).sort(); $('historyRange').textContent = dates.length ? `統計期間：${dates[0].slice(0, 7)} 至 ${dates.at(-1).slice(0, 7)}，共 ${records.length} 筆帳目` : '尚無歷史帳目';
}
function nextMonth(month) { const [year, m] = month.split('-').map(Number), date = new Date(year, m, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` }
function syncRecurringRecords() {
  const currentMonth = localDateValue().slice(0, 7); let changed = false;
  recurringSettings.forEach(setting => { if (!setting.startMonth || setting.startMonth > currentMonth || Number(setting.amount) <= 0) return; let month = setting.startMonth; while (month <= currentMonth) { const exists = records.some(r => r.recurringSettingId === setting.id && r.recurringMonth === month); if (!exists) { const isIncome = setting.kind === 'mortgage_income', day = String(Math.min(Math.max(Number(setting.day) || 1, 1), 28)).padStart(2, '0'); records.push({ id: crypto.randomUUID(), date: `${month}-${day}`, type: isIncome ? 'income' : 'expense', category: isIncome ? '房貸收入' : '房貸', property: setting.property || '', amount: Number(setting.amount), member: setting.member || '', payment: '銀行轉帳', cardName: '', note: setting.note || '', source: 'recurring', recurringSettingId: setting.id, recurringMonth: month, createdAt: Date.now() }); changed = true } month = nextMonth(month) } }); if (changed) saveRecords();
}
function recurringKindName(kind) { return kind === 'mortgage_income' ? '房貸收入' : '房貸支出' }
function recurringProperties(kind) { return kind === 'mortgage_income' ? rentalProperties : mortgageProperties }
function updateRecurringPropertyOptions(selected = '') { const values = recurringProperties($('recurringKind').value); $('recurringProperty').innerHTML = values.map(v => `<option ${v === selected ? 'selected' : ''}>${v}</option>`).join('') }
function renderRecurringSettings() {
  $('recurringCount').textContent = `${recurringSettings.length} 項`; $('recurringEmpty').hidden = recurringSettings.length > 0;
  $('recurringList').innerHTML = recurringSettings.map(s => { const income = s.kind === 'mortgage_income'; return `<article class="recurring-item"><div class="recurring-icon">${income ? '收' : '支'}</div><div class="recurring-info"><strong>${recurringKindName(s.kind)}${s.property ? ` · ${esc(s.property)}` : ''}</strong><small>${esc(s.startMonth)} 起 · 每月 ${s.day} 日 · ${esc(s.member || '共同')}</small></div><div class="recurring-amount ${income ? 'income' : 'expense'}">${income ? '+' : '−'} ${money(s.amount)}</div><div><button class="icon-btn" data-recurring-edit="${s.id}">編輯</button><button class="icon-btn" data-recurring-delete="${s.id}">刪除</button></div></article>` }).join('');
}
function openRecurringForm(setting = null) {
  $('recurringDialogTitle').textContent = setting ? '編輯每月固定收支' : '新增每月固定收支'; $('recurringId').value = setting?.id || ''; $('recurringKind').value = setting?.kind || 'mortgage_expense'; $('recurringAmount').value = setting?.amount || ''; $('recurringStartMonth').value = setting?.startMonth || localDateValue().slice(0, 7); $('recurringDay').innerHTML = Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}">${i + 1} 日</option>`).join(''); $('recurringDay').value = String(setting?.day || 1); $('recurringMember').value = setting?.member || ''; $('recurringNote').value = setting?.note || ''; updateRecurringPropertyOptions(setting?.property); $('recurringDialog').showModal(); setTimeout(() => $('recurringAmount').focus(), 50);
}
function closeRecurringForm() { $('recurringDialog').close(); $('recurringForm').reset() }
function renderAccounts() {
  const twdTotal = accounts.reduce((sum, a) => sum + Number(a.balance || 0), 0);
  $('bankGrandTotal').textContent = money(twdTotal);
  $('accountEmpty').hidden = accounts.length > 0;
  $('accountList').innerHTML = accounts.map(a => `<article class="account-item"><div class="account-top"><div><div class="account-bank">${esc(a.bank)}</div><div class="account-nickname">${esc(a.nickname || '一般存款帳戶')}</div><div class="account-holder">戶名：${esc(a.holder)}</div></div><span class="tag income">存簿</span></div><div class="account-balance">${money(a.balance)}</div><div class="account-bottom"><span class="account-number">${a.number ? `帳號末五碼 ${esc(a.number)}` : '未記錄帳號'}</span><div><button class="icon-btn" data-account-edit="${a.id}">編輯</button><button class="icon-btn" data-account-delete="${a.id}">刪除</button></div></div></article>`).join('');
  renderAssetOverview();
}
function foreignTwdValue(account) { return Number(account.balance || 0) * Number(account.rate || 0) }
function currencyName(currency) { return { USD: '美元', JPY: '日圓', CNY: '人民幣' }[currency] || currency }
function renderAssetOverview() {
  const twdTotal = accounts.reduce((sum, a) => sum + Number(a.balance || 0), 0), foreignTotal = foreignAccounts.reduce((sum, a) => sum + foreignTwdValue(a), 0);
  $('twdAssetTotal').textContent = money(twdTotal); $('foreignAssetTotal').textContent = money(foreignTotal); $('assetGrandTotal').textContent = money(twdTotal + foreignTotal);
}
function renderForeignAccounts() {
  const total = foreignAccounts.reduce((sum, a) => sum + foreignTwdValue(a), 0); $('foreignGrandTotal').textContent = money(total); $('foreignAccountEmpty').hidden = foreignAccounts.length > 0;
  $('foreignAccountList').innerHTML = foreignAccounts.map(a => `<article class="account-item"><div class="account-top"><div><div class="account-bank">${esc(a.nickname || `${currencyName(a.currency)}${a.kind === 'cash' ? '現金' : '戶頭'}`)}</div><div class="account-nickname">${a.kind === 'cash' ? '外幣現金' : esc(a.bank || '外幣銀行戶頭')}</div><div class="account-holder">持有人：${esc(a.holder)}</div></div><span class="tag income">${esc(a.currency)}</span></div><div class="foreign-original">${foreignMoney(a.balance, a.currency)}</div><div class="foreign-converted">折合 ${money(foreignTwdValue(a))}<div class="rate-note">匯率 ${Number(a.rate).toLocaleString('zh-TW', { maximumFractionDigits: 4 })} · ${esc(a.rateDate)}</div></div><div class="account-bottom"><span class="account-number">${a.kind === 'bank' ? (a.number ? `帳號末五碼 ${esc(a.number)}` : '未記錄帳號') : '現金'}</span><div><button class="icon-btn" data-foreign-edit="${a.id}">編輯</button><button class="icon-btn" data-foreign-delete="${a.id}">刪除</button></div></div></article>`).join('');
  renderAssetOverview();
}
function currentMonthCreditRecords() { return records.filter(r => r.type === 'expense' && r.payment === '信用卡' && (!els.month.value || r.date.startsWith(els.month.value))).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt) }
function renderCreditRecords() {
  const list = currentMonthCreditRecords(); $('creditSectionTotal').textContent = money(list.reduce((sum, r) => sum + r.amount, 0)); $('creditRecordEmpty').hidden = list.length > 0;
  const allCardNames = [...new Set(records.filter(r => r.payment === '信用卡' && r.cardName).map(r => r.cardName))].sort((a, b) => a.localeCompare(b, 'zh-Hant')); $('creditCardNames').innerHTML = allCardNames.map(name => `<option value="${esc(name)}"></option>`).join('');
  const byCard = {}; list.forEach(r => { const name = r.cardName || '未命名信用卡'; byCard[name] = (byCard[name] || 0) + r.amount }); $('creditQuickList').innerHTML = Object.entries(byCard).sort((a, b) => b[1] - a[1]).map(([name, total]) => `<div class="credit-chip">${esc(name)}<strong>${money(total)}</strong></div>`).join('');
  $('creditRecordBody').innerHTML = list.map(r => `<tr><td>${esc(r.date)}</td><td><div class="record-main">${esc(r.cardName || '未命名信用卡')}</div></td><td><div class="record-main">${esc(r.category)}</div><div class="record-note">${esc(r.note || '—')}</div></td><td>${esc(r.member || '未設定')}</td><td class="money expense">− ${money(r.amount)}</td><td class="row-actions"><button class="icon-btn" data-credit-edit="${r.id}">編輯</button><button class="icon-btn" data-credit-delete="${r.id}">刪除</button></td></tr>`).join('');
}
function openCreditForm(record = null) {
  $('creditDialogTitle').textContent = record ? '編輯信用卡支出' : '新增信用卡支出'; $('creditEntryId').value = record?.id || ''; $('creditDate').value = record?.date || localDateValue(); $('creditAmount').value = record?.amount || ''; $('creditCardName').value = record?.cardName || ''; $('creditHolder').value = record?.member || ''; $('creditNote').value = record?.note || ''; $('creditCategory').innerHTML = expenseCategories.map(v => `<option ${v === record?.category ? 'selected' : ''}>${v}</option>`).join(''); $('creditDialog').showModal(); setTimeout(() => $('creditAmount').focus(), 50);
}
function closeCreditForm() { $('creditDialog').close(); $('creditForm').reset() }
function prepareNextCreditEntry() {
  $('creditEntryId').value = ''; $('creditDialogTitle').textContent = '新增信用卡支出'; $('creditAmount').value = ''; $('creditNote').value = ''; $('creditAmount').focus();
}
function utilityBillMonth(record) {
  const explicit = String(record.utilityBillMonth || '').slice(0, 7); if (/^\d{4}-\d{2}$/.test(explicit)) return explicit;
  const legacy = String(record.date || '').slice(0, 7); return /^\d{4}-\d{2}$/.test(legacy) ? legacy : '';
}
function currentMonthUtilityRecords() { return records.filter(r => r.source === 'utility' && (!els.month.value || utilityBillMonth(r) === els.month.value)).sort((a, b) => utilityBillMonth(b).localeCompare(utilityBillMonth(a)) || a.utilityItem.localeCompare(b.utilityItem, 'zh-Hant')) }
function renderUtilityRecords() {
  const list = currentMonthUtilityRecords(), unpaid = list.filter(r => r.utilityStatus !== 'paid'), phoneRecords = list.filter(r => ['mobile', 'landline'].includes(utilityRecordProfileType(r)) || r.category === '電話費'); $('utilityTotal').textContent = money(list.reduce((sum, r) => sum + r.amount, 0)); $('utilityPhoneTotal').textContent = money(phoneRecords.reduce((sum, r) => sum + r.amount, 0)); $('utilityUnpaid').textContent = `待繳 ${unpaid.length} 筆`; $('utilityRecordEmpty').hidden = list.length > 0;
  $('utilityQuickList').innerHTML = utilityProfiles.map(profile => `<div class="utility-chip ${list.some(r => r.utilityProfileId === profile.id || r.utilityItem === profile.name) ? 'has-bill' : ''}">${esc(profile.name)}${list.some(r => r.utilityProfileId === profile.id || r.utilityItem === profile.name) ? ' ✓' : ''}</div>`).join('');
  $('utilityRecordBody').innerHTML = list.map(r => `<tr><td>${esc(utilityBillMonth(r))}</td><td><div class="record-main">${esc(r.utilityItem)}</div><div class="record-note">${esc(r.utilityPhoneName || r.note || '—')}</div></td><td><div>${esc(r.member || '未設定')}</div><div class="record-note">期限 ${esc(r.utilityDueDate || '—')}</div></td><td><span class="status-tag ${r.utilityStatus === 'paid' ? 'paid' : 'unpaid'}">${r.utilityStatus === 'paid' ? '已繳費' : '尚未繳費'}</span></td><td class="money expense">− ${money(r.amount)}</td><td class="row-actions"><button class="icon-btn" data-utility-edit="${r.id}">編輯</button><button class="icon-btn" data-utility-delete="${r.id}">刪除</button></td></tr>`).join('');
  renderElectricAnalysis();
}
function electricFloor(record) {
  const profile = utilityProfiles.find(p => p.id === record.utilityProfileId), id = record.utilityProfileId || '', name = (record.utilityItem || profile?.name || '').toUpperCase().replace(/\s/g, '');
  const isElectric = profile?.type === 'electric' || id.startsWith('electric-') || /(電費|電錶|電表)/.test(name); if (!isElectric) return 0;
  if (/(1F|1樓|一樓|電費1|電錶1|電表1)/.test(name)) return 1;
  if (/(2F|2樓|二樓|電費2|電錶2|電表2)/.test(name)) return 2;
  if (/(3F|3樓|三樓|電費3|電錶3|電表3)/.test(name)) return 3;
  const idFloor = id.match(/^electric-([123])$/)?.[1]; if (idFloor) return Number(idFloor);
  return 0;
}
function electricRecords() { return records.filter(r => r.source === 'utility' && electricFloor(r) > 0 && utilityBillMonth(r)) }
function electricTotals(items) {
  const totals = { 1: 0, 2: 0, 3: 0 }; items.forEach(r => totals[electricFloor(r)] += Number(r.amount) || 0); return totals;
}
function renderElectricAnalysis() {
  const select = $('electricAnalysisYear'), items = electricRecords(), currentYear = String(new Date().getFullYear()), previous = select.value;
  const years = [...new Set([currentYear, ...items.map(r => utilityBillMonth(r).slice(0, 4))])].sort((a, b) => b.localeCompare(a));
  select.innerHTML = years.map(y => `<option value="${y}">${y} 年</option>`).join(''); select.value = years.includes(previous) ? previous : years[0];
  const selectedYear = select.value, yearItems = items.filter(r => utilityBillMonth(r).startsWith(selectedYear)), totals = electricTotals(yearItems), grand = totals[1] + totals[2] + totals[3];
  $('electricYearTotals').innerHTML = [1, 2, 3].map(f => `<article class="floor-total floor-${f}"><span>${f}F 年度電費</span><strong>${money(totals[f])}</strong></article>`).join('') + `<article class="floor-total total"><span>三層年度合計</span><strong>${money(grand)}</strong></article>`;

  const monthGroups = {}; yearItems.forEach(r => { const month = utilityBillMonth(r); monthGroups[month] || (monthGroups[month] = []); monthGroups[month].push(r) });
  const periods = Object.entries(monthGroups).sort(([a], [b]) => a.localeCompare(b)).map(([month, rows]) => { const values = electricTotals(rows); return { month, totals: values, total: values[1] + values[2] + values[3] } });
  const periodMax = Math.max(1, ...periods.flatMap(p => [p.totals[1], p.totals[2], p.totals[3]]));
  $('electricPeriodCaption').textContent = `${selectedYear} 年，依帳單月份比較各樓層`;
  $('electricPeriodChart').innerHTML = periods.length ? periods.map(p => `<div class="period-row"><div class="period-label"><strong>${Number(p.month.slice(5))} 月</strong><span>合計<br>${money(p.total)}</span></div><div class="period-bars">${[1, 2, 3].map(f => `<div class="period-bar-line"><span>${f}F</span><div class="period-track"><div class="period-fill floor-${f}" style="width:${p.totals[f] / periodMax * 100}%"></div></div><strong>${money(p.totals[f])}</strong></div>`).join('')}</div></div>`).join('') : '<div class="electric-empty">此年度尚無 1F／2F／3F 電費資料</div>';

  const annual = years.map(year => { const values = electricTotals(items.filter(r => utilityBillMonth(r).startsWith(year))); return { year, values, total: values[1] + values[2] + values[3] } }).filter(x => x.total > 0);
  const annualMax = Math.max(1, ...annual.flatMap(x => [x.values[1], x.values[2], x.values[3]]));
  $('electricAnnualChart').innerHTML = annual.length ? annual.map(x => `<div class="annual-electric-group"><div class="annual-electric-bars">${[1, 2, 3].map(f => `<div class="annual-electric-column"><strong>${money(x.values[f]).replace('NT$ ', '')}</strong><div class="annual-electric-track"><div class="annual-electric-fill floor-${f}" style="height:${Math.max(x.values[f] ? 4 : 0, x.values[f] / annualMax * 100)}%"></div></div><span>${f}F</span></div>`).join('')}</div><div class="annual-electric-label"><strong>${x.year}</strong><span>合計 ${money(x.total)}</span></div></div>`).join('') : '<div class="electric-empty">尚無可統計的年度電費資料</div>';
}
function utilityCategory(profile, item) { return profile?.type === 'electric' || /^(電錶|電表|電費)/.test(item) ? '水電瓦斯' : profile?.type === 'internet' || item === '家庭網路' ? '網路費' : '電話費' }
function orderedUtilityProfiles() {
  const familyOrder = ['守展', '菁蓮', '焱宜', '鈜宜', '淞承'];
  const personOrder = profile => { const text = `${profile.name || ''} ${profile.user || ''}`; const index = familyOrder.findIndex(name => text.includes(name)); return index < 0 ? 0 : index + 1 };
  return utilityProfiles.map((profile, index) => ({ profile, index, floor: electricFloor({ utilityProfileId: profile.id, utilityItem: profile.name }), person: personOrder(profile) })).sort((a, b) => {
    const orderOf = item => item.floor || ((item.profile.type === 'electric') ? 4 : (item.person ? 10 + item.person : ((item.profile.type === 'landline' || item.profile.name === '家用電話') ? 99 : 20)));
    const aOrder = orderOf(a), bOrder = orderOf(b);
    return aOrder - bOrder || a.index - b.index;
  }).map(item => item.profile);
}
function utilityRecordProfileType(record) {
  const profile = utilityProfiles.find(p => p.id === record.utilityProfileId); if (profile?.type) return profile.type;
  if (record.utilityProfileType) return record.utilityProfileType;
  if (electricFloor(record)) return 'electric';
  return '';
}
function utilityPersonIdentity(record, profile = null) {
  const familyNames = ['守展', '菁蓮', '焱宜', '鈜宜', '淞承'], fields = [record.utilityItem, profile?.name, record.utilityPhoneName, record.member, profile?.user].filter(Boolean);
  for (const field of fields) { const familyName = familyNames.find(name => String(field).includes(name)); if (familyName) return familyName; }
  return String(record.utilityItem || profile?.name || record.member || profile?.user || '').trim().replace(/\s/g, '').toLowerCase();
}
function findDuplicateUtility(id, billMonth, profile) {
  const candidates = records.filter(r => r.source === 'utility' && r.id !== id && utilityBillMonth(r) === billMonth);
  if (profile.type === 'electric') {
    const floor = electricFloor({ utilityProfileId: profile.id, utilityItem: profile.name });
    return candidates.find(r => utilityRecordProfileType(r) === 'electric' && (floor ? electricFloor(r) === floor : (r.utilityProfileId === profile.id || r.utilityItem === profile.name)));
  }
  if (profile.type === 'mobile' || profile.type === 'landline') {
    const identity = utilityPersonIdentity({ utilityItem: profile.name, member: $('utilityPayer').value }, profile);
    return candidates.find(r => ['mobile', 'landline'].includes(utilityRecordProfileType(r)) && utilityPersonIdentity(r) === identity);
  }
  return null;
}
function showValidationError(message, focusId = '') {
  $('validationMessage').textContent = message; const dialog = $('validationDialog'); dialog.dataset.focusId = focusId; if (!dialog.open) dialog.showModal();
}
function closeValidationDialog() {
  const dialog = $('validationDialog'), focusId = dialog.dataset.focusId; dialog.close(); if (focusId && $(focusId)) $(focusId).focus(); delete dialog.dataset.focusId;
}
function populateUtilityDropdown(selectedId = '', legacyName = '', legacyDetail = '') {
  $('utilityItem').innerHTML = orderedUtilityProfiles().map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(''); const matched = utilityProfiles.find(p => p.id === selectedId) || utilityProfiles.find(p => p.name === legacyName); if (matched) $('utilityItem').value = matched.id;
  const details = [...new Set([...utilityProfiles.map(p => p.detail).filter(Boolean), ...(legacyDetail ? [legacyDetail] : [])])]; $('utilityPhoneName').innerHTML = '<option value="">未設定</option>' + details.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}
function applySelectedUtilityProfile() { const profile = utilityProfiles.find(p => p.id === $('utilityItem').value); if (!profile) return; $('utilityPayer').value = profile.user || ''; $('utilityPhoneName').value = profile.detail || '' }
function openUtilityForm(record = null) {
  if (!utilityProfiles.length) { toast('請先設定手機、網路或電費基本資料'); openUtilitySettings(); return } $('utilityDialogTitle').textContent = record ? '編輯固定帳單' : '新增固定帳單'; $('utilityEntryId').value = record?.id || ''; $('utilityMonth').value = (record ? utilityBillMonth(record) : '') || els.month.value || localDateValue().slice(0, 7); populateUtilityDropdown(record?.utilityProfileId, record?.utilityItem, record?.utilityPhoneName); if (!record) applySelectedUtilityProfile(); $('utilityAmount').value = record?.amount || ''; $('utilityDueDate').value = record?.utilityDueDate || ''; $('utilityStatus').value = record?.utilityStatus || 'unpaid'; if (record) { $('utilityPayer').value = record.member || ''; $('utilityPhoneName').value = record.utilityPhoneName || '' } $('utilityNote').value = record?.note || ''; $('utilityDialog').showModal(); setTimeout(() => $('utilityAmount').focus(), 50);
}
function closeUtilityForm() { $('utilityDialog').close(); $('utilityForm').reset() }
function prepareNextUtilityEntry() {
  $('utilityEntryId').value = ''; $('utilityDialogTitle').textContent = '新增固定帳單'; $('utilityAmount').value = ''; $('utilityNote').value = ''; $('utilityAmount').focus();
}
function profileTypeName(type) { return { electric: '電費／電錶', mobile: '手機', landline: '家用電話', internet: '家庭網路' }[type] || type }
function renderUtilityProfiles() { $('utilityProfileList').innerHTML = utilityProfiles.map(p => `<div class="profile-row"><div><strong>${esc(p.name)}</strong><small class="profile-type">${profileTypeName(p.type)}</small></div><div class="profile-user">${esc(p.user || '共同／未指定')}</div><div class="profile-detail">${esc(p.detail || '未設定識別名稱')}</div><div class="profile-row-actions"><button type="button" class="icon-btn" data-profile-edit="${p.id}">編輯</button><button type="button" class="icon-btn" data-profile-delete="${p.id}">刪除</button></div></div>`).join('') }
function resetUtilityProfileForm() { $('utilityProfileId').value = ''; $('utilityProfileForm').reset(); $('utilityProfileType').value = 'electric' }
function openUtilitySettings() { renderUtilityProfiles(); resetUtilityProfileForm(); $('utilitySettingsDialog').showModal() }
function closeUtilitySettings() { $('utilitySettingsDialog').close(); resetUtilityProfileForm() }
function openAccountForm(account = null) {
  $('accountDialogTitle').textContent = account ? '編輯銀行戶頭' : '新增銀行戶頭'; $('accountId').value = account?.id || ''; $('accountHolder').value = account?.holder || ''; $('accountNickname').value = account?.nickname || ''; $('accountNumber').value = account?.number || ''; $('accountBalance').value = account?.balance ?? '';
  const standard = [...$('accountBank').options].some(o => o.value === account?.bank && o.value !== '其他銀行'); $('accountBank').value = account ? (standard ? account.bank : '其他銀行') : ''; $('accountCustomBank').value = account && !standard ? account.bank : ''; toggleCustomBank(); $('accountDialog').showModal();
}
function toggleCustomBank() { const other = $('accountBank').value === '其他銀行'; $('accountCustomBank').disabled = !other; $('accountCustomBank').required = other; $('accountCustomBank').style.opacity = other ? '1' : '.55' }
function closeAccountForm() { $('accountDialog').close(); $('accountForm').reset() }
function prepareNextAccountEntry() {
  $('accountId').value = ''; $('accountDialogTitle').textContent = '新增銀行戶頭'; $('accountForm').reset(); toggleCustomBank(); $('accountBank').focus();
}
function updateForeignKindFields() {
  const isBank = $('foreignKind').value === 'bank'; $('foreignBankWrap').style.display = isBank ? 'block' : 'none'; $('foreignBank').required = isBank; $('foreignNumber').disabled = !isBank;
}
function updateForeignPreview() {
  $('foreignPreview').textContent = money(Number($('foreignBalance').value || 0) * Number($('foreignRate').value || 0));
}
function openForeignForm(account = null) {
  $('foreignDialogTitle').textContent = account ? '編輯外幣資產' : '新增外幣資產'; $('foreignId').value = account?.id || ''; $('foreignCurrency').value = account?.currency || 'USD'; $('foreignKind').value = account?.kind || 'cash'; $('foreignBank').value = account?.bank || ''; $('foreignHolder').value = account?.holder || ''; $('foreignNickname').value = account?.nickname || ''; $('foreignNumber').value = account?.number || ''; $('foreignBalance').value = account?.balance ?? ''; $('foreignRate').value = account?.rate ?? ''; $('foreignRateDate').value = account?.rateDate || localDateValue(); updateForeignKindFields(); updateForeignPreview(); $('foreignDialog').showModal(); setTimeout(() => $('foreignBalance').focus(), 50);
}
function closeForeignForm() { $('foreignDialog').close(); $('foreignForm').reset(); updateForeignKindFields(); updateForeignPreview() }
function prepareNextForeignEntry() {
  $('foreignId').value = ''; $('foreignDialogTitle').textContent = '新增外幣資產'; $('foreignForm').reset(); $('foreignRateDate').value = localDateValue(); updateForeignKindFields(); updateForeignPreview(); $('foreignCurrency').focus();
}
function updateCategories(type, selected = '') {
  const values = type === 'income' ? incomeCategories : expenseCategories;
  els.category.innerHTML = values.map(v => `<option ${v === selected ? 'selected' : ''}>${v}</option>`).join('');
  updatePropertyOptions();
}
function updatePropertyOptions(selected = '') {
  const type = new FormData(els.form).get('entryType'), values = type === 'income' && ['房租', '房貸收入'].includes(els.category.value) ? rentalProperties : type === 'expense' && els.category.value === '房貸' ? mortgageProperties : [];
  els.propertyWrap.style.display = values.length ? 'block' : 'none'; els.property.required = values.length > 0; els.property.innerHTML = values.map(v => `<option ${v === selected ? 'selected' : ''}>${v}</option>`).join('');
}
function toggleCardName() { els.cardWrap.style.display = els.payment.value === '信用卡' ? 'block' : 'none' }
function openForm(record = null) {
  $('dialogTitle').textContent = record ? '編輯帳目' : '新增帳目'; $('entryId').value = record?.id || ''; $('entryDate').value = record?.date || localDateValue(); $('entryAmount').value = record?.amount || ''; $('entryMember').value = record?.member || ''; $('entryNote').value = record?.note || ''; els.payment.value = record?.payment || '現金'; els.cardName.value = record?.cardName || ''; toggleCardName();
  const type = record?.type || 'expense'; document.querySelector(`input[name="entryType"][value="${type}"]`).checked = true; updateCategories(type, record?.category); updatePropertyOptions(record?.property); els.dialog.showModal(); setTimeout(() => $('entryAmount').focus(), 50);
}
function closeForm() { els.dialog.close(); els.form.reset() }
function prepareNextEntry() {
  const date = $('entryDate').value || localDateValue(), type = new FormData(els.form).get('entryType') || 'expense'; els.form.reset(); $('entryId').value = ''; $('dialogTitle').textContent = '新增帳目'; $('entryDate').value = date; document.querySelector(`input[name="entryType"][value="${type}"]`).checked = true; updateCategories(type); toggleCardName(); $('entryAmount').focus();
}
function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 1800) }

els.form.addEventListener('submit', e => {
  e.preventDefault(); const id = $('entryId').value, amount = Number($('entryAmount').value), date = $('entryDate').value, type = new FormData(els.form).get('entryType'), category = els.category.value, member = $('entryMember').value.trim(); if (!amount || amount < 1) return;
  if (type === 'income' && category === '薪資') {
    if (!member) { showValidationError('薪資資料必須選擇家庭成員，才能依月份及人名進行重複檢核。', 'entryMember'); return; }
    const month = date.slice(0, 7), memberKey = member.replace(/\s/g, ''), duplicate = records.find(r => r.id !== id && r.type === 'income' && r.category === '薪資' && (r.date || '').slice(0, 7) === month && String(r.member || '').replace(/\s/g, '') === memberKey);
    if (duplicate) { showValidationError(`${month} 已有「${member}」的薪資資料（${duplicate.date}，${money(duplicate.amount)}），同一月份、同一人只能輸入一筆薪資。請改用既有資料的「編輯」功能。`, 'entryMember'); return; }
  }
  const previous = records.find(r => r.id === id); const item = { ...(previous || {}), id: id || crypto.randomUUID(), date, type, category, property: els.propertyWrap.style.display !== 'none' ? els.property.value : '', amount, member, payment: els.payment.value, cardName: els.payment.value === '信用卡' ? els.cardName.value.trim() : '', note: $('entryNote').value.trim(), createdAt: previous?.createdAt || Date.now() };
  records = id ? records.map(r => r.id === id ? item : r) : [item, ...records]; saveRecords(); render(); prepareNextEntry(); toast(`${id ? '帳目已更新' : '帳目已新增'}，可繼續輸入`);
});
document.querySelectorAll('input[name="entryType"]').forEach(r => r.addEventListener('change', () => updateCategories(r.value)));
els.category.addEventListener('change', () => updatePropertyOptions());
els.payment.addEventListener('change', toggleCardName);
[$('openFormBtn'), $('emptyAddBtn')].forEach(b => b.addEventListener('click', () => openForm()));
[$('closeDialogBtn'), $('cancelBtn'), $('finishEntryBtn')].forEach(b => b.addEventListener('click', closeForm));
els.dialog.addEventListener('click', e => { if (e.target === els.dialog) closeForm() });
[els.month, els.type, els.quick, els.search].forEach(el => el.addEventListener('input', render));
els.type.addEventListener('change', render);
$('recordTypeFilter').addEventListener('change', render);
$('annualYear').addEventListener('change', renderAnnualAnalysis);
$('electricAnalysisYear').addEventListener('change', renderElectricAnalysis);
$('recurringKind').addEventListener('change', () => updateRecurringPropertyOptions());
$('clearFiltersBtn').addEventListener('click', () => { els.month.value = localDateValue().slice(0, 7); els.type.value = 'all'; els.quick.value = 'all'; els.search.value = ''; $('recordTypeFilter').value = 'all'; render() });
els.body.addEventListener('click', e => {
  const edit = e.target.dataset.edit, del = e.target.dataset.delete;
  if (edit) openForm(records.find(r => r.id === edit));
  if (del && confirm('確定要刪除這筆帳目嗎？')) { records = records.filter(r => r.id !== del); saveRecords(); render(); toast('帳目已刪除') }
});
$('openAccountBtn').addEventListener('click', () => openAccountForm());
[$('closeAccountBtn'), $('cancelAccountBtn'), $('finishAccountBtn')].forEach(b => b.addEventListener('click', closeAccountForm));
$('accountBank').addEventListener('change', toggleCustomBank);
$('accountDialog').addEventListener('click', e => { if (e.target === $('accountDialog')) closeAccountForm() });
$('accountForm').addEventListener('submit', e => {
  e.preventDefault(); const id = $('accountId').value, selected = $('accountBank').value, bank = selected === '其他銀行' ? $('accountCustomBank').value.trim() : selected, balance = Number($('accountBalance').value); if (!bank || !$('accountHolder').value.trim() || balance < 0) return;
  const item = { id: id || crypto.randomUUID(), bank, holder: $('accountHolder').value.trim(), nickname: $('accountNickname').value.trim(), number: $('accountNumber').value.trim(), balance }; accounts = id ? accounts.map(a => a.id === id ? item : a) : [...accounts, item]; saveAccounts(); renderAccounts(); prepareNextAccountEntry(); toast(`${id ? '銀行戶頭已更新' : '銀行戶頭已新增'}，可繼續輸入`);
});
$('accountList').addEventListener('click', e => {
  const edit = e.target.dataset.accountEdit, del = e.target.dataset.accountDelete; if (edit) openAccountForm(accounts.find(a => a.id === edit)); if (del && confirm('確定刪除這個銀行戶頭嗎？')) { accounts = accounts.filter(a => a.id !== del); saveAccounts(); renderAccounts(); toast('銀行戶頭已刪除') }
});
$('openForeignBtn').addEventListener('click', () => openForeignForm());
[$('closeForeignBtn'), $('cancelForeignBtn'), $('finishForeignBtn')].forEach(b => b.addEventListener('click', closeForeignForm));
$('foreignKind').addEventListener('change', updateForeignKindFields);
[$('foreignBalance'), $('foreignRate')].forEach(el => el.addEventListener('input', updateForeignPreview));
$('foreignDialog').addEventListener('click', e => { if (e.target === $('foreignDialog')) closeForeignForm() });
$('foreignForm').addEventListener('submit', e => {
  e.preventDefault(); const id = $('foreignId').value, balance = Number($('foreignBalance').value), rate = Number($('foreignRate').value), kind = $('foreignKind').value, bank = $('foreignBank').value.trim(); if (balance < 0 || rate <= 0 || !$('foreignHolder').value.trim() || (kind === 'bank' && !bank)) return;
  const item = { id: id || crypto.randomUUID(), currency: $('foreignCurrency').value, kind, bank: kind === 'bank' ? bank : '', holder: $('foreignHolder').value.trim(), nickname: $('foreignNickname').value.trim(), number: kind === 'bank' ? $('foreignNumber').value.trim() : '', balance, rate, rateDate: $('foreignRateDate').value }; foreignAccounts = id ? foreignAccounts.map(a => a.id === id ? item : a) : [...foreignAccounts, item]; saveForeignAccounts(); renderForeignAccounts(); prepareNextForeignEntry(); toast(`${id ? '外幣資產已更新' : '外幣資產已新增'}，可繼續輸入`);
});
$('foreignAccountList').addEventListener('click', e => {
  const edit = e.target.dataset.foreignEdit, del = e.target.dataset.foreignDelete; if (edit) openForeignForm(foreignAccounts.find(a => a.id === edit)); if (del && confirm('確定刪除這筆外幣資產嗎？')) { foreignAccounts = foreignAccounts.filter(a => a.id !== del); saveForeignAccounts(); renderForeignAccounts(); toast('外幣資產已刪除') }
});
$('openCreditBtn').addEventListener('click', () => openCreditForm());
[$('closeCreditBtn'), $('cancelCreditBtn'), $('finishCreditBtn')].forEach(b => b.addEventListener('click', closeCreditForm));
$('creditDialog').addEventListener('click', e => { if (e.target === $('creditDialog')) closeCreditForm() });
$('creditForm').addEventListener('submit', e => {
  e.preventDefault(); const id = $('creditEntryId').value, amount = Number($('creditAmount').value); if (!amount || amount < 1) return; const old = records.find(r => r.id === id); const item = { id: id || crypto.randomUUID(), date: $('creditDate').value, type: 'expense', category: $('creditCategory').value, amount, member: $('creditHolder').value.trim(), payment: '信用卡', cardName: $('creditCardName').value.trim(), note: $('creditNote').value.trim(), createdAt: old?.createdAt || Date.now() }; records = id ? records.map(r => r.id === id ? item : r) : [item, ...records]; saveRecords(); render(); prepareNextCreditEntry(); toast(`${id ? '信用卡支出已更新' : '信用卡支出已新增'}，可繼續輸入`);
});
$('creditRecordBody').addEventListener('click', e => {
  const edit = e.target.dataset.creditEdit, del = e.target.dataset.creditDelete; if (edit) openCreditForm(records.find(r => r.id === edit)); if (del && confirm('確定刪除這筆信用卡支出嗎？')) { records = records.filter(r => r.id !== del); saveRecords(); render(); toast('信用卡支出已刪除') }
});
$('openUtilityBtn').addEventListener('click', () => openUtilityForm());
[$('closeUtilityBtn'), $('cancelUtilityBtn'), $('finishUtilityBtn')].forEach(b => b.addEventListener('click', closeUtilityForm));
$('utilityItem').addEventListener('change', applySelectedUtilityProfile);
$('utilityDialog').addEventListener('click', e => { if (e.target === $('utilityDialog')) closeUtilityForm() });
$('utilityForm').addEventListener('submit', e => {
  e.preventDefault(); const id = $('utilityEntryId').value, amount = Number($('utilityAmount').value), billMonth = $('utilityMonth').value, profile = utilityProfiles.find(p => p.id === $('utilityItem').value), old = records.find(r => r.id === id); if (!amount || amount < 1 || !billMonth || !profile) return;
  const duplicate = findDuplicateUtility(id, billMonth, profile); if (duplicate) { const floor = electricFloor({ utilityProfileId: profile.id, utilityItem: profile.name }), kind = profile.type === 'electric' ? (floor ? `${floor}F 電費` : profile.name) : `${utilityPersonIdentity({ utilityItem: profile.name, member: $('utilityPayer').value }, profile)}的電話費`; showValidationError(`${billMonth} 已有「${duplicate.utilityItem || kind}」資料（${money(duplicate.amount)}），同一月份不可重複輸入${kind}。請改用既有資料的「編輯」功能。`, 'utilityAmount'); return; }
  const item = { id: id || crypto.randomUUID(), date: `${billMonth}-01`, utilityBillMonth: billMonth, type: 'expense', category: utilityCategory(profile, profile.name), amount, member: $('utilityPayer').value.trim(), payment: '自動扣款', cardName: '', note: $('utilityNote').value.trim(), source: 'utility', utilityProfileId: profile.id, utilityProfileType: profile.type, utilityItem: profile.name, utilityPhoneName: $('utilityPhoneName').value, utilityDueDate: $('utilityDueDate').value, utilityStatus: $('utilityStatus').value, createdAt: old?.createdAt || Date.now() }; records = id ? records.map(r => r.id === id ? item : r) : [item, ...records]; saveRecords(); render(); prepareNextUtilityEntry(); toast(`${id ? '固定帳單已更新' : '固定帳單已新增'}，可繼續輸入`);
});
$('closeValidationBtn').addEventListener('click', closeValidationDialog);
$('validationDialog').addEventListener('click', e => { if (e.target === $('validationDialog')) closeValidationDialog() });
$('utilityRecordBody').addEventListener('click', e => {
  const edit = e.target.dataset.utilityEdit, del = e.target.dataset.utilityDelete; if (edit) openUtilityForm(records.find(r => r.id === edit)); if (del && confirm('確定刪除這筆固定帳單嗎？')) { records = records.filter(r => r.id !== del); saveRecords(); render(); toast('固定帳單已刪除') }
});
$('openUtilitySettingsBtn').addEventListener('click', openUtilitySettings);
$('utilitySetupShortcut').addEventListener('click', openUtilitySettings);
[$('closeUtilitySettingsBtn'), $('doneUtilitySettingsBtn')].forEach(b => b.addEventListener('click', closeUtilitySettings));
$('resetUtilityProfileBtn').addEventListener('click', resetUtilityProfileForm);
$('utilitySettingsDialog').addEventListener('click', e => { if (e.target === $('utilitySettingsDialog')) closeUtilitySettings() });
$('utilityProfileForm').addEventListener('submit', e => {
  e.preventDefault(); const id = $('utilityProfileId').value; const item = { id: id || crypto.randomUUID(), type: $('utilityProfileType').value, name: $('utilityProfileName').value.trim(), user: $('utilityProfileUser').value, detail: $('utilityProfileDetail').value.trim() }; if (!item.name) return; utilityProfiles = id ? utilityProfiles.map(p => p.id === id ? item : p) : [...utilityProfiles, item]; saveUtilityProfiles(); renderUtilityProfiles(); renderUtilityRecords(); resetUtilityProfileForm(); toast(id ? '基本資料已更新' : '基本資料已新增');
});
$('utilityProfileList').addEventListener('click', e => {
  const edit = e.target.dataset.profileEdit, del = e.target.dataset.profileDelete; if (edit) { const p = utilityProfiles.find(x => x.id === edit); $('utilityProfileId').value = p.id; $('utilityProfileType').value = p.type; $('utilityProfileName').value = p.name; $('utilityProfileUser').value = p.user || ''; $('utilityProfileDetail').value = p.detail || ''; $('utilityProfileName').focus() } if (del && confirm('刪除這項基本資料？已建立的舊帳單不會被刪除。')) { utilityProfiles = utilityProfiles.filter(p => p.id !== del); saveUtilityProfiles(); renderUtilityProfiles(); renderUtilityRecords(); toast('基本資料已刪除') }
});
$('openRecurringBtn').addEventListener('click', () => openRecurringForm());
[$('closeRecurringBtn'), $('cancelRecurringBtn')].forEach(b => b.addEventListener('click', closeRecurringForm));
$('recurringDialog').addEventListener('click', e => { if (e.target === $('recurringDialog')) closeRecurringForm() });
$('recurringForm').addEventListener('submit', e => {
  e.preventDefault(); const id = $('recurringId').value, amount = Number($('recurringAmount').value), kind = $('recurringKind').value, property = $('recurringProperty').value; if (!amount || amount < 1 || !property) return; const duplicate = recurringSettings.find(s => s.id !== id && s.kind === kind && s.property === property); if (duplicate) { alert(`「${recurringKindName(kind)} · ${property}」已經有固定設定，請直接編輯原設定。`); return } const item = { id: id || crypto.randomUUID(), kind, property, amount, startMonth: $('recurringStartMonth').value, day: Number($('recurringDay').value), member: $('recurringMember').value, note: $('recurringNote').value.trim() }; recurringSettings = id ? recurringSettings.map(s => s.id === id ? item : s) : [...recurringSettings, item]; saveRecurringSettings(); closeRecurringForm(); render(); toast(id ? '固定收支設定已更新；舊資料保持不變' : '固定收支已設定並自動加入收支表');
});
$('recurringList').addEventListener('click', e => {
  const edit = e.target.dataset.recurringEdit, del = e.target.dataset.recurringDelete; if (edit) openRecurringForm(recurringSettings.find(s => s.id === edit)); if (del && confirm('刪除後將停止未來月份自動帶入；已帶入收支表的舊資料會保留。確定刪除設定嗎？')) { recurringSettings = recurringSettings.filter(s => s.id !== del); saveRecurringSettings(); render(); toast('設定已刪除，歷史收支資料已保留') }
});
$('exportBtn').addEventListener('click', () => {
  const header = ['日期', '類型', '分類', '房產選項', '金額', '家庭成員', '付款方式', '信用卡名稱', '備註'];
  const quote = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '\uFEFF' + [header, ...records.map(r => [r.date, r.type === 'income' ? '收入' : '支出', r.category, r.property || '', r.amount, r.member, r.payment || '', r.cardName || '', r.note])].map(row => row.map(quote).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `家庭記帳_${localDateValue()}.csv`; a.click(); URL.revokeObjectURL(a.href); toast('CSV 已匯出');
});
$('importInput').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return; const text = await file.text(); const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).slice(1).filter(Boolean);
  const parse = line => { const out = []; let cur = '', quoted = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"' && quoted && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') quoted = !quoted; else if (c === ',' && !quoted) { out.push(cur); cur = '' } else cur += c } out.push(cur); return out };
  const imported = lines.map(parse).filter(v => Number(v.length >= 9 ? v[4] : v[3]) > 0).map(v => { const hasProperty = v.length >= 9; return { id: crypto.randomUUID(), date: v[0], type: v[1] === '收入' ? 'income' : 'expense', category: v[2], property: hasProperty ? (v[3] || '') : '', amount: Number(hasProperty ? v[4] : v[3]), member: v[hasProperty ? 5 : 4] || '', payment: v.length >= (hasProperty ? 9 : 8) ? (v[hasProperty ? 6 : 5] || '') : '', cardName: v.length >= (hasProperty ? 9 : 8) ? (v[hasProperty ? 7 : 6] || '') : '', note: v.length >= (hasProperty ? 9 : 8) ? (v[hasProperty ? 8 : 7] || '') : (v[5] || ''), createdAt: Date.now() } });
  records = [...imported, ...records]; saveRecords(); render(); e.target.value = ''; toast(`已匯入 ${imported.length} 筆帳目`);
});

els.month.value = localDateValue().slice(0, 7); updateCategories('expense'); render(); renderAccounts(); renderForeignAccounts(); toggleCustomBank(); updateForeignKindFields(); startSupabaseSync();
