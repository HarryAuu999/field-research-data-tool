const DB_NAME = "research-notebook";
const DB_VERSION = 1;

const STORES = {
  templates: "templates",
  records: "records",
  drafts: "drafts",
  settings: "settings"
};

let databasePromise;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("数据库操作已取消"));
    transaction.onerror = () => reject(transaction.error || new Error("数据库操作失败"));
  });
}

export function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.templates)) {
        db.createObjectStore(STORES.templates, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORES.records)) {
        const store = db.createObjectStore(STORES.records, { keyPath: "id" });
        store.createIndex("templateKey", "templateKey", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.drafts)) {
        db.createObjectStore(STORES.drafts, { keyPath: "templateKey" });
      }
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("数据库正在被其他页面使用，请关闭其他页面后重试"));
  });

  return databasePromise;
}

async function readAll(storeName) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readonly");
  return requestToPromise(transaction.objectStore(storeName).getAll());
}

async function getOne(storeName, key) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readonly");
  return requestToPromise(transaction.objectStore(storeName).get(key));
}

async function putOne(storeName, value) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(value);
  await transactionDone(transaction);
  return value;
}

async function deleteOne(storeName, key) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).delete(key);
  await transactionDone(transaction);
}

export async function getTemplates() {
  const templates = await readAll(STORES.templates);
  const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  return templates.sort((a, b) => collator.compare(a.title, b.title) || collator.compare(a.version, b.version));
}

export const getTemplate = (key) => getOne(STORES.templates, key);
export const putTemplate = (template) => putOne(STORES.templates, template);

export async function getSetting(key, fallback = null) {
  const row = await getOne(STORES.settings, key);
  return row ? row.value : fallback;
}

export const setSetting = (key, value) => putOne(STORES.settings, { key, value });
export const deleteSetting = (key) => deleteOne(STORES.settings, key);

export async function replaceEmptyTemplateVersion(oldKey, template) {
  const db = await openDatabase();
  const transaction = db.transaction([STORES.templates, STORES.records, STORES.drafts, STORES.settings], "readwrite");
  const recordStore = transaction.objectStore(STORES.records);
  const draftStore = transaction.objectStore(STORES.drafts);
  const recordRequest = recordStore.index("templateKey").count(oldKey);
  const draftRequest = draftStore.get(oldKey);
  const [records, draft] = await Promise.all([requestToPromise(recordRequest), requestToPromise(draftRequest)]);
  if (records || draft) {
    transaction.abort();
    throw new Error("问卷在编辑期间新增了记录或草稿，将改为保留旧版本");
  }
  transaction.objectStore(STORES.templates).put(template);
  transaction.objectStore(STORES.templates).delete(oldKey);
  transaction.objectStore(STORES.settings).put({ key: "currentTemplateKey", value: template.key });
  await transactionDone(transaction);
  return template;
}

export async function getRecords(templateKey) {
  const db = await openDatabase();
  const transaction = db.transaction(STORES.records, "readonly");
  const records = await requestToPromise(transaction.objectStore(STORES.records).index("templateKey").getAll(templateKey));
  return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export const getRecord = (id) => getOne(STORES.records, id);
export const putRecord = (record) => putOne(STORES.records, record);
export const deleteRecord = (id) => deleteOne(STORES.records, id);
export const getDraft = (templateKey) => getOne(STORES.drafts, templateKey);
export const putDraft = (draft) => putOne(STORES.drafts, draft);
export const deleteDraft = (templateKey) => deleteOne(STORES.drafts, templateKey);

export async function deleteTemplateCascade(templateKey) {
  const db = await openDatabase();
  const transaction = db.transaction([STORES.templates, STORES.records, STORES.drafts], "readwrite");
  transaction.objectStore(STORES.templates).delete(templateKey);
  transaction.objectStore(STORES.drafts).delete(templateKey);

  const recordStore = transaction.objectStore(STORES.records);
  const index = recordStore.index("templateKey");
  const cursorRequest = index.openCursor(IDBKeyRange.only(templateKey));
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };

  await transactionDone(transaction);
}

export async function exportDatabaseState() {
  const [templates, records, drafts, settings] = await Promise.all([
    readAll(STORES.templates),
    readAll(STORES.records),
    readAll(STORES.drafts),
    readAll(STORES.settings)
  ]);
  return { templates, records, drafts, settings };
}

export async function replaceDatabaseState(state) {
  const db = await openDatabase();
  const storeNames = Object.values(STORES);
  const transaction = db.transaction(storeNames, "readwrite");

  for (const name of storeNames) transaction.objectStore(name).clear();
  for (const template of state.templates) transaction.objectStore(STORES.templates).put(template);
  for (const record of state.records) transaction.objectStore(STORES.records).put(record);
  for (const draft of state.drafts) transaction.objectStore(STORES.drafts).put(draft);
  for (const setting of state.settings) transaction.objectStore(STORES.settings).put(setting);

  await transactionDone(transaction);
}
