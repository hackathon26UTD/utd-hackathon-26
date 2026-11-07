// Administrator-only local utility. Code is saved privately, never logged.
import {randomBytes} from 'node:crypto';
import {appendFile,chmod} from 'node:fs/promises';
import {MongoClient} from 'mongodb';
import {sha256Hex} from '../src/auth.js';
if(!process.env.MONGODB_URI||!process.env.OPERATOR_EMAIL)throw Error('Load the ignored local .env first.');
const code=randomBytes(24).toString('base64url');
const client=await MongoClient.connect(process.env.MONGODB_URI);
try{await client.db(process.env.MONGODB_DB||'utd_hackathon_26').collection('operator_accounts').updateOne({_id:process.env.OPERATOR_EMAIL.toLowerCase()},{$set:{recoveryHash:await sha256Hex(code)}},{upsert:true});await appendFile('.env',`\nOPERATOR_RECOVERY_CODE=${code}\n`);await chmod('.env',0o600);console.log('A new single-use recovery code is saved in the ignored local .env.');}finally{await client.close();}
