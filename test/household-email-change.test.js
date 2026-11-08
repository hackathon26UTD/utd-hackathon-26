import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {MongoClient,ObjectId} from 'mongodb';
import {issueCustomerSession,passwordHash} from '../src/operator-session.js';
import {accountHandler} from '../src/customer-self-service.js';
import {activeHouseholdMember} from '../src/households.js';

test('email rename-away-and-back cannot revive owned households, invited access, verification or queues',async()=>{
  const mongo=await MongoMemoryReplSet.create({replSet:{count:1}}),client=await MongoClient.connect(mongo.getUri()),db=client.db('household_rename');
  try{
    const env={MONGODB_URI:mongo.getUri(),MONGODB_DB:db.databaseName,SESSION_SECRET:'test-rename-household'},old='owner@example.test',next='new@example.test',friend='friend@example.test',password='test-household-password';
    const a={_id:old,sessionGeneration:'original-generation',salt:'test-salt',hash:await passwordHash(password,'test-salt'),createdAt:new Date(Date.now()-10000)};
    await db.collection('customer_accounts').insertMany([a,{_id:friend,sessionGeneration:'friend-generation'}]);
    const device=new ObjectId();await db.collection('devices').insertOne({_id:device,meta:{}});await db.collection('customer_links').insertOne({_id:'link',deviceId:String(device),customerEmail:old,active:true});
    await db.collection('households').insertMany([{_id:'owned',ownerEmail:old,ownerGeneration:a.sessionGeneration,active:true,linkIds:['link']},{_id:'friends',ownerEmail:friend,ownerGeneration:'friend-generation',active:true,linkIds:[]}]);
    const common={status:'active',preferences:{device:true,weather:true},emailVerifiedAt:new Date(),verifiedEmail:old};
    await db.collection('household_members').insertMany([{...common,_id:'owner',householdId:'owned',email:old,accountGeneration:a.sessionGeneration,role:'owner'},{...common,_id:'guest',householdId:'owned',email:friend,accountGeneration:'friend-generation',role:'viewer'},{...common,_id:'invitee',householdId:'friends',email:old,accountGeneration:a.sessionGeneration,role:'viewer'},{_id:'friend-owner',householdId:'friends',email:friend,accountGeneration:'friend-generation',role:'owner',status:'active'},{_id:'pending',householdId:'friends',email:old,status:'pending',inviteHash:'old-private-hash'}]);
    await db.collection('household_email_tokens').insertOne({_id:'private-token-hash',memberId:'invitee'});await db.collection('household_mail_outbox').insertOne({_id:'pending-email',memberId:'invitee',status:'pending'});
    let cookie='__Host-homebeacon_customer='+await issueCustomerSession(env,old,{verifiedAccount:a,db});
    for(const email of [next,old]){
      const request=new Request('https://home.test/api/customer/account',{method:'PATCH',headers:{Origin:'https://home.test',Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({email,confirmEmail:email,password})});
      const r=await accountHandler({request,env,db});assert.equal(r.status,200);assert.equal((await r.json()).householdAccessRevoked,true);cookie=r.headers.get('set-cookie').split(';')[0];
    }
    assert.equal((await db.collection('customer_accounts').findOne({_id:old})).sessionGeneration,a.sessionGeneration);
    assert.equal((await db.collection('customer_links').findOne({_id:'link'})).customerEmail,old);
    assert.equal((await db.collection('households').findOne({_id:'owned'})).active,false);
    assert.equal((await db.collection('households').findOne({_id:'friends'})).active,true);
    for(const id of ['owner','guest','invitee','pending'])assert.equal((await db.collection('household_members').findOne({_id:id})).status,'revoked');
    assert.equal(await activeHouseholdMember(db,'invitee'),null);assert.equal(await activeHouseholdMember(db,'guest'),null);
    assert.equal(await db.collection('household_email_tokens').countDocuments(),0);assert.equal((await db.collection('household_mail_outbox').findOne({_id:'pending-email'})).status,'suppressed');
    assert.ok(await activeHouseholdMember(db,'friend-owner'));
  }finally{await client.close();await mongo.stop();}
});
