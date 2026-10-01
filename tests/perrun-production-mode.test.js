"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {requireStripeMode}=require('../lib/_perrun-checkout');
const cases=[
 ['production LIVE',{VERCEL_ENV:'production',STRIPE_SECRET_KEY:'sk_live_fixture'},true],
 ['production restricted LIVE',{VERCEL_ENV:'production',STRIPE_SECRET_KEY:'rk_live_fixture'},true],
 ['production TEST rejected',{VERCEL_ENV:'production',STRIPE_SECRET_KEY:'sk_test_fixture'},null],
 ['local TEST',{STRIPE_SECRET_KEY:'sk_test_fixture'},false],
 ['local LIVE rejected',{STRIPE_SECRET_KEY:'sk_live_fixture'},null],
 ['preview LIVE rejected',{VERCEL_ENV:'preview',STRIPE_SECRET_KEY:'sk_live_fixture'},null],
 ['QA TEST local',{PERRUN_QA_LOCAL:'1',STRIPE_SECRET_KEY:'sk_test_fixture',SUPABASE_URL:'http://127.0.0.1:55321'},false],
 ['QA LIVE rejected',{PERRUN_QA_LOCAL:'1',STRIPE_SECRET_KEY:'sk_live_fixture',SUPABASE_URL:'http://127.0.0.1:55321'},null],
 ['QA remote rejected',{PERRUN_QA_LOCAL:'1',STRIPE_SECRET_KEY:'sk_test_fixture',SUPABASE_URL:'https://example.supabase.co'},null],
 ['QA production rejected',{PERRUN_QA_LOCAL:'1',VERCEL_ENV:'production',STRIPE_SECRET_KEY:'sk_live_fixture',SUPABASE_URL:'http://127.0.0.1:55321'},null]
];
for(const [name,values,expected]of cases)test('Stripe environment policy '+name,()=>{const names=['VERCEL_ENV','STRIPE_SECRET_KEY','PERRUN_QA_LOCAL','SUPABASE_URL'],old=Object.fromEntries(names.map(k=>[k,process.env[k]]));try{for(const k of names){if(values[k]===undefined)delete process.env[k];else process.env[k]=values[k];}if(expected===null)assert.throws(requireStripeMode);else assert.equal(requireStripeMode(),expected);}finally{for(const k of names){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}});
