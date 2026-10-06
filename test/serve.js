const http=require('http'),fs=require('fs'),path=require('path');
const T={'.html':'text/html; charset=utf-8','.css':'text/css','.jpg':'image/jpeg','.woff2':'font/woff2','.svg':'image/svg+xml'};
http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.join(__dirname,'site',p);
fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);return s.end('nf')}s.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream'});s.end(d)})}).listen(8124);
