import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage();
p.on('pageerror', e => console.log('PAGEERROR:', String(e).slice(0,200)));
p.on('console', m => { const t=m.text(); if(/error|fail/i.test(t)) console.log('CONSOLE:', t.slice(0,160)); });
await p.goto('http://localhost:8181/?bot=1', { waitUntil: 'domcontentloaded' });
await new Promise(r=>setTimeout(r,1500));
console.log('has __botStart:', await p.evaluate(()=>typeof window.__botStart));
console.log('has G:', await p.evaluate(()=>typeof window.G));
console.log('G.state:', await p.evaluate(()=>window.G && window.G.state));
await p.evaluate(()=>{ if(window.__botStart) __botStart(); });
await new Promise(r=>setTimeout(r,12000));
console.log('after 12s -> state:', await p.evaluate(()=>window.G && window.G.state),
            '| depth:', await p.evaluate(()=>window.G && window.G.depth),
            '| roomsSeen:', await p.evaluate(()=>window.__botLog && window.__botLog.roomsSeen),
            '| events:', await p.evaluate(()=>window.__botLog && window.__botLog.events.length),
            '| sessions:', await p.evaluate(()=>window.__botLog && window.__botLog.sessions));
await b.close();
