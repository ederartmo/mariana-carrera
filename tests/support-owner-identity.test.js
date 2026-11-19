const {test}=require('node:test');
const assert=require('node:assert/strict');
const {hashCapability}=require('../lib/_support');
const handler=require('../lib/admin-support');
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const T='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', U='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const G='cccccccc-cccc-4ccc-8ccc-cccccccccccc', X='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const owner=id=>({owner_user_id:id,capability_hash:hashCapability('support-owner:'+id)});
const resp=()=>({setHeader(){},status(n){this.code=n;return this;},json(b){this.body=b;return this;},end(){}});

function fixture({profileFailure=false, profileRows}={}){
  const reads=[];
  const tickets=[{id:T},{id:U},{id:G},{id:X}];
  const rows=[{id:T,owner:owner(A)},{id:U,owner:owner(B)},{id:G,owner:{owner_user_id:null}},{id:X,owner:{...owner(A),capability_hash:hashCapability('incorrect')}}];
  const profiles=profileRows || [{user_id:A,full_name:'  Nombre Ficticio  '},{user_id:B,full_name:'  '}];
  return {reads,deps:{auth:async()=>({email:'admin@example.test'}),getAdminEmails:()=>[],
    client:{rpc:async(name,args)=>({data:name==='support_admin_detail'?{ok:true,ticket:{id:args.p_ticket_id},messages:[]}:{ok:true,tickets}}),
      from(table){return {select(fields){return {in(key,ids){reads.push({table,fields,key,ids});
        if(table==='user_profiles'&&profileFailure)return {error:{code:'42501'}};
        const result=table==='support_tickets'?rows:profiles;
        return {data:result.filter(row=>ids.includes(row[key]))};
      }};}};}
    }}};
}
test('authorised admin list/detail enrich only owner-linked tickets with minimal projection',async()=>{
 const f=fixture();
 const list=resp(); await handler({method:'GET',query:{}},list,f.deps);
 assert.deepEqual(list.body.tickets.map(x=>x.identity),[
  {displayName:'Nombre Ficticio',authenticated:true},{displayName:null,authenticated:true},undefined,undefined,
 ]);
 const raw=JSON.stringify(list.body);
 for(const forbidden of [A,B,'capability_hash','full_name','admin@example.test'])assert.ok(!raw.includes(forbidden));
 assert.equal(f.reads.length,2);
 const detail=resp(); await handler({method:'GET',query:{id:T}},detail,f.deps);
 assert.deepEqual(detail.body.ticket.identity,{displayName:'Nombre Ficticio',authenticated:true});
 assert.deepEqual(f.reads.at(-1),{table:'user_profiles',fields:'user_id, full_name',key:'user_id',ids:[A]});
});

test('denied sessions and browser-supplied owner IDs cannot trigger any profile read',async()=>{
 for(const auth of [{error:true,status:401},{error:true,status:403}]){
  const f=fixture(),res=resp(); await handler({method:'GET',query:{id:T}},res,{...f.deps,auth:async()=>auth});
  assert.equal(res.code,auth.status);assert.deepEqual(f.reads,[]);
 }
 const f=fixture(), res=resp(); await handler({method:'GET',query:{id:T,owner_user_id:B}},res,f.deps);
 assert.equal(res.code,400);assert.deepEqual(f.reads,[]);
});

test('profile permission failure leaves tickets available without an identity hint',async()=>{
 const f=fixture({profileFailure:true}),res=resp();await handler({method:'GET',query:{}},res,f.deps);
 assert.equal(res.code,200);assert.ok(res.body.tickets.every(x=>!x.identity));
});

test('real admin guard rejects invalid and non-admin bearers before enrichment', async()=>{
  for(const [bearer,user,expected] of [
    ['',null,401], ['expired',null,401], ['manipulated',null,401],
    ['participant',{id:B,email:'participant@example.test'},403],
    ['admin',{id:A,email:'admin@example.test'},200],
  ]){
    const f=fixture(),res=resp();
    const {auth:unused,...deps}=f.deps;
    deps.authOptions={adminEmails:['admin@example.test'],supabase:{auth:{getUser:async()=>({data:{user},error:!user})}}};
    await handler({method:'GET',query:{id:T},headers:{authorization:bearer?'Bearer '+bearer:''}},res,deps);
    assert.equal(res.code,expected);
    if(expected!==200)assert.deepEqual(f.reads,[]);
    else assert.equal(res.body.ticket.identity.displayName,'Nombre Ficticio');
  }
});

test('public chat route cannot select another ticket or touch profiles', async()=>{
  process.env.SITE_URL='https://fixture.test';
  const publicHandler=require('../lib/support-chat');
  const headers={host:'kinetichub.com.mx',origin:'https://kinetichub.com.mx','content-type':'application/json'};
  const token='a'.repeat(64);
  for(const [req, auth, expected] of [
    [{method:'POST',headers,body:{action:'read',token,id:T}},undefined,400],
    [{method:'POST',headers:{...headers,authorization:'Bearer invalid'},body:{action:'read',token}},async()=>({error:true}),401],
    [{method:'POST',headers:{...headers,authorization:'Bearer other'},body:{action:'read',token}},async()=>({user:{id:B,email_confirmed_at:'yes'}}),404],
    [{method:'POST',headers,body:{action:'read',token}},undefined,404],
  ]){
    const res=resp(); let queries=0;
    await publicHandler(req,res,{auth,rateLimit:async()=>({allowed:true}),client:{from:()=>assert.fail('profile query outside admin')},rpc:async(name,args)=>{
      queries++;
      assert.equal(name,'support_visitor_action');
      assert.notEqual(args.p_capability_hash,hashCapability('support-owner:'+A));
      return {data:{error:'not_found'}};
    }});
    assert.equal(res.code,expected);
    assert.equal(queries,expected===404?1:0);
    assert.ok(!JSON.stringify(res.body).includes('Nombre Ficticio'));
  }
});

test('presentation labels only the authenticated account, not the legal name',()=>{
  const {presentTicket}=require('../admin-support');
  assert.equal(presentTicket({id:T,identity:{displayName:'Nombre Ficticio',authenticated:true}}).identity,'Nombre Ficticio');
  assert.equal(presentTicket({id:T,identity:{displayName:'Untrusted'}}).identity,'Visitante sin identificar');
  assert.equal(presentTicket({id:T,identity:{displayName:null,authenticated:true}}).account,true);
});

test('missing profiles and invalid display values never expose a guessed name',async()=>{
  for(const profileRows of [[],[{user_id:A,full_name:'persona@example.test'}],[{user_id:A,full_name:B}],[{user_id:A,full_name:'A'+String.fromCharCode(0x202e)+'B'}]]){
    const f=fixture({profileRows}),res=resp();
    await handler({method:'GET',query:{id:T}},res,f.deps);
    assert.equal(res.code,200);
    assert.equal(res.body.ticket.identity?.displayName ?? null,null);
    assert.equal(Boolean(res.body.ticket.identity?.authenticated),profileRows.length>0);
  }
});
