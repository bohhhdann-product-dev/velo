import { writeFile, mkdir } from 'node:fs/promises'
import { quoteGeneration } from '../app/entities/studio/pricing.ts'

const rows = []
const draft = { modelId:'seedream-5-pro',mode:'image',trial:false,prompt:'',aspect:'16:9',imageQuality:'1k',videoQuality:'720p',durationS:5,count:1,referenceId:null }
for (const quality of ['1k','2k']) for (const refs of [0,1,2,3,6]) {
  const q = quoteGeneration({...draft,imageQuality:quality},refs)
  rows.push({name:`Seedream 5 Pro ${quality} · ${refs} refs`,cost:q.providerCostUsd,tokens:q.totalTokens,kind:'image'})
}
for (const modelId of ['seedance-2-5','seedance-2-5-flash','seedance-2-0','seedance-2-0-fast','seedance-2-0-mini'])
  for (const quality of ['480p','720p']) for (const seconds of [5,10,15]) {
    const q=quoteGeneration({...draft,mode:'video',modelId,videoQuality:quality,durationS:seconds})
    rows.push({name:`${modelId} ${quality} · ${seconds}s`,cost:q.providerCostUsd,tokens:q.totalTokens,kind:'video'})
  }
// Scenarios only: Voplica's workflow average is neither a per-duration quote nor a cap.
for (const credits of [20,37,60,80]) rows.push({name:`Voplica hypothetical ${credits} credits`,cost:credits*0.014,tokens:null,kind:'scenario'})
const variants=rows.flatMap(r=>[70,75,80].map(markup=>{
  const tokens=Math.ceil(Math.round(r.cost*1e6)*(100+markup)/100000), revenue=tokens/1000
  const fee=revenue*.02, infra=r.kind==='image'?.002:.01
  return {model:r.name,kind:r.kind,cost_usd:r.cost,markup_percent:markup,tokens,retail_usd:revenue,
    gross_profit_usd:revenue-r.cost,gross_margin_percent:(revenue-r.cost)/revenue*100,
    fee_usd:fee,assumed_infra_usd:infra,contribution_usd:revenue-r.cost-fee-infra,
    contribution_percent:(revenue-r.cost-fee-infra)/revenue*100}
}))
const directory=new URL('../../docs/',import.meta.url)
await mkdir(directory,{recursive:true})
const keys=Object.keys(variants[0])
await writeFile(new URL('unit-economics.csv',directory),keys.join(',')+'\n'+variants.map(r=>keys.map(k=>JSON.stringify(typeof r[k]==='number'?Number(r[k].toFixed(6)):r[k])).join(',')).join('\n')+'\n')
const html=`<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vela · Unit economics</title>
<style>body{margin:0;background:#101312;color:#e7ece9;font:16px/1.6 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:40px 24px}h1{font-size:36px;letter-spacing:-1px}h2{font-size:22px}p{color:#abb8b0;max-width:850px}a{color:#a4d9b4}section{border-top:1px solid #354039;margin-top:32px;padding-top:24px}.controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:18px}label{display:grid;gap:6px;font-size:14px}input,select{background:#202722;color:inherit;border:1px solid #506257;border-radius:8px;padding:10px;font:inherit;min-width:0}input:focus,select:focus{outline:2px solid #a4d9b4;outline-offset:2px}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:20px;margin-top:24px}.metrics div{background:#1b231e;padding:18px;border-radius:12px}.metrics b{display:block;font-size:28px}.table{overflow:auto}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}td,th{text-align:right;padding:10px;border-bottom:1px solid #354039;white-space:nowrap}td:first-child,th:first-child{text-align:left}small{color:#abb8b0}.negative{color:#ffaaa2}</style>
<main><h1>Vela: ціна, витрати, прибуток</h1><p>Розрахунок від 23.11.2026. 1 000 токенів = $1. Поточна політика: націнка 75%, округлення до цілого токена на кожен результат. Це ціна API плюс націнка; показник contribution нижче враховує додаткові змінні витрати.</p>
<section><h2>Перевірити сценарій</h2><div class="controls">
<label>Модель / приклад<select id="model"></select></label>
<label>Собівартість API, $<input id="cost" type="number" min="0" step="0.001"></label>
<label>Націнка, %<input id="markup" type="number" min="0" max="500" value="75"></label>
<label>Комісія платежу, %<input id="fee" type="number" min="0" max="100" value="2" step="0.1"></label>
<label>Фіксована комісія покупки, $<input id="fixed" type="number" min="0" value="0" step="0.1"></label>
<label>Розмір пакета, $<input id="pack" type="number" min="1" value="10"></label>
<label>Інфраструктура / результат, $<input id="infra" type="number" min="0" value="0.002" step="0.001"></label>
<label>Платні невдалі спроби, %<input id="failure" type="number" min="0" max="95" value="0"></label>
<label>Повернення виручки, %<input id="refund" type="number" min="0" max="100" value="0"></label>
<label>Податок у включеній ціні, %<input id="tax" type="number" min="0" max="100" value="0"></label>
</div><div class="metrics" aria-live="polite" id="metrics"></div><p id="explain"></p>
<small>Комісія 2% — базовий сценарій еквайрингу, не підключена платіжна система. Фіксована комісія розподіляється пропорційно пакету. Інфраструктура, повернення й платні помилки — змінювані припущення. Податок — лише сценарій включеного VAT/sales tax, не податкова консультація.</small></section>
<section><h2>Порівняння 70% / 75% / 80%</h2><p>У клітинках: роздрібна ціна та кількість токенів за один результат. Seedance — оцінка для зазначеної якості без вхідного відео. Voplica — сценарії різного фактичного використання, не затверджені тарифи MiniMax.</p><div class="table"><table><thead><tr><th>Генерація</th><th>API, $</th><th>70%</th><th>75%</th><th>80%</th></tr></thead><tbody id="rows"></tbody></table></div></section>
<section><h2>Що вже враховано</h2><p>Seedream 5 Pro: перший референс безкоштовний, кожен наступний додає $0.003 до API-витрат на результат. Кожен output — окремий запит. Seedance: зображення-референси не додають окремої плати; вхідне відео має іншу формулу й не входить до поточного сценарію Vela. Фактичні відеотокени можуть відрізнятися від оцінки.</p><p>Voplica використовує фактичні обчислення. 37 кредитів у workflow — середній орієнтир; 10 кредитів резерву не є лімітом. Для сценаріїв використано найдорожчий перевірений пакет Anytime: 500 кредитів за $7. Live-ціна MiniMax у Vela заблокована до калібрування.</p><p>Джерела: <a href="https://console.byteplus.com/ark/region:ap-southeast-1/docs/model-pricing">BytePlus ModelArk</a>, <a href="https://docs.voplica.com/billing/">Voplica billing</a>. <a href="unit-economics.csv">Завантажити CSV</a> · <a href="unit-economics-research.md">Детальний звіт</a>.</p></section></main>
<script>const data=${JSON.stringify(rows)};const $=id=>document.getElementById(id);const money=n=>'$'+n.toFixed(4);data.forEach((r,i)=>{let o=document.createElement('option');o.value=i;o.textContent=r.name;$('model').append(o)});function load(){let r=data[+$('model').value];$('cost').value=r.cost;$('infra').value=r.kind==='image'?.002:.01;render()}function render(){const n=id=>Math.max(0,Number($(id).value)||0);let cost=n('cost'),markup=n('markup'),tokens=Math.ceil(Math.round(cost*1e6)*(100+markup)/100000),price=tokens/1000,net=price/(1+n('tax')/100)*(1-Math.min(100,n('refund'))/100),fees=price*(n('fee')/100+n('fixed')/Math.max(1,n('pack'))),adjustedCost=cost/(1-Math.min(95,n('failure'))/100),profit=net-fees-adjustedCost-n('infra');$('metrics').innerHTML=[['Ціна користувачу',money(price)],['Токенів',tokens.toLocaleString()],['Ціна мінус базова API-вартість',money(price-cost)],['Contribution',money(profit)],['Contribution / виручка',price?(profit/price*100).toFixed(1)+'%':'—']].map(([k,v])=>'<div><small>'+k+'</small><b>'+v+'</b></div>').join('');$('explain').textContent='Націнка '+markup+'% дає '+(markup/(100+markup)*100).toFixed(2)+'% валової маржі до округлення. Contribution = виручка без включеного податку та повернень − платіжні комісії − API з платними невдачами − інфраструктура.'}document.querySelectorAll('input').forEach(el=>el.addEventListener('input',render));$('model').addEventListener('change',load);$('rows').innerHTML=data.map(r=>'<tr><td>'+r.name+'</td><td>'+money(r.cost)+'</td>'+[70,75,80].map(m=>{let t=Math.ceil(Math.round(r.cost*1e6)*(100+m)/100000);return '<td>'+money(t/1000)+' · '+t+'</td>'}).join('')+'</tr>').join('');load();</script></html>`
await writeFile(new URL('unit-economics.html',directory),html)
console.log(`Generated ${variants.length} pricing scenarios and interactive calculator.`)
