'use strict';
const fs=require('fs'),path=require('path'),http=require('http');
const app=process.cwd(),config=JSON.parse(fs.readFileSync('vercel.json'));
const csp=config.headers.find(h=>h.source==='/(.*)').headers.find(h=>h.key==='Content-Security-Policy').value;
const allowed=new Set(['create-checkout-session','checkout-summary','stripe-webhook']);
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.pdf':'application/pdf'};
http.createServer(async(req,res)=>{
 res.setHeader('Content-Security-Policy',csp);res.setHeader('Cache-Control','no-store');
 res.status=code=>{res.statusCode=code;return res};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return res};res.send=value=>{res.end(value);return res};
 try{
 const url=new URL(req.url,'http://localhost:3000');req.query=Object.fromEntries(url.searchParams);req.cookies=Object.fromEntries((req.headers.cookie||'').split(';').filter(Boolean).map(p=>{const i=p.indexOf('=');return[p.slice(0,i).trim(),decodeURIComponent(p.slice(i+1))]}));
 if(url.pathname.startsWith('/api/')){
  const name=url.pathname.slice(5);if(!allowed.has(name))return res.status(404).json({error:'Outside Perrun QA scope'});
  if(name!=='stripe-webhook'&&req.method!=='GET'){const chunks=[];for await(const chunk of req){chunks.push(chunk);if(Buffer.concat(chunks).length>1048576)return res.status(413).json({error:'Too large'});}req.body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}
  return await require(path.join(app,'api',name+'.js'))(req,res);
 }
 const target=path.resolve(app,'public','.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));if(!target.startsWith(path.join(app,'public')+path.sep))return res.status(403).send('Forbidden');
 if(!fs.existsSync(target)||!fs.statSync(target).isFile())return res.status(404).send('Not found');res.setHeader('Content-Type',mime[path.extname(target)]||'application/octet-stream');fs.createReadStream(target).pipe(res);
 }catch{if(!res.headersSent)res.status(500).json({error:'Local QA request failed; no remote fallback'});else res.end();}
}).listen(3000,'127.0.0.1',()=>console.log('QA HTTP READY=http://localhost:3000; isolated mirror; remote DB blocked'));
