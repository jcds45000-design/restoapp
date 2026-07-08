/**
 * Modèle de vérification E2E restoapp — copier vers pw_verif_<module>.cjs et adapter.
 * Usage : $env:RESTOAPP_EMAIL='...'; $env:RESTOAPP_PASSWORD='...'; node pw_verif_<module>.cjs
 * Identifiants UNIQUEMENT via variables d'environnement.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const MODULE = 'stocks'; // <- adapter
const BASE_URL = process.env.RESTOAPP_URL || 'http://localhost:5173'; // prod : https://restoapp-khaki.vercel.app
const EMAIL = process.env.RESTOAPP_EMAIL;
const PASSWORD = process.env.RESTOAPP_PASSWORD;
const DIR = path.join(__dirname, `.verif-${MODULE}`);

if (!EMAIL || !PASSWORD) { console.error('ECHEC: RESTOAPP_EMAIL / RESTOAPP_PASSWORD manquants.'); process.exit(1); }
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const shot = (page, name) => page.screenshot({ path: path.join(DIR, `${name}.png`) });

(async () => {
  const browser = await chromium.launch({ headless: true });
  // Desktop ; pour mobile : { viewport: {width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2 }
  const page = await browser.newContext({ viewport: { width: 1280, height: 800 } }).then(c => c.newPage());

  // ─── Login ───
  await page.goto(BASE_URL);
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('nav', { timeout: 20000 });
  await page.waitForTimeout(2500); // chargement Supabase

  // ─── Navigation vers le module (desktop : bouton de la sidebar) ───
  await page.locator(`button:has-text("Stocks")`).first().click(); // <- adapter
  await page.waitForTimeout(1500);
  await shot(page, '01-module');

  // ─── Assertions du module (adapter) ───
  // Exemple : const n = await page.locator('text=Seuil à définir').count();
  // if (n === 0) throw new Error('aucun badge "Seuil à définir"');

  console.log('OK — captures dans ' + DIR);
  await browser.close();
})().catch(e => { console.error('ECHEC:', e.message); process.exit(1); });
