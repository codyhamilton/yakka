import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,resolve} from 'node:path';
import {loadBrowserEnvironment,launchBrowser} from '../../../../../packages/yakka-analytics/tests/charts-time/browser.mjs';
// Use the repository browser loader; no dependency or product installation.
const here=dirname(fileURLToPath(import.meta.url));
const screens=JSON.parse(await readFile(resolve(here,'screens.json'),'utf8'));
const env=loadBrowserEnvironment();
if(!env.ok)throw new Error(env.reason);
const browser=await launchBrowser(env);
const results=[];
try{
 for(const {key}of screens){
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(resolve(here,key+'.html')).href);
  await page.evaluate(()=>document.fonts.ready);
  const info=await page.evaluate(()=>({width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,rows:[...document.querySelectorAll('th,td')].map(e=>e.getBoundingClientRect().height),surfaces:[...document.querySelectorAll('.plot,.panel')].map(e=>getComputedStyle(e).backgroundColor),filters:!!document.querySelector('#filters')}));
  if(info.documentWidth>1440)throw new Error(`${key} overflows: ${info.documentWidth}`);
  if(info.rows.some(h=>h<28||h>32))throw new Error(`${key} row density: ${JSON.stringify([...new Set(info.rows)])}`);
  if(info.surfaces.includes('rgb(255, 255, 255)'))throw new Error(key+' white surface');
  await page.screenshot({path:resolve(here,'..',key+'.png'),fullPage:false});
  if(info.filters){
   await page.selectOption('[name=win]','7d');
   await page.selectOption('[name=repo_id]','codyhamilton/yakka');
   await page.selectOption('[name=kind]','brief');
   await page.click('#filters button[type=submit], #filters button:not([type])');
   if(!(await page.url()).includes('kind=brief'))throw new Error(key+' filter URL');
   await page.selectOption('#tenant','tenant-lab');
   if(!(await page.locator('#counts').textContent()).includes('5,242'))throw new Error(key+' tenant update');
   await page.click('#all');
   if(!(await page.url()).includes('win=all'))throw new Error(key+' all history');
   await page.click('#reset');
   if((await page.url()).includes('kind=brief'))throw new Error(key+' reset');
   await page.selectOption('[name=win]','custom');
   if(!(await page.locator('[name=from]').isVisible()))throw new Error(key+' custom dates');
  }
  await page.click('#theme');
  const light=await page.locator('.panel').first().evaluate(e=>getComputedStyle(e).backgroundColor);
  if(light==='rgb(255, 255, 255)')throw new Error(key+' light white');
  if(errors.length)throw new Error(key+': '+errors.join('; '));
  results.push({screen:key,viewport:'1440x900',rows:'28–32px',overflow:false,consoleErrors:0,filterPreview:info.filters});
  await page.close();
 }
}finally{await browser.close()}
await writeFile(resolve(here,'..','capture-results.json'),JSON.stringify(results,null,2)+'\n');
console.log(`Captured and checked ${results.length} screens at 1440x900.`);
