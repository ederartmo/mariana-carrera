const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('ticket detail places editor and composer before the collapsed activity drawer',()=>{
  for(const file of ['admin-inscripciones.html','public/admin-inscripciones.html']){
    const html=read(file);
    const area=html.slice(html.indexOf('<section class="admin-card support-admin-panel"'),html.indexOf('<div class="dashboard-toolbar">'));
    const order=['data-ticket-summary','data-ticket-edit','data-ticket-transcript','data-ticket-reply','data-ticket-activity'];
    for(let i=0;i<order.length;i++) assert.ok(area.indexOf(order[i])>(i?area.indexOf(order[i-1]):-1),order[i]);
    assert.match(area,/<details[^>]+data-ticket-edit[^>]*>/);
    assert.match(area,/<details[^>]+data-ticket-activity[^>]*>/);
    assert.doesNotMatch(area,/<details[^>]+\bopen\b|data-ticket-assign\b/);
    assert.match(area,/<summary[^>]*>\s*<span>Historial de actividad<\/span>\s*<span[^>]*data-ticket-activity-count/);
  }
});
