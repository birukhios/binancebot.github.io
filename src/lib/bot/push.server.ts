import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import webpush from "web-push";

const DATA_DIR = resolve(process.env.PUSH_DATA_DIR ?? "./data");
const SUBS_FILE = resolve(DATA_DIR, "push-subscriptions.json");
const KEYS_FILE = resolve(DATA_DIR, "vapid-keys.json");

interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface UserSubscriptions {
  [userId: string]: PushSub[];
}

function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true });
}

function loadSubs(): UserSubscriptions {
  try {
    if (existsSync(SUBS_FILE)) return JSON.parse(readFileSync(SUBS_FILE, "utf-8"));
  } catch {}
  return {};
}

function saveSubs(subs: UserSubscriptions) {
  ensureDataDir();
  writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
}

export function getVapidKeys() {
  ensureDataDir();
  if (existsSync(KEYS_FILE)) {
    try {
      return JSON.parse(readFileSync(KEYS_FILE, "utf-8"));
    } catch {}
  }
  const keys = webpush.generateVAPIDKeys();
  const data = { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: "mailto:bkbot@localhost" };
  writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2));
  return data;
}

function initVapid() {
  const keys = getVapidKeys();
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  return keys;
}

export function getPublicVapidKey(): string {
  return initVapid().publicKey;
}

export function addSubscription(userId: string, sub: PushSub) {
  const subs = loadSubs();
  if (!subs[userId]) subs[userId] = [];
  if (!subs[userId].some((s) => s.endpoint === sub.endpoint)) {
    subs[userId].push(sub);
  }
  saveSubs(subs);
}

export function removeSubscriptions(userId: string) {
  const subs = loadSubs();
  delete subs[userId];
  saveSubs(subs);
}

export async function sendPushToUser(
  userId: string,
  notification: { title: string; body: string; tag?: string; url?: string },
) {
  initVapid();
  const subs = loadSubs();
  const userSubs = subs[userId];
  if (!userSubs || userSubs.length === 0) return;

  const payload = JSON.stringify(notification);
  const expired: number[] = [];

  for (let i = 0; i < userSubs.length; i++) {
    try {
      await webpush.sendNotification(userSubs[i], payload, { TTL: 3600 });
    } catch (e: any) {
      if (e?.statusCode === 410 || e?.statusCode === 404) expired.push(i);
    }
  }

  if (expired.length > 0) {
    subs[userId] = userSubs.filter((_, i) => !expired.includes(i));
    saveSubs(subs);
  }
}
