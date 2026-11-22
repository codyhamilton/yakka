// Synthetic, local-only interactions to make the visual references inspectable.
const form=document.querySelector('#filters');
const tenant=document.querySelector('#tenant');
function update(){
 if(!form)return;
 const d=new FormData(form);const p=new URLSearchParams();
 p.set('tenant',tenant.value);
 for(const [k,v]of d)if(v)p.set(k,v);
 history.replaceState(null,'','?'+p);
 const n=d.get('win')==='all'?12480:d.get('win')==='1d'?286:8406;
 const count=Math.round(n*(d.get('repo_id')?.length?.7:1)*(d.get('kind')?.length?.18:1)*(tenant.value==='tenant-lab'?.42:1));
 form.querySelector('[type=submit]').disabled=true;
 document.querySelector('#counts').textContent=`Events matching filters: ${count.toLocaleString('en-US')} · Rejections: 4 · All retained events in tenant: ${tenant.value==='tenant-lab'?'5,242':'12,480'} · Synthetic preview updated`;
 for(const p of document.querySelectorAll('.legend span'))p.textContent=`${tenant.selectedOptions[0].textContent} · ${d.get('win')}`;
}
form?.addEventListener('submit',e=>{e.preventDefault();update()});
form?.elements.win.addEventListener('change',()=>{document.querySelector('.custom').hidden=form.elements.win.value!=='custom'});
document.querySelector('#reset')?.addEventListener('click',()=>{HTMLFormElement.prototype.reset.call(form);document.querySelector('.custom').hidden=true;update()});
document.querySelector('#all')?.addEventListener('click',()=>{form.elements.win.value='all';document.querySelector('.custom').hidden=true;update()});
tenant?.addEventListener('change',()=>{update();document.querySelector('#notice').textContent='Selected tenant: '+tenant.selectedOptions[0].textContent});
document.querySelector('#theme').addEventListener('click',()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark'});
for(const b of document.querySelectorAll('.table-toggle'))b.addEventListener('click',()=>{const p=b.closest('.panel').querySelector('.plot');if(b.textContent==='Show table'){p.dataset.chart=p.innerHTML;p.innerHTML='<table><thead><tr><th>Group</th><th>Value (synthetic)</th></tr></thead><tbody><tr><td>Claude</td><td>21.20</td></tr><tr><td>Codex</td><td>18.40</td></tr><tr><td>Cursor</td><td>6.72</td></tr></tbody></table>';b.textContent='Show chart'}else{p.innerHTML=p.dataset.chart;b.textContent='Show table'}});
for(const f of document.querySelectorAll('form:not(#filters)'))f.addEventListener('submit',e=>{e.preventDefault();document.querySelector('#notice').textContent='Design reference only: form action previewed; no account was changed.'});
document.querySelector('#refresh')?.addEventListener('click',update);
function validateDraft(){
 if(!form)return;
 const custom=form.elements.win.value==='custom';
 form.elements.from.required=custom;form.elements.to.required=custom;
 form.querySelector('[type=submit]').disabled=custom&&(!form.elements.from.value||!form.elements.to.value||form.elements.from.value>=form.elements.to.value);
 document.querySelector('#notice').textContent='Unapplied changes — use Apply filters';
}
form?.addEventListener('change',validateDraft);
form?.addEventListener('input',validateDraft);

for(const c of document.querySelectorAll(".panel-controls select,.board-controls select"))c.addEventListener("change",()=>{document.querySelector("#notice").textContent="Synthetic panel setting: "+c.value;});
